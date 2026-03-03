---
sidebar_position: 8
---

# HTTP Transport

In addition to `stdio`, Neva clients support connecting to MCP servers over **Streamable HTTP** — a bidirectional transport layer suitable for remote servers.

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

* [HTTP client (roots)](https://github.com/RomanEmreis/neva/tree/main/examples/roots/client)
* [Sampling client with HTTPS + JWT](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/client)
