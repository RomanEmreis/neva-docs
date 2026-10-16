---
sidebar_position: 8
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
and SSE `GET` streams with `Last-Event-ID` replay — a session hosts as many at
once as the client opens, each with its own cursor. See
[Legacy spec → Concurrent SSE streams](../legacy-spec#concurrent-sse-streams).
:::

## Running More Than One Instance

Because the transport is stateless, a multi round-trip request can land on
any instance — so shared resources become mandatory as soon as you run more
than one:

```rust
App::new()
    // Without this, cross-instance retries cannot decrypt `requestState`.
    // neva warns at startup if it is missing.
    .with_request_state_secret(std::env::var("MCP_STATE_SECRET").unwrap().as_bytes())
    // Without this, a lost-response retry re-runs the handler and
    // double-fires `on_commit`. The default store is per-process.
    .with_request_state_store(my_redis_store)
    // Without this, a subscriber on one instance never hears about a
    // mutation that happened on another.
    .with_notification_bus(my_redis_bus)
    .with_options(|opt| opt.with_default_http())
    .run()
    .await;
```

| Setting | Protects against |
|---|---|
| [`with_request_state_secret`](../spec-2026-07-28.md#deployment-must-do-for-multi-instance-http) | A cross-instance MRTR retry that cannot decrypt its `requestState` |
| `with_request_state_store` | A lost-response retry re-running the handler and double-firing `on_commit` |
| [`with_notification_bus`](./subscriptions#running-more-than-one-instance) | A [subscription](./subscriptions) stream held on one instance missing what another instance produced |

Where several services share one `with_request_state_secret`, add
[`with_request_state_audience`](../spec-2026-07-28.md#binding-state-to-the-service)
so a state minted by one is not a state the others accept.

See [Deployment must-do for multi-instance HTTP](../spec-2026-07-28.md#deployment-must-do-for-multi-instance-http)
for what the secret protects and how to rotate it.

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

Whether an address counts as loopback is decided the way `std` reads a bind
string, so an unbracketed IPv6 address works: `bind("::1:3000")` listens on
`[::1]:3000` and gets the loopback policy. Bracket it anyway — `[::1]:3000`
says what it means without relying on the last-colon rule.

An `Origin` carrying userinfo is matched on its real host, not on the name in
front of the `@`: `https://app.example.com:8443@evil.com` is `evil.com`.

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
| `set_decoding_key()` | HMAC secret the tokens are signed with (`HS256`, `HS384`, `HS512`) |
| `with_decoding_key()` | Any [`DecodingKey`](https://docs.rs/neva/latest/neva/auth/struct.DecodingKey.html): an HMAC secret, or the public half of an RSA, EC or Ed25519 key pair, from PEM or a JSON Web Key — see [A public key](#a-public-key) |
| `with_alg()` | Accepted signing algorithms. The first call **replaces** the default `HS256`; later calls add to it |
| `with_aud()` | Accepted token audience values |
| `with_iss()` | Accepted token issuer values. A token without `iss` is refused |
| `validate_exp()` | Whether to validate the token expiration (default `true`) |
| `require_https()` | Whether the MCP endpoint refuses plain HTTP from a peer that is not loopback (default `true`) — see [Plain HTTP behind a proxy](#plain-http-behind-a-proxy) |

A key whose family does not match the accepted algorithms — an EC key left on
the default `HS256`, say — fails the server start instead of refusing every
token later.

### Plain HTTP behind a proxy

With authentication on, the MCP endpoint takes requests over HTTPS. A request
over plain HTTP from a peer that is not loopback is refused before its token is
read: `400 Bad Request` with
`WWW-Authenticate: Bearer error="invalid_request", error_description="HTTPS required"`.
A server that terminates TLS itself ([`with_tls`](#tls)) is never refused, and
neither is a loopback peer, so local development needs nothing.

Where TLS ends *in front of* the server, every request arrives over plain HTTP
from the address of whatever ended it: a reverse proxy or an ingress, a service
mesh sidecar, or a container's published port, which reaches the server from
the bridge gateway rather than from loopback. Turn the check off there:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let secret = std::env::var("JWT_SECRET")
        .expect("JWT_SECRET must be set");

    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("0.0.0.0:3000")
                .with_auth(|auth| auth
                    .set_decoding_key(secret.as_bytes())
                    // TLS ends at the ingress
                    .require_https(false))))
        .run()
        .await;
}
```

The server does not read `X-Forwarded-Proto`, so with the check off it takes a
token from any peer that reaches it. Never turn it off on a server reachable
directly over plain HTTP. Only the MCP endpoint is checked: the
[metadata document](./oauth#publishing-the-metadata-document) answers either way.

:::note Two settings named `require_https`
This one decides what the server **accepts**. The one in an OAuth
configuration's `with_client_config` decides which URLs the server **fetches**
the issuer's keys from — see
[A local development issuer](./oauth#a-local-development-issuer).
:::

### A public key

An authorization server signs its tokens with a private key and publishes the
public half. Where the server cannot fetch it — no route to the issuer at all —
ship the public key with the deployment and validate with it directly:

```rust compile
use neva::{prelude::*, auth::{Algorithm, DecodingKey}};

#[tokio::main]
async fn main() {
    // the issuer's public key, shipped with the deployment
    let key = DecodingKey::from_pem_file("/etc/mcp/issuer.pem");

    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .with_auth(|auth| auth
                    .with_decoding_key(key)
                    .with_alg(Algorithm::ES256)
                    .with_iss(["https://auth.example.com"])
                    .with_aud(["https://mcp.example.com/mcp"]))))
        .run()
        .await;
}
```

`DecodingKey::from_jwk(..)` takes one entry of the issuer's JWKS instead of a
PEM file. Either way the key does not follow the issuer's rotations: a re-keyed
issuer means a restart with the new key. Where the key set can be fetched from
*some* URL, [OAuth mode with `with_jwks_uri`](./oauth#an-issuer-the-server-cannot-reach)
tracks rotations instead. A static key and OAuth mode exclude each other — a
server configured with both fails to start.

## Role-Based Access Control

Once authentication is configured, you can restrict access to individual tools, prompts, and resources using `roles`, `permissions` and `scopes` attributes:

```rust compile
use neva::prelude::*;

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

/// Only accessible with a token granting both scopes
#[tool(scopes = ["notes:read", "notes:write"])]
async fn edit_note(id: String, text: String) -> String {
    format!("note {id}: {text}")
}
```

Roles, permissions and scopes are read from the token's claims. Any one of the
listed roles or permissions is enough, and a caller holding none of them is
refused with `InvalidParams` (-32602). Scopes are a grant the caller can widen,
so **every** listed scope is required, and a token short of one is answered
with `403` and an `insufficient_scope` challenge the client can re-authorize
on — see [Roles, permissions and scopes](./oauth#roles-permissions-and-scopes).

A handler reads the same claims with [`ctx.claims()`](./oauth#who-is-calling).

:::tip Tokens from an authorization server
A static key fits a deployment that mints its own JWTs, or one that holds the
issuer's public key. To validate tokens issued by an OAuth 2.1 / OIDC provider
against its JWKS — following its key rotations, with the RFC 9728 metadata
document and the `401` challenge that lets clients discover it — see
[OAuth 2.1](./oauth). The gates above are identical either way.
:::

## Blocking Runner

For use cases where you need a synchronous entry point (e.g., embedding in a non-async context), you can use [`run_blocking()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.run_blocking) instead of `.run().await`:

```rust
fn main() {
    App::new()
        .with_options(|opt| opt.with_default_http())
        .run_blocking();
}
```

## Stopping the Server

Both runners stop on `SIGINT` / `SIGTERM` with no configuration. To stop one
from your own code — a test, or neva embedded in a service that owns its
lifecycle — see [Graceful Shutdown](./shutdown).

## Testing with MCP Inspector

To test a Streamable HTTP server using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), start your server first:

```bash
cargo run
```

Then open the Inspector and connect to `http://127.0.0.1:3000/mcp`.

## Learn By Example

* [HTTP server](https://github.com/RomanEmreis/neva/tree/main/examples/http)
* [Protected server with JWT auth](https://github.com/RomanEmreis/neva/tree/main/examples/protected-server)
* [OAuth 2.1 resource server](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-server)
* [Sampling server with TLS](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/server)
* [Custom HTTP stack (axum)](https://github.com/RomanEmreis/neva/tree/main/examples/axum)
* [Custom HTTP stack (hyper)](https://github.com/RomanEmreis/neva/tree/main/examples/hyper)
* [Custom HTTP stack (actix-web)](https://github.com/RomanEmreis/neva/tree/main/examples/actix)
