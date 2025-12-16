---
sidebar_position: 6
---

# Sampling

In MCP, the **client** is responsible for executing LLM sampling requests initiated by servers.
Unlike traditional architectures, the client:
* Owns model access and API keys
* Applies local policies (cost, privacy, rate limits)
* Mediates all interaction with language models

Servers never communicate with LLMs directly - they only **request sampling**.

> **Important mental model**
>
> * Server **requests** sampling
> * Client **executes** sampling
> * Client decides:
>   * which model to use
>   * whether tools are supported
>   * how prompts are handled
> * Client returns structured results back to the server

## Client Configuration

Sampling support must be explicitly enabled on the client:
```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_sampling(|s| s.with_tools())
        .with_http(|http| http.bind("localhost:7878")));
```
* [with_sampling()](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_sampling) enables sampling support
* [with_tools()](https://docs.rs/neva/latest/neva/types/struct.SamplingCapability.html#method.with_tools) allows tool calls during sampling

## Sampling Handler

To support sampling, a client must define a handler annotated with [#[sampling]](https://docs.rs/neva/latest/neva/attr.sampling.html) attribute macro.
This handler receives a [CreateMessageRequestParams](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html) object and returns a
[CreateMessageResult](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html).

```rust
use neva::prelude::*;

#[sampling]
async fn sampling_handler(params: CreateMessageRequestParams) -> CreateMessageResult {
    println!("Received sampling request: {:?}", params);

    // Client-side sampling logic goes here
}
```

The handler is invoked every time a server calls [Context::sample()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.sample).

## Inspecting Sampling Requests

The incoming [CreateMessageRequestParams](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html) contains:
* Prompt messages
* System prompt
* Model preferences
* Tools metadata
* Previous tool results (for multi-step sampling)

### Access text prompts
```rust
let prompts: Vec<&TextContent> = params.text().collect();
```
This includes all user and assistant text messages accumulated so far.

### Detecting tool usage requests
The client can check whether the server allows or expects tool usage via
`tool_choice`:
```rust
if params.tool_choice.is_some_and(|c| !c.is_none()) {
    // Model is allowed or required to call tools
}
```
This allows the client to decide whether to produce tool calls or final text.

## Tool Use

If tools are enabled, the client may respond with a tool invocation request instead of
plain text.

```rust
CreateMessageResult::assistant()
    .with_model("gpt-5")
    .use_tools([
        ("get_weather", ("city", "London"))
    ])
```
:::note
* Tool execution is always performed by the server
* The client only returns intent to call tools
* Tool arguments must match the tool schema
:::

## Handling Tool Results

After the server executes tools, it will issue a follow-up sampling request
containing tool results.

These results are available via:
```rust
let results: Vec<&ToolResult> = params.results().collect();
```

At this stage, the client should typically:
* Interpret tool outputs
* Generate a final assistant response
* End the sampling turn

## Producing Final Responses

To return a normal assistant message and end the sampling loop:
```rust
CreateMessageResult::assistant()
    .with_model("gpt-5")
    .with_content("Final response text")
    .end_turn()
```
Calling [end_turn()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html#method.end_turn) signals to the server that sampling is complete.

## When to Customize Client Sampling

Consider custom sampling logic when:
* You need to integrate proprietary or local models
* You want fine-grained cost or latency control
* You want to apply prompt filtering or auditing
* You need deterministic or policy-driven responses

## Learn By Example
A complete working example is available [here](https://github.com/RomanEmreis/neva/blob/main/examples/sampling/client/src/main.rs).
