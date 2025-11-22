---
sidebar_position: 2
---

# Tools

In the [Basics](/docs/mcp-client/basics#call-a-tool) chapter, we learned how to invoke a simple tool.
In this section, we’ll explore in more detail how to **call tools**, **pass arguments**, **handle structured results**, and **validate outputs** against the tool schemas provided by the MCP server.

## Calling a Tool

To call a tool, use the [`call_tool()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.call_tool) method.
It requires the tool name and optional arguments.

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

## Passing Arguments

If a tool accepts a single parameter, pass a tuple containing the parameter name and its value:

```rust
let args = ("name", "John");
let result = client.call_tool("hello", args).await?;
```

If a tool has **multiple parameters**, pass them as an array, [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html), or [`HashMap`](https://doc.rust-lang.org/std/collections/struct.HashMap.html):

```rust
let args = [
    ("name", "John"),
    ("say", "Hi"),
];
let result = client.call_tool("hello", args).await?;
```

If a tool is **parameterless**, pass the [unit type `()`](https://doc.rust-lang.org/std/primitive.unit.html):

```rust
let result = client.call_tool("hello", ()).await?;
```

## Structured Content

Some tools return structured JSON data (see [MCP Structured Content spec](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content)).

You can access it directly through the [`struct_content`](https://docs.rs/neva/latest/neva/types/tool/call_tool_response/struct.CallToolResponse.html#structfield.struct_content) field:

```rust
let result = client.call_tool("weather-forecast", args).await?;
println!("{:?}", result.struct_content);
```

Or, you can deserialize it into a typed structure using [`as_json()`](https://docs.rs/neva/latest/neva/types/tool/call_tool_response/struct.CallToolResponse.html#method.as_json):

```rust
#[derive(Debug, serde::Deserialize)]
struct Weather {
    conditions: String,
    temperature: f32,
    humidity: f32,
}

let args = ("location", "London");
let result = client.call_tool("weather-forecast", args).await?;
let weather: Weather = result.as_json()?;
```

## Validating Structured Results

It’s a good practice to validate structured responses against the [**output schema**](/docs/mcp-server/tools#output-schema) that every MCP server should provide.

When you call [`list_tools()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.list_tools), you receive metadata for each tool, including input and output schemas.

```rust
#[json_schema(de, debug)]
struct Weather {
    conditions: String,
    temperature: f32,
    humidity: f32,
}

// Get the list of available tools
let tools = client.list_tools(None).await?;

// Find a specific tool
let tool = tools.get("weather-forecast")
    .expect("No weather-forecast tool found");

// Call the tool
let args = ("location", "London");
let result = client.call_tool(&tool.name, args).await?;

// Validate and deserialize the result
let weather: Weather = tool
    .validate(&result)
    .and_then(|res| res.as_json())?;
```

The [`json_schema`](https://docs.rs/neva/latest/neva/attr.json_schema.html) macro automatically derives JSON schema metadata from your Rust structures, ensuring compatibility with [`serde`](https://serde.rs/).
You can configure its behavior using attributes such as:

* `de` - derive deserialization only
* `ser` - derive serialization only
* `serde` - derive both serialization and deserialization
* `debug` - include debug metadata in the generated schema


## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/client)
