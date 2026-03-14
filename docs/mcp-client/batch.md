---
sidebar_position: 10
---

# Batch Requests

Neva supports **JSON-RPC 2.0 batch requests** — a way to send multiple requests to the server in a single round trip and receive all responses at once.
This is useful when you need to fetch several independent pieces of information (tools list, resources, prompt results, etc.) and want to minimize latency.

## Building a Batch

Use [`client.batch()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.batch) to obtain a [`BatchBuilder`](https://docs.rs/neva/latest/neva/client/batch/struct.BatchBuilder.html), chain the desired requests, then call `.send()`:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_default_http());

    client.connect().await?;

    let responses = client
        .batch()
        .list_tools()
        .list_resources()
        .call_tool("add", [("a", 40_i32), ("b", 2_i32)])
        .send()
        .await?;

    println!("{responses:?}");

    client.disconnect().await
}
```

[`send()`](https://docs.rs/neva/latest/neva/client/batch/struct.BatchBuilder.html#method.send) returns `Vec<Response>` in the same order as the requests were added.

## Available Batch Methods

| Method | Equivalent single call |
|---|---|
| `.list_tools()` | `client.list_tools(None)` |
| `.call_tool(name, args)` | `client.call_tool(name, args)` |
| `.list_resources()` | `client.list_resources(None)` |
| `.read_resource(uri)` | `client.read_resource(uri)` |
| `.list_resource_templates()` | `client.list_resource_templates(None)` |
| `.list_prompts()` | `client.list_prompts(None)` |
| `.get_prompt(name, args)` | `client.get_prompt(name, args)` |
| `.ping()` | `client.ping()` |
| `.notify(method, params)` | fire-and-forget notification |

## Processing Responses

Each element in the returned `Vec<Response>` corresponds to a request in order. Use [`into_result::<T>()`](https://docs.rs/neva/latest/neva/types/enum.Response.html#method.into_result) to deserialize a response into the expected type:

```rust
let responses = client
    .batch()
    .list_tools()
    .call_tool("add", [("a", 40_i32), ("b", 2_i32)])
    .send()
    .await?;

let tools = responses[0].clone().into_result::<ListToolsResult>()?;
let add   = responses[1].clone().into_result::<CallToolResponse>()?;

println!("Tools: {:?}", tools.tools);
println!("add(40, 2) = {:?}", add.content);
```

### Pattern Destructuring

For a fixed-size batch you can destructure the slice directly:

```rust
let responses = client
    .batch()
    .list_tools()
    .list_resources()
    .list_prompts()
    .call_tool("add", [("a", 40_i32), ("b", 2_i32)])
    .read_resource("notes://daily")
    .get_prompt("greeting", [("name", "Neva")])
    .ping()
    .send()
    .await?;

let [tools, resources, prompts, add_result, daily, greeting, ping] =
    responses.as_slice() else {
        return Err(Error::new(ErrorCode::InternalError, "unexpected number of responses"));
    };

let tools   = tools.clone().into_result::<ListToolsResult>()?;
let add     = add_result.clone().into_result::<CallToolResponse>()?;
let daily   = daily.clone().into_result::<ReadResourceResult>()?;
let greeting = greeting.clone().into_result::<GetPromptResult>()?;
```

## Notifications in a Batch

Notifications are fire-and-forget — they are included in the wire payload but do **not** produce a response slot in the returned `Vec`:

```rust
use serde_json::json;

let responses = client
    .batch()
    .notify("notifications/message", Some(json!({ "level": "info", "data": "hello" })))
    .list_tools()
    .send()
    .await?;

// responses has 1 element (only list_tools produced a response)
let tools = responses[0].clone().into_result::<ListToolsResult>()?;
```

## Server Side

No additional server configuration is required to support batch requests. Any Neva server — on both `stdio` and HTTP transports — handles JSON-RPC 2.0 batches automatically.
A standard setup is sufficient:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_default_http())
        .run()
        .await;
}
```

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/batch).
