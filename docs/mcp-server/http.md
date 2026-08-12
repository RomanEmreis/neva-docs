---
sidebar_position: 7
---

# HTTP Transport

In addition to `stdio`, Neva supports **Streamable HTTP** transport for remote MCP server connections.

This page covers the **default** HTTP server, built on the [Volga](https://docs.rs/volga) framework. It is enabled by `server-full` or the `http-server-volga` feature flag and requires no extra wiring on your part.

If you need to host the MCP endpoint on a different HTTP stack — `axum`, `hyper`, `actix-web`, or any custom adapter — see [Custom HTTP Stack](./custom-http). Both paths share the same `with_http(...)` configuration, JWT auth, and role/permission gates described below.

## The Transport is Stateless

Under [MCP 2026-07-28](../spec-2026-07-28.md#stateless-http-transport) the
transport is request/response only:

* No `Mcp-Session-Id` on the wire, and no session `DELETE`.
* No standalone SSE `GET` stream — server-initiated pushes ride a
  [`subscriptions/listen`](./subscriptions) request the client opens itself.
* Every request carries the `MCP-Protocol-Version` header, plus mandatory
  `_meta` keys for the protocol version and the client's capabilities.
* Routing headers (`Mcp-Method`, `Mcp-Name`, `Mcp-Param-{name}`) must agree
  with the body, or the request is rejected with `HeaderMismatch`
  (`-32020`) and HTTP `400`.

A `POST` gets a `text/event-stream` reply in three cases:

| The `POST` | The stream carries |
|---|---|
| Its `_meta` carries `io.modelcontextprotocol/logLevel` | that request's [log](./logging) notifications, then its response |
| Its `_meta` carries a `progressToken` | that request's [progress](./progress) notifications, then its response |
| It is a [`subscriptions/listen`](./subscriptions) request | the acknowledgment, then every notification the filter admits, until the stream ends |

Every other `POST` gets a single JSON object.

:::note Under `legacy-spec`
The session-bound transport comes back: `Mcp-Session-Id`, session `DELETE`,
and the standalone SSE `GET` stream with `Last-Event-ID` replay. See
[Legacy spec](../legacy-spec.md).
:::

## Running More Than One Instance

Because the transport is stateless, a multi round-trip request can land on
any instance — so two shared resources become mandatory as soon as you run
more than one:

```rust
App::new()
    // Without this, cross-instance retries cannot decrypt `requestState`.
    // neva warns at startup if it is missing.
    .with_request_state_secret(std::env::var("MCP_STATE_SECRET").unwrap().as_bytes())
    // Without this, a lost-response retry re-runs the handler and
    // double-fires `on_commit`. The default store is per-process.
    .with_request_state_store(my_redis_store)
    .with_options(|opt| opt.with_default_http())
    .run()
    .await;
```

See [Deployment must-do for multi-instance HTTP](../spec-2026-07-28.md#deployment-must-do-for-multi-instance-http)
for what the secret protects and how to rotate it.

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

## DNS-Rebinding Protection

A server on loopback is reachable by any page the browser loads: point
`evil.example.com` at `127.0.0.1` and the browser will connect. The request
really is local — what gives the attack away is the *name* it was addressed
by. Neva therefore validates `Origin` and `Host` and answers `403 Forbidden`
before reading the body.

**The default needs no call.** Bound to loopback, the server accepts only
loopback names — `localhost`, anything in `127.0.0.0/8`, `[::1]` — on any
port. Bound to anything else it accepts everything, because the names a
deployment is legitimately reached by are not knowable from here: behind a
proxy the `Host` is whatever that proxy forwards.

A deployment that *does* know its names states them with
[`with_allowed_origins()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_allowed_origins):

```rust
let http = HttpServer::new("0.0.0.0:3000")
    .with_allowed_origins(["https://mcp.example.com", "https://app.example.com"]);

App::new()
    .with_options(|opt| opt.set_http(http))
    .run()
    .await;
```

### What an entry means

| Entry | Matches an `Origin` of |
|---|---|
| `https://app.example.com` | that scheme, host **and** port (a missing port means the scheme's default) |
| `app.example.com` | that host on any scheme and any port |
| `app.example.com:8443` | that host on any scheme, narrowed to that port |

Prefer the full origin. A bare host trusts everything served under that
name, including whatever sits on another port — trusting an application
should not mean trusting the rest of its host.

`Host` is matched by hostname against every entry either way: it says where
the request landed rather than who sent it, carries no scheme, and behind a
proxy its port is the proxy's business. Matching is case-insensitive
throughout, loopback is always accepted, and a request carrying neither
header is left alone — it is not from a browser, and there is no rebinding
without a name.

### Turning the gate off

```rust
// A tunnel terminates the browser-facing name and forwards here.
let http = HttpServer::new("127.0.0.1:3000").allow_any_origin();
```

[`allow_any_origin()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.allow_any_origin)
is only meaningful on a loopback bind, where the gate is on by default.
Reach for it when something in front of the server already validates the
name — not to quiet a `403` whose cause has not been read, because that
`403` is the protection working.

:::note Applies to any HTTP engine
The gate lives in the transport core, not in the Volga adapter, so a
[custom HTTP stack](./custom-http) gets the same validation — and the policy
survives `with_engine(...)`, since it is a property of the deployment rather
than of the framework serving it.
:::

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
