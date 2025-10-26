---
sidebar_position: 2
---

# Tools

The Model Context Protocol (MCP) allows servers to expose [tools](https://modelcontextprotocol.io/specification/draft/server/tools) that can be invoked by language models. Tools enable models to interact with external systems, such as querying databases, calling APIs, or performing computations. Each tool is uniquely identified by a name and includes metadata describing its schema.

In the [Basics](/docs/mcp-server/basics) chapter, we learned how to declare a simple tool:

```rust
use neva::prelude::*;

#[tool(descr = "A simple 'say hello' tool")]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

You can achieve the same result **without** using the procedural macro:

```rust
use neva::prelude::*;

async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    let mut mcp_server = App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP Server")
            .with_version("1.0.0"));
            
    mcp_server
        .map_tool("hello", hello)
        .with_description("A simple 'say hello' tool");

    mcp_server.run().await;
}
```

In the example above, the tool name must be set explicitly.
When using the [`#[tool]`](https://docs.rs/neva/latest/neva/attr.tool.html) attribute macro, the tool name is automatically inferred from the function name.

All other tool parameters that can be specified in the attribute macro can also be configured using `with_*` methods (for example, [`with_description()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_description)).

The [`map_tool()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_tool) method registers a tool handler under a specified name and returns a mutable reference to the registered [tool](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html).

## Input Schema

You can describe an explicit [input schema](https://docs.rs/neva/latest/neva/types/tool/struct.ToolSchema.html) for a tool.
If not provided, Neva automatically generates one based on the tool handler’s function signature.

To override the generated schema, you can specify it as a JSON string:

```rust
#[tool(
    descr = "A simple 'say hello' tool",
    input_schema = r#"{
        "properties": {
            "name": { 
                "type": "string", 
                "description": "The name to greet"
            }
        },
        "required": ["name"]
    }"#
)]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

## Output Schema

If your tool returns [**structured data**](https://modelcontextprotocol.io/specification/draft/server/tools#tool-result) (for example, a JSON object),
Neva automatically generates an [output schema](https://docs.rs/neva/latest/neva/types/tool/struct.ToolSchema.html) based on the return type.

Just like with the [input schema](/docs/mcp-server/tools#input-schema),
you can override it manually:

```rust
#[tool(
    descr = "A 'say hello' tool with structured output",
    output_schema = r#"{
        "properties": {
            "message": { 
                "type": "string", 
                "description": "The generated greeting message"
            }
        },
        "required": ["message"]
    }"#
)]
async fn hello(say: String, name: String) -> Json<Results> {
    let result = Results { 
        message: format!("{say}, {name}!")
    };
    result.into()
}
```

## MCP Context

For more advanced scenarios - for example, when a tool needs to access resources you also declared in your MCP Server -
you can inject the [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) into your tool handler:

```rust
#[tool(descr = "Fetches resource metadata")]
async fn read_resource(ctx: Context, res: Uri) -> Result<Content, Error> {
    let result = ctx.resource(res).await?;
    let resource = result.contents
        .into_iter()
        .next()
        .expect("No resource contents");
    Ok(Content::resource(resource))
}
```


## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/server)
