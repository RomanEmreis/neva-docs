---
sidebar_position: 5
---

# Sampling

The Model Context Protocol (MCP) provides a standardized way for servers to request [LLM sampling](https://modelcontextprotocol.io/specification/draft/client/sampling) (“completions” or “generations”) from language models via clients. This flow allows clients to maintain control over model access, selection, and permissions while enabling servers to leverage AI capabilities—with no server API keys necessary. Servers can request text, audio, or image-based interactions and optionally include context from MCP servers in their prompts.

> **Important mental model**
>
> * Server **requests** sampling
> * Client **decides**:
>   * which model to use
>   * whether sampling is allowed
>   * how tools are executed
> * Server **never** owns API keys and **never** talks to LLMs directly

## Basic Usage

To use sampling, inject [`Context`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) into your tool handler and call the [`sample()`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.sample)
method with a prompt.
```rust
use neva::prelude::*;

#[tool]
async fn generate_weather_report(mut ctx: Context, city: String) -> Result<String, Error> {
    let params = CreateMessageRequestParams::new()
        .with_message(format!("What's the weather in {city}?"))
        .with_sys_prompt("You are a helpful assistant.");

    let result = ctx.sample(params).await?;

    Ok(format!("{:?}", result.content))
}
```

:::tip
If you already have an appropriate prompt template declared in your MCP server, you may use the [prompt()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.prompt) method of `Context` instead of passing formatted string.
:::

### Configure Create Message Request

The [СreateMessageRequestParams](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html) struct provides methods to configure:
* Temperature
* System prompt
* Token limits
* Model preferences
```rust
use neva::prelude::*;

let model_pref = ModelPreferences::new()
    .with_hints(["claude-4.5-sonnet", "gpt-5"])
    .with_cost_priority(0.3)
    .with_speed_priority(0.8)
    .with_intel_priority(0.5);

let params = CreateMessageRequestParams::new()
    .with_message(format!("What's the weather in {city}?"))
    .with_sys_prompt("You are a helpful assistant.")
    .with_max_tokens(1000)
    .with_temp(0.2)
    .with_pref(model_pref);
```
Model preferences are **hints**, not guarantees.

The client may:
* Ignore them
* Map them to a different model
* Apply additional policies

## Tool Use

If the client supports the `sampling.tools` capability, server can provide a list of tools for LLM to use during sampling. You may do it via [with_tools()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html#method.with_tools) method:

Tools are always executed by the **server**, never by the client or the model.
```rust
use neva::prelude::*;

let Some(tool) = ctx.find_tool("get_weather").await else {
    return Err(ErrorCode::MethodNotFound.into());
};

let params = CreateMessageRequestParams::new()
    .with_message(format!("What's the weather in {city}?"))
    .with_sys_prompt("You are a helpful assistant.")
    .with_tools([tool]);
```

`Context` additionally has the [tools()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.tools), [find_tool()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.find_tool) and [find_tools()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.find_tools) methods that could be helpful to fetching tools metadata for client.

### Configure the tool choice

By default the [with_tools()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html#method.with_tools) set the `toolChoice` for LLM to `auto`. However you may change it with the [with_tool_choice()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html#method.with_tool_choice) method. 
```rust
use neva::prelude::*;

let Some(tool) = ctx.find_tool("get_weather").await else {
    return Err(ErrorCode::MethodNotFound.into());
};

let params = CreateMessageRequestParams::new()
    .with_message(format!("What's the weather in {city}?"))
    .with_sys_prompt("You are a helpful assistant.")
    .with_tools([tool])
    .with_tool_choice(ToolChoiceMode::Required);
```

The [ToolChoiceMode](https://docs.rs/neva/latest/neva/types/sampling/enum.ToolChoiceMode.html) struct can be:
* `Auto` - Model decides whether to call tools (default).
* `Required` - Model must call at least one tool.
* `None` - Model must not call any tools.

## Handle Sampling Loop

Below is a reference implementation of a sampling loop with tool execution.
Most real-world MCP servers follow this pattern.

The `sample()` method returns [CreateMessageResult](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html). You should inspect its [stop_reason](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html#structfield.stop_reason) and continue sampling until a terminal reason is reached.
```rust
use neva::prelude::*;

#[tool]
async fn generate_weather_report(mut ctx: Context, city: String) -> Result<String, Error> {
    let Some(tool) = ctx.find_tool("get_weather").await else {
        return Err(ErrorCode::MethodNotFound.into());
    };
    
    let mut params = CreateMessageRequestParams::new()
        .with_message(format!("What's the weather in {city}?"))
        .with_sys_prompt("You are a helpful assistant.")
        .with_tools([tool]);
    
    loop {
        let result = ctx.sample(params.clone()).await?;

        if result.stop_reason == Some(StopReason::ToolUse) {
            // Getting the tool use requests from sampling response
            let tools: Vec<ToolUse> = result.tools()
                .cloned()
                .collect();

            // Logging them for the "context" as assistant messages
            let assistant_msg = tools
                .iter()
                .fold(SamplingMessage::assistant(), |msg, tool| msg.with(tool.clone()));

            // Calling tools that LLM requested
            let tool_results = ctx.use_tools(tools).await;

            // Logging the tools results as user messages
            let user_msg = tool_results
                .into_iter()
                .fold(SamplingMessage::user(), |msg, result| msg.with(result));

            // Creating the params for the next step with the previous context and tool results
            params = params
                .with_message(assistant_msg)
                .with_message(user_msg)
                .with_tool_choice(ToolChoiceMode::None);
        } else {
            // Stopping if we get a reason different from tool use
            return Ok(format!("{:?}", result.content));
        };
    }
}
```

:::note
Each sampling step **must** include:
* Assistant messages with tool calls
* User messages with tool results

This mirrors LLM training data and allows the client to reconstruct full context.
:::

:::warning
In production code you **should** always:
* Limit the number of sampling iterations
* Handle unexpected stop reasons
:::

## When Not to Use Sampling

Avoid sampling when:
- The task is deterministic
- No natural language reasoning is required
- A regular tool or function call is sufficient

## Learn By Example
A complete working example is available [here](https://github.com/RomanEmreis/neva/blob/main/examples/sampling/server/src/main.rs).

