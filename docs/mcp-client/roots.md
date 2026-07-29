---
sidebar_position: 5
---

# Roots

:::warning Deprecated on arrival
MCP 2026-07-28 removed `roots/list` as a capability-driven server→client
*request* and re-homed it onto MRTR as an
[input-request kind](../spec-2026-07-28.md#input-request-kinds-elicitation-sampling-roots)
— **already deprecated**. `Client::add_root` / `add_roots` carry
`#[deprecated]` and need `#[allow(deprecated)]`.

New tools should take the paths they need as explicit arguments instead.
:::

The Model Context Protocol (MCP) provides a standardized way for clients to expose filesystem “roots” to servers. [Roots](https://modelcontextprotocol.io/specification/draft/client/roots) define the boundaries of where servers can operate within the filesystem, allowing them to understand which directories and files they have access to.

## Roots are Configured Data

Roots are not a handler. The client answers the server's `roots/list` input
request from the list it was built with, and a **non-empty list is what makes
it declare `clientCapabilities.roots`** on every request — a server may only
ask for a kind the client declared.

Because there is no `notifications/roots/list_changed` any more, the list a
server sees is whatever the client holds when the request arrives. There is
no push to subscribe to and no `roots.listChanged` capability to enable.

### Adding Roots
```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http.bind("127.0.0.1:3001").with_endpoint("/mcp")));

    // Deprecated on arrival, like the whole roots kind.
    #[allow(deprecated)]
    client
        .add_root("file:///home/user/projects/my_project", "My Project")
        .add_root("file:///home/user/projects/my_another_project", "My Another Project");

    client.connect().await?;

    // The MRTR round-trip happens inside this one call.
    let result = client.call_tool("scan_workspace", ()).await?;
    tracing::info!("Result: {:?}", result.content);

    client.disconnect().await
}
```

## Accessing Roots on the Server

Inject [`Context`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html)
into your tool handler and ask for the list with a stable **replay key**:

```rust
#[tool]
async fn scan_workspace(mut ctx: Context) -> Result<String, Error> {
    // Round 1 unwinds the handler with `input_required` and a `roots/list`
    // envelope; round 2 replays the answer from `requestState`.
    #[allow(deprecated)]
    let roots = ctx.list_roots("dirs").await?;

    // Each root contains a URI and a human-readable name
    for root in &roots.roots {
        tracing::info!(uri = %root.uri, name = %root.name);
    }

    Ok(format!("{} root(s)", roots.roots.len()))
}
```

Everything above the `list_roots` point re-runs on the second round, so
guard side effects with `ctx.memo` / `ctx.once` / `ctx.on_commit` — the same
primitives that cover [elicitation](../mcp-server/elicitation#guarding-side-effects).

:::note Under `legacy-spec`
Roots are a push request: `ctx.list_roots()` takes no key, roots can be added
after `connect()`, and the `roots.listChanged` capability
(`with_roots(|r| r.with_list_changed())`) notifies the server of updates. See
[Legacy spec](../legacy-spec.md).
:::

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/roots).
