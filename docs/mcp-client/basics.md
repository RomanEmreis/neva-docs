---
sidebar_position: 1
---

# Basics

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
neva = { version = "...", features = "client-full" }
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
    let result = client.tools().call("hello", args).await?;

    println!("{:?}", result.content);
    
    client.disconnect().await
}
```

Here we configure the [MCP Client](https://docs.rs/neva/latest/neva/client/struct.Client.html) to connect to the server via `stdio`.  
Once connected, you can call tools, get prompts, or read resources until you disconnect (or the client is dropped).

The server's primitives are grouped the way MCP names its methods, one
namespace per prefix:

| Namespace | Methods |
|---|---|
| [`client.tools()`](https://docs.rs/neva/latest/neva/client/api/struct.Tools.html) | `tools/list`, `tools/call` |
| [`client.resources()`](https://docs.rs/neva/latest/neva/client/api/struct.Resources.html) | `resources/list`, `resources/templates/list`, `resources/read` |
| [`client.prompts()`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html) | `prompts/list`, `prompts/get` |
| [`client.tasks()`](https://docs.rs/neva/latest/neva/client/api/struct.Tasks.html) | `tasks/get`, `tasks/update`, `tasks/cancel` — see [Tasks](./tasks) |

Each namespace is a `Copy` view borrowed from the client, so any number of them
can be held at once: `let (tools, prompts) = (client.tools(), client.prompts());`.

:::note `disconnect()` is local
It shuts down the transport and sends **nothing** on the wire. There is no
goodbye message in the protocol — the param-less
`notifications/cancelled` neva used to send does not validate against the
spec's own schema, and a server learns the client is gone from the closed
connection anyway.
:::

## When `connect` fails

`connect()` starts the transport, and a transport that will not start says so
**there** — a stdio command that cannot be spawned, a rejected OAuth or TLS
configuration, a bind that fails. It is not reported later as a request that
timed out, and a client that was never given a transport is told at `connect`
rather than at its first call.

A `connect` that failed on the way up leaves the client intact: the configured
transport is still there, so the same client can try again, or be pointed
somewhere else.

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_stdio("weather-mcp", ["--stdio"]));

    if let Err(err) = client.connect().await {
        eprintln!("the installed server did not start: {err}");

        // The same client, pointed at a locally built copy instead.
        client = client.with_options(|opt| opt
            .with_stdio("cargo", ["run", "-p", "weather-mcp"]));
        client.connect().await?;
    }

    let tools = client.tools().list(None).await?;
    println!("{} tools", tools.tools.len());

    client.disconnect().await
}
```

:::note What is retryable, and what is not
Anything the transport refuses **as a whole** — nothing has been consumed, so
the next attempt is a real attempt. Once the transport is running, a later
failure (a server that answers discovery with an error) is not undone by
retrying: that needs a fresh `Client`, because a stdio server needs a fresh
child process anyway.
:::

## Get a Prompt

Next, let’s fetch a [prompt](/docs/mcp-server/basics#adding-a-prompt-handler) to see how prompts work from the client side.

```rust
let args = ("lang", "Rust");
let prompt = client.prompts().get("hello_world_code", args).await?;
```

## Read a Resource

Then, let's read a resource that we declared [here](/docs/mcp-server/basics#adding-a-resource-tempate-handler).
```rust
let resource = client.resources().read("res://resource-1").await?;
```

## List Of Tools, Prompts, and Resources

Finally, here’s how to explore all available tools, prompts, and resources dynamically.

```rust
// Every tool, every page of them
let tools = client.tools().list_all().await?;

// Every resource
let resources = client.resources().list_all().await?;

// The first page of resource templates
let templates = client.resources().templates(None).await?;

// Every prompt
let prompts = client.prompts().list_all().await?;
```

`list_all()` walks the listing page by page and returns the items together. A
server still paging after 64 pages is an **error** rather than a partial list,
since a listing cut short would look complete.

## Pagination

Large lists are returned in pages of 10 items by default.  
To walk them yourself, `list(cursor)` asks for one page: `None` for the first,
and the previous page's [`next_cursor`](https://docs.rs/neva/latest/neva/types/cursor/struct.Cursor.html)
for the one after it:

```rust
// First 10
let resources = client.resources().list(None).await?;

// Next 10
let resources = client.resources().list(resources.next_cursor).await?;

// Next 10
let resources = client.resources().list(resources.next_cursor).await?;
```

Listings are ordered deterministically by name on the server side, so paging
can no longer skip or repeat an entry. See
[Listing Order](../mcp-server/tools#listing-order).

## Sharing a Client

Every request method takes `&self`, so a connected client can be shared across
tasks — put it in an `Arc` and clone the handle:

```rust
use std::sync::Arc;
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_default_http());
    client.connect().await?;

    let client = Arc::new(client);
    let calls = ["London", "Paris", "Tokyo"].map(|city| {
        let client = client.clone();
        tokio::spawn(async move {
            client.tools().call("get_weather", ("city", city)).await
        })
    });

    for call in calls {
        println!("{:?}", call.await);
    }
    Ok(())
}
```

Setup keeps `&mut self`: `connect`, the `map_*` and `on_*` handlers and the
roots are configured before the client is shared.

## Timeouts and Cancellation

A request the client stops waiting for is **cancelled** — when it outlives the
timeout ([`with_timeout`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_timeout),
10 seconds unless set), and when its future is dropped, for example by
`tokio::time::timeout` or the losing branch of a `select!`:

```rust
use std::time::Duration;

// Dropped after a second: the server is told to stop working on it.
let result = tokio::time::timeout(
    Duration::from_secs(1),
    client.tools().call("slow_report", ()),
).await;
```

How the server is told depends on the transport. Over Streamable HTTP under MCP
2026-07-28, the client closes the request's response stream — that *is* the
cancellation there, and no `notifications/cancelled` is sent. Over stdio, and to
a legacy peer, it sends `notifications/cancelled`. Either way the request's
pending slot is released at once, and a late answer to it is dropped. The
requests of an abandoned [batch](./batch) are cancelled too; the legacy
`initialize`, which the spec does not allow to be cancelled, never is.

## Caching

Every list result — and `server/discover` and `resources/read` — carries
`ttlMs` and `cacheScope`. Both are **mandatory** members under MCP
2026-07-28 rather than optional hints, so a client can always tell how long
a result stays fresh and who may share it:

| `cacheScope` | Meaning |
|---|---|
| `private` | Cacheable only for this client (the default) |
| `public` | Shareable across clients |

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/client)
