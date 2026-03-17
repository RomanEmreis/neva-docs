---
sidebar_position: 1
---

# Basics

Let's build a simple MCP server with Neva and add a tool, prompt and resource handlers.

## Create an app

Create a new binary-based app:
```bash
cargo new neva-mcp-server
cd neva-mcp-server
```

Add the following dependencies in your `Cargo.toml`:

```toml
[dependencies]
neva = { version = "...", features = "server-full" }
tokio = { version = "1", features = ["full"] }
```

## Setup a tool
Let's start by adding a simple tool - a function that greets a user by name.

Create your main application in `main.rs`:

```rust
use neva::prelude::*;

#[tool(descr = "A say hello tool")]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP server")
            .with_version("1.0.0"))
        .run()
        .await;
}
```

In the code above configured the MCP Server that runs on `stdio` transport and declared an async tool handler by using a [tool](https://docs.rs/neva/latest/neva/attr.tool.html) attribute macro that extracts the `name` parameter into a `String` and expects another result `String` to be returned. The macro registers our `hello` tool with the specified description. 

Besides the `descr`, you can configure your tool with:
- `title` - Tool title.
- `input_schema` - Schema for the tool input.
- `output_schema` - Schema for the tool output.
- `annotations` - Arbitrary [metadata](https://docs.rs/neva/latest/neva/types/tool/struct.ToolAnnotations.html).
- `roles` & `permissions` - Define which users can run the tool when using Streamable HTTP transport with OAuth.

## Testing the MCP Server

For testing purposes you may leverage the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) by running the following command:
```bash
npx @modelcontextprotocol/inspector cargo run
```
This launches the MCP Inspector UI, allowing you to explore your server’s tools, prompts, and resources interactively.

## Adding a prompt handler

Next, we'll similarly add the prompt handler by using the [prompt](https://docs.rs/neva/latest/neva/attr.prompt.html) attribute macro:
```rust
#[prompt(descr = "Generates a user message requesting a hello world code generation.")]
async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}
```

## Adding a resource tempate handler

Same idea as above, with the special [resource](https://docs.rs/neva/latest/neva/attr.resource.html) attribute macro you can define a resource handler with minimal boilerplate:
```rust
#[resource(
    uri = "res://{name}",
    title = "Read resource",
    descr = "Some details about resource",
    mime = "application/octet-stream",
    annotations = r#"{
        "audience": ["user"],
        "priority": 1.0
    }"#
)]
async fn get_res(uri: Uri, name: String) -> ResourceContents {
    let data = "some file contents"; // Read a resource from some source

    ResourceContents::new(uri)
        .with_title(name)
        .with_blob(data)
}
```

## Custom Handlers

Use [`#[handler]`](https://docs.rs/neva/latest/neva/attr.handler.html) to respond to any raw JSON-RPC method — including custom methods outside the standard MCP specification. This is useful for implementing proprietary protocol extensions or server-to-server coordination messages.

The `command` parameter specifies the JSON-RPC method name to handle:

```rust
use neva::prelude::*;

#[handler(command = "ping")]
async fn ping_handler() {
    eprintln!("pong");
}
```

Handler functions can accept any parameters that implement [`FromHandlerParams`](https://docs.rs/neva/latest/neva/app/handler/trait.FromHandlerParams.html):

```rust
use neva::prelude::*;

/// Receives the full request and the current MCP context
#[handler(command = "custom/status")]
async fn status_handler(ctx: Context, req: Request) -> String {
    let session = ctx.session_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "none".into());
    format!("session={session} method={}", req.method)
}
```

Available built-in parameter types:

| Type | Provides |
|------|----------|
| `Context` | Current session context (send sampling requests, subscribe to resources, etc.) |
| `Request` | Raw JSON-RPC request (method, params, headers, claims) |
| `RequestId` | The request's identifier |
| `RuntimeMcpOptions` | Server configuration at runtime |

Handlers also support the `middleware` parameter, just like `#[tool]` and `#[prompt]`:

```rust
async fn audit(ctx: MwContext, next: Next) -> Response {
    tracing::info!("custom command called");
    next(ctx).await
}

#[handler(command = "custom/action", middleware = [audit])]
async fn action_handler(req: Request) {
    tracing::info!("handling {}", req.method);
}
```

## JSON-RPC 2.0 Batch Support

Neva servers handle [JSON-RPC 2.0 batch requests](https://www.jsonrpc.org/specification#batch) automatically on both `stdio` and HTTP transports — no extra configuration is required.
When a client sends a batch (a JSON array of request objects), the server processes each request and returns the responses as a JSON array in the same order.

See the [client Batch Requests guide](/docs/mcp-client/batch) for the client-side API.

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/server)
