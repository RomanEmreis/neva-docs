---
sidebar_position: 4
---

# Prompts

In the [Basics](/docs/mcp-client/basics#get-a-prompt) chapter, we learned how to get a simple prompt.
In this section, we’ll explore in more detail how deal with resources provided by the MCP server.

## Getting a Prompt

To get a prompt, use [`client.prompts().get()`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html#method.get).
It requires the prompt name and optional arguments.

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

    let args = ("lang", "Rust");
    let prompt = client.prompts().get("hello_world_code", args).await?;

    println!("{prompt.descr:?}: {prompt.messages:?}");

    client.disconnect().await
}
```

## Passing Arguments

If a prompt requires a single parameter, pass a tuple containing the parameter name and its value:

```rust
let args = ("lang", "Rust");
let prompt = client.prompts().get("hello_world_code", args).await?;
```

If a prompt requires **multiple parameters**, pass them as an array, [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html), or [`HashMap`](https://doc.rust-lang.org/std/collections/struct.HashMap.html):

```rust
let args = [
    ("lang", "Rust"),
    ("topic", "Hello World function"),
];
let prompt = client.prompts().get("write_code", args).await?;
```

If a prompt is **parameterless**, pass the [unit type `()`](https://doc.rust-lang.org/std/primitive.unit.html):

```rust
let prompt = client.prompts().get("rust_hello_world", ()).await?;
```

## Listing Prompts

[`list(cursor)`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html#method.list) asks for one page of
the server's prompts, and [`list_all()`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html#method.list_all)
walks every page:

```rust
for prompt in client.prompts().list_all().await? {
    println!("{}: {:?}", prompt.name, prompt.descr);
}
```

A prompt is the user's to pick, not the model's to call. To open a conversation
with one, [`neva::svir::prompt_messages`](../svir#prompts-and-resources) turns it
into the messages a model is sent.

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/client)