---
sidebar_position: 8
---

# HTTP Transport

In addition to `stdio`, Neva clients support connecting to MCP servers over **Streamable HTTP**.

## What `connect()` Does

`connect()` opens with a single **`server/discover`** request — there is no
`initialize` / `initialized` handshake. `Client::discover()` is the explicit
call; `Client::init()` remains as a back-compat alias.

Every subsequent `POST` carries:

* the `MCP-Protocol-Version` header, pinned to `2026-07-28`;
* `_meta` with `io.modelcontextprotocol/protocolVersion` and
  `io.modelcontextprotocol/clientCapabilities`;
* the routing headers `Mcp-Method`, `Mcp-Name`, and any
  `Mcp-Param-{name}` the called tool's schema asks for.

Neva builds all of these for you. The server rejects a request whose headers
and body disagree, so if you sit behind a proxy that rewrites headers, that
is the first place to look at a sudden `400`.

`Client::server_info` is read from `_meta["io.modelcontextprotocol/serverInfo"]`,
which every result carries — it is no longer part of the discovery result.

There is no standalone SSE `GET` stream to open: server-initiated
notifications arrive on a [`subscriptions/listen`](./subscriptions) request
the client opens for them, whose `POST` reply is itself the stream.

### Talking to a legacy server

The client is **dual-mode**. If `server/discover` is rejected at the wire
phase — `MethodNotFound`, `InvalidRequest`, or a non-JSON-RPC / unknown-code
reply — it falls back to the legacy `initialize` handshake and speaks legacy
to that peer for the rest of the connection: `Mcp-Session-Id`, the
standalone SSE `GET` stream, server-push sampling/roots/logging, no MRTR and
no routing headers.

Network-level failures do **not** trigger the fallback. The switch is
per-connection, monotonic, and decided before any other traffic — so you
don't need a `legacy-spec` build just to reach an older server.

`with_mcp_version(...)` still exists on the client, but it only selects
**which legacy version the fallback negotiates**; it can never make
`server/discover` reject a valid MCP 2026-07-28 server.

## Connecting via HTTP

Use [`with_http()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_http) to configure the client for HTTP transport:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")));

    client.connect().await?;

    // Call tools, read resources, etc.

    client.disconnect().await
}
```

## Default HTTP Configuration

For a quick start, use [`with_default_http()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_default_http), which connects to `127.0.0.1:3000` with the default `/mcp` endpoint:

```rust
let mut client = Client::new()
    .with_options(|opt| opt.with_default_http());
```

## TLS / HTTPS

To connect to an HTTPS server, configure TLS on the client:

```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("localhost:7878")
            .with_tls(|tls| tls
                .with_certs_verification(false)))); // Disable for self-signed certs
```

:::warning
Disabling certificate verification (`with_certs_verification(false)`) is intended for local development only.
In production, always use a properly signed certificate and leave verification enabled.
:::

## Bearer Token Authentication

If the MCP server requires JWT authentication, attach a bearer token using [`with_auth()`](https://docs.rs/neva/latest/neva/client/options/http/struct.HttpClient.html#method.with_auth):

```rust
const ACCESS_TOKEN: &str = "eyJhbGci..."; // Your JWT bearer token

let mut client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("localhost:7878")
            .with_auth(ACCESS_TOKEN)));

client.connect().await?;
```

The token is sent as an `Authorization: Bearer <token>` header on every request.

## Full Example: HTTPS + Auth

```rust
use neva::prelude::*;

const ACCESS_TOKEN: &str = "eyJhbGci...";

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("localhost:7878")
                .with_tls(|tls| tls
                    .with_certs_verification(false))
                .with_auth(ACCESS_TOKEN)));

    client.connect().await?;

    let result = client.call_tool("my_tool", ("input", "value")).await?;
    println!("{:?}", result.content);

    client.disconnect().await
}
```

## Learn By Example

* [MRTR client](https://github.com/RomanEmreis/neva/tree/main/examples/mrtr/client) — the round-trip loop end to end
* [HTTP client (roots)](https://github.com/RomanEmreis/neva/tree/main/examples/roots/client)
* [Sampling client](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/client)
