---
sidebar_position: 5
---

# Roots

The Model Context Protocol (MCP) provides a standardized way for clients to expose filesystem “roots” to servers. [Roots](https://modelcontextprotocol.io/specification/draft/client/roots) define the boundaries of where servers can operate within the filesystem, allowing them to understand which directories and files they have access to. Servers can request the list of roots from supporting clients and receive notifications when that list changes.

## Configuring Roots

You can specify one or more roots that will be exposed to the server.
Roots may be added before or after connecting the client.
* Roots added **before** `connect()` are sent during the initial handshake.
* Roots added **after** `connect()` require the roots.listChanged capability.

### Adding Roots
```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio(
                "cargo", 
                ["run", "--manifest-path", "./neva-mcp-server/Cargo.toml"]));

    // Add roots that should be available during the initial handshake
    client.add_root("file:///home/user/projects/my_project", "My Project");

    client.connect().await?;

    // Add additional roots dynamically after connection
    client.add_roots([
        ("file:///home/user/projects/another_project", "My Another Project"),
        ("file:///home/user/projects/one_more_project", "One More Project"),
    ]);

    // Call a tool, read a resource ....

    client.disconnect().await
}
```

## Notifying the Server When the Root List Changes

If roots are added or removed **after** the client has connected, enable the
`roots.listChanged` capability so the server can be notified of updates.
```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_roots(|roots| roots.with_list_changed())
        .with_stdio(
            "cargo", 
            ["run", "--manifest-path", "./neva-mcp-server/Cargo.toml"]));
```

Enable `roots.listChanged` only if:
* Roots are modified after `connect()`
* The server relies on receiving root updates dynamically

If all roots are known upfront, this capability is not required.

## Accessing Roots on the Server

On the server side, roots provided by the client are available through the
request `Context`. Roots may be received during the initial handshake or
updated dynamically via the `roots.listChanged` capability.

To access the current list of roots, inject [`Context`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html)
into your tool handler:

```rust
#[tool]
async fn roots_request(mut ctx: Context) -> Result<(), Error> {
    let roots = ctx.list_roots().await?;

    // Each root contains a URI and a human-readable name
    for root in roots.roots {
        tracing::info!(uri = %root.uri, name = %root.name);
    }

    Ok(())
}
```

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/roots).
