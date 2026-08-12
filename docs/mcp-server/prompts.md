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

## Optional Arguments

An argument declared `Option<T>` is published with `"required": false`, and
a `prompts/get` that leaves it out hands the handler `None`:

```rust
#[prompt(descr = "Generates a user message requesting a hello world code generation.")]
async fn hello_world_code(lang: String, tone: Option<String>) -> PromptMessage {
    let tone = tone.unwrap_or_else(|| "neutral".into());
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}, tone: {tone}"))
}
```

Building the argument list by hand,
[`PromptArgument::named(name, required)`](https://docs.rs/neva/latest/neva/types/prompt/struct.PromptArgument.html#method.named)
is the description-less form; `PromptArgument::required` and
`PromptArgument::optional` are the same thing with a description.

## Argument Names

Prompt arguments are read from a `prompts/get` **by name**, so the names the
handler reads by must be the names `prompts/list` publishes.

`#[prompt]` takes the function's own parameter names. A bare closure has
none — Rust does not preserve them — and falls back to the positional
`arg0`, `arg1`, … The `map_prompt!` macro reads them off the closure:

```rust compile
use neva::{App, map_prompt, types::Role};

#[tokio::main]
async fn main() {
    let mut app = App::new();

    map_prompt!(app, "analyze", |lang: String, code: String| async move {
        (format!("Analyze this {lang} code: {code}"), Role::User)
    })
    .with_description("Analyzes a code snippet");

    app.run().await;
}
```

[`Prompt::with_args()`](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html#method.with_args)
is the explicit form, and it sets the published arguments and the extraction
names in one go, so the two cannot drift.

A prompt that publishes arguments its handler does not read fails
`App::run` at startup — see
[Tools → Startup Validation](./tools#startup-validation), which covers
prompts by the same rule.

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