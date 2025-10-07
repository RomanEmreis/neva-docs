---
sidebar_position: 1
---

# MCP Client - Basics

Let’s use the Neva MCP client to connect to your MCP servers (and others too).

## Create an app

Create a new binary-based app:
```bash
cargo new neva-mcp-client
cd neva-mcp-client
```

Add the following dependencies in your `Cargo.toml`:

```toml
[dependencies]
neva = { version = "0.1.8", features = "client-full" }
tokio = { version = "1", features = ["full"] }
```

## Call a tool

First, let’s call the tool we created in the [server basics](/docs/mcp-server/basics#setup-a-tool).

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio(
                "cargo", 
                ["run", "--manifest-path", "./neva-mcp-server/Cargo.toml"]));
    
    client.connect().await?;
    
    let args = ("name", "John");
    let result = client.call_tool("hello", args).await?;
    println!("{:?}", result.content);
    
    client.disconnect().await
}
```

Here we configure the [MCP Client](https://docs.rs/neva/latest/neva/client/struct.Client.html) to connect to the server via `stdio`.  
Once connected, you can call tools, get prompts, or read resources until you disconnect (or the client is dropped).

## Get a Prompt

Next, let’s fetch a [prompt](/docs/mcp-server/basics#adding-a-prompt-handler) to see how prompts work from the client side.

```rust
let args = ("lang", "Rust");
let prompt = client.get_prompt("analyze_code", args).await?;
println!("{:?}: {:?}", prompt.descr, prompt.messages);
```

## Read a Resource

Then, let's read a resource that we declared [here](/docs/mcp-server/basics#adding-a-resource-tempate-handler).
```rust
let resource = client.read_resource("res://resource-1").await?;
println!("{:?}", resource.contents);
```

## List Of Tools, Prompts and Resources

Finally, here’s how to explore all available tools, prompts, and resources dynamically.

```rust
// Returns a list of tools
let tools = client
    .list_tools(None)
    .await?;

// Returns a list of resources
let resources = client
    .list_resources(None)
    .await?;

// Returns a list resource templates
let templates = client
    .list_resource_templates(None)
    .await?;

// Returns a list of prompts
let prompts = client
    .list_prompts(None)
    .await?;
```

## Pagination

Large lists are returned in pages of 10 items by default.  
Use the [`next_cursor`](https://docs.rs/neva/latest/neva/types/cursor/struct.Cursor.html) value to fetch subsequent pages:

```rust
// First 10
let resources = client
    .list_resources(None)
    .await?;

// Next 10
let resources = client
    .list_resources(resources.next_cursor)
    .await?;

// Next 10
let resources = client
    .list_resources(resources.next_cursor)
    .await?;
```

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/0.1.8/examples/client)