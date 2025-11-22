---
sidebar_position: 4
---

# Prompts

In the [Basics](/docs/mcp-client/basics#get-a-prompt) chapter, we learned how to get a simple prompt.
In this section, we’ll explore in more detail how deal with resources provided by the MCP server.

## Getting a Prompt

To get a prompt, use the [`get_prompt()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.get_prompt) method.
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
    let prompt = client.get_prompt("hello_world_code", args).await?;

    println!("{prompt.descr:?}: {prompt.messages:?}");

    client.disconnect().await
}
```

## Passing Arguments

If a prompt requires a single parameter, pass a tuple containing the parameter name and its value:

```rust
let args = ("lang", "Rust");
let prompt = client.get_prompt("hello_world_code", args).await?;
```

If a prompt requires **multiple parameters**, pass them as an array, [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html), or [`HashMap`](https://doc.rust-lang.org/std/collections/struct.HashMap.html):

```rust
let args = [
    ("lang", "Rust"),
    ("topic", "Hello World function"),
];
let prompt = client.get_prompt("write_code", args).await?;
```

If a prompt is **parameterless**, pass the [unit type `()`](https://doc.rust-lang.org/std/primitive.unit.html):

```rust
let prompt = client.get_prompt("rust_hello_world", ()).await?;
```

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/client)