---
sidebar_position: 6
---

# Sampling

:::warning Deprecated on arrival
MCP 2026-07-28 removed sampling as a capability-driven *push* request. The
client now fulfils `sampling/createMessage`
[input requests](../spec-2026-07-28.md#input-request-kinds-elicitation-sampling-roots)
inside its own MRTR round-trip loop, so the caller of `call_tool` still sees
a single call.

The whole kind is deprecated on arrival: `Client::map_sampling` carries
`#[deprecated]` and needs `#[allow(deprecated)]`. And the **`#[sampling]`
attribute macro is not available in the default build** — it belongs to the
legacy push model. Wire the handler with an explicit `map_sampling`.
:::

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
        .with_sampling(|s| s.with_tools()));
```
* [with_sampling()](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_sampling) enables sampling support
* [with_tools()](https://docs.rs/neva/latest/neva/types/struct.SamplingCapability.html#method.with_tools) allows tool calls during sampling

Registering a handler is what makes the client declare
`clientCapabilities.sampling` on every request; a server may only ask for a
kind the client declared, and asking an undeclared client is reported rather
than left to stall the round-trip.

## Sampling Handler

Register the handler with
[`Client::map_sampling`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.map_sampling).
It receives a [CreateMessageRequestParams](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html) and returns a
[CreateMessageResult](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html).

```rust
use neva::prelude::*;
use neva::types::sampling::{CreateMessageRequestParams, CreateMessageResult};

async fn complete(params: CreateMessageRequestParams) -> CreateMessageResult {
    // Client-side sampling logic goes here
    CreateMessageResult::assistant()
        .with_model("o3-mini")
        .with_content("...")
        .end_turn()
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_default_http());

    // Deprecated on arrival, like the whole sampling kind.
    #[allow(deprecated)]
    client.map_sampling(complete);

    client.connect().await?;

    // The MRTR round-trips happen inside this one call.
    let result = client.call_tool("summarize_report", [("topic", "EMEA")]).await?;

    client.disconnect().await
}
```

The handler is invoked once per round in which the server calls
[Context::sample()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.sample).

:::note Under `legacy-spec`
Sampling is a server→client push request, and the
[`#[sampling]`](https://docs.rs/neva/latest/neva/attr.sampling.html)
attribute macro registers the handler for you. See
[Legacy spec](../legacy-spec.md).
:::

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
