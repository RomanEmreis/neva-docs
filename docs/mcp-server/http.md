---
sidebar_position: 7
---

# HTTP Transport

:::note Under `proto-2026-07-28-rc`
The HTTP transport is request/response only — no SSE GET, no DELETE, no `Mcp-Session-Id` on the wire. Multi-instance deployments require `with_request_state_secret` and a shared `with_request_state_store`. See [RC preview](/rc-preview).
:::


In addition to `stdio`, Neva supports **Streamable HTTP** transport — a bidirectional transport layer built on top of HTTP that enables remote MCP server connections.

This page covers the **default** HTTP server, built on the [Volga](https://docs.rs/volga) framework. It is enabled by `server-full` or the `http-server-volga` feature flag and requires no extra wiring on your part.

If you need to host the MCP endpoint on a different HTTP stack — `axum`, `hyper`, `actix-web`, or any custom adapter — see [Custom HTTP Stack](./custom-http). Both paths share the same `with_http(...)` configuration, JWT auth, role/permission gates, and SSE replay semantics described below.

:::warning Breaking change in v0.3.3
The `http-server` feature flag is now **engine-agnostic** and no longer pulls in Volga. To keep the default Volga-based server, depend on `http-server-volga` (or stay on the `server-full` preset, which still selects it for you). If you previously did `features = ["http-server"]` and want the same behavior as before v0.3.3, rename it to `http-server-volga`.
:::

## Basic Setup

To start a server on Streamable HTTP, use [`with_http()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_http) in your options:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")))
        .run()
        .await;
}
```

This starts an HTTP server on `127.0.0.1:3000` with the default `/mcp` endpoint.

## Custom Endpoint

You can change the MCP endpoint path with [`with_endpoint()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_endpoint):

```rust
App::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("127.0.0.1:3000")
            .with_endpoint("/my-mcp")))
    .run()
    .await;
```

## Default HTTP Configuration

For a quick start, use [`with_default_http()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_default_http), which binds to `127.0.0.1:3000` with the default endpoint:

```rust
App::new()
    .with_options(|opt| opt.with_default_http())
    .run()
    .await;
```

## TLS

To enable HTTPS, configure TLS using the [`with_tls()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_tls) method:

```rust
let http = HttpServer::new("localhost:7878")
    .with_tls(|tls| tls
        .with_dev_cert(DevCertMode::Auto));

App::new()
    .with_options(|opt| opt.set_http(http))
    .run()
    .await;
```

[`DevCertMode::Auto`](https://docs.rs/neva/latest/neva/transport/http/enum.DevCertMode.html) automatically generates a self-signed certificate for local development.
In production, provide your own certificate and key files instead.

## JWT Authentication

Neva supports **bearer token authentication** via JWT on the HTTP transport.

To enable it, use [`with_auth()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_auth) inside `with_http()`:

```rust
let secret = std::env::var("JWT_SECRET")
    .expect("JWT_SECRET must be set");

App::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .with_auth(|auth| auth
                .validate_exp(false)
                .with_aud(["my-service"])
                .with_iss(["my-issuer"])
                .set_decoding_key(secret.as_bytes()))))
    .run()
    .await;
```

### Auth Configuration Options

| Method | Description |
|---|---|
| `set_decoding_key()` | Secret or public key used to verify JWT signatures |
| `with_aud()` | Accepted token audience values |
| `with_iss()` | Accepted token issuer values |
| `validate_exp()` | Whether to validate the token expiration (default `true`) |

## Role-Based Access Control

Once authentication is configured, you can restrict access to individual tools, prompts, and resources using `roles` and `permissions` attributes:

```rust
/// Accessible to everyone
#[tool]
async fn public_tool(name: String) {
    tracing::info!("Running public tool for {name}");
}

/// Only accessible to users with the "admin" role
#[tool(roles = ["admin"])]
async fn admin_tool(name: String) {
    tracing::info!("Running admin tool for {name}");
}

/// Only accessible to users with the "admin" role and "read" permission
#[prompt(roles = ["admin"], permissions = ["read"])]
async fn restricted_prompt(topic: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Restricted topic: {topic}"))
}

/// Only accessible to users with the "read" permission
#[resource(uri = "res://restricted/{name}", permissions = ["read"])]
async fn restricted_resource(uri: Uri, name: String) -> (String, String) {
    (uri.to_string(), name)
}
```

Roles and permissions are extracted from JWT token claims. Access is denied with a `403 Forbidden` if the token does not satisfy the declared requirements.

## Blocking Runner

For use cases where you need a synchronous entry point (e.g., embedding in a non-async context), you can use [`run_blocking()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.run_blocking) instead of `.run().await`:

```rust
fn main() {
    App::new()
        .with_options(|opt| opt.with_default_http())
        .run_blocking();
}
```

## Testing with MCP Inspector

To test a Streamable HTTP server using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), start your server first:

```bash
cargo run
```

Then open the Inspector and connect to `http://127.0.0.1:3000/mcp`.

## Learn By Example

* [HTTP server](https://github.com/RomanEmreis/neva/tree/main/examples/http)
* [Protected server with JWT auth](https://github.com/RomanEmreis/neva/tree/main/examples/protected-server)
* [Sampling server with TLS](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/server)
* [Custom HTTP stack (axum)](https://github.com/RomanEmreis/neva/tree/main/examples/axum)
* [Custom HTTP stack (hyper)](https://github.com/RomanEmreis/neva/tree/main/examples/hyper)
* [Custom HTTP stack (actix-web)](https://github.com/RomanEmreis/neva/tree/main/examples/actix)
