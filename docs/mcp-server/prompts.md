---
sidebar_position: 4
---

# Prompts

The Model Context Protocol (MCP) provides a standardized way for servers to expose [prompt](https://modelcontextprotocol.io/specification/draft/server/prompts) templates to clients. Prompts allow servers to provide structured messages and instructions for interacting with language models. Clients can discover available prompts, retrieve their contents, and provide arguments to customize them.

In the [Basics](/docs/mcp-server/basics#adding-a-prompt-handler) chapter, we learned how to declare a simple prompt:
```rust
#[prompt(descr = "Generates a user message requesting a hello world code generation.")]
async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}
```

You can achieve the same result **without** using the procedural macro:
```rust
use neva::prelude::*;

async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}

#[tokio::main]
async fn main() {
    let mut mcp_server = App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP Server")
            .with_version("1.0.0"));
            
    mcp_server
        .map_prompt("hello_world_code", hello_world_code)
        .with_description("Generates a user message requesting a hello world code generation.");

    mcp_server.run().await;
}
```

In the example above, the prompt name must be set explicitly.
When using the [`#[prompt]`](https://docs.rs/neva/latest/neva/attr.prompt.html) attribute macro, the prompt name is automatically inferred from the function name.

All other prompt parameters that can be specified in the attribute macro can also be configured using `with_*` methods (for example, [`with_description()`](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html#method.with_description)).

The [`map_prompt()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_prompt) method registers a prompt handler under a specified name and returns a mutable reference to the registered [prompt](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html).

## Input Arguments

You can describe an explicit [input arguments](https://docs.rs/neva/latest/neva/types/prompt/struct.PromptArgument.html) for a prompt.
If not provided, Neva automatically generates one based on the prompt handler’s function signature.

To override the generated schema, you can specify it as a JSON string:
```rust
#[prompt(
    descr = "Generates a user message requesting a hello world code generation.",
    args = r#"[
        {
            "name": "lang",
            "description": "A language to use",
            "required": true
        }
    ]"#
)]
async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}
```

## MCP Context

For more advanced scenarios - for example, when a prompt needs to access resources you also declared in your MCP Server -
you can inject the [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) into your prompt handler:

```rust
#[prompt(descr = "Generates a user message requesting a translate a text using the glossary.")]
async fn translate_with_glossary(ctx: Context, text: String) -> PromptMessage {
    let glossary = ctx.resource("res://glossary").await?;
    let resource = result.contents
        .into_iter()
        .next()
        .expect("No resource contents");

    PromptMessage::user()
        .with(format!("Translate using this glossary:\n{glossary}\n\nText: {text}"))
}
```

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/server)