# Transports, security and deployment

## Choosing a transport

| Transport | When | Server | Client |
|---|---|---|---|
| `stdio` | The client spawns the server as a child process — desktop assistants, CLI tools | `opt.with_stdio()` | `opt.with_stdio("cmd", ["args"])` |
| Streamable HTTP | A network service, several clients, containers | `opt.with_http(...)` / `opt.with_default_http()` | `opt.with_http(...)` / `opt.with_default_http()` |

Nothing else in your code changes between them.

## The HTTP transport is stateless

Under MCP 2026-07-28 it is request/response only:

* no `Mcp-Session-Id`, no session `DELETE`;
* no standalone SSE `GET` stream — server pushes ride a client-opened
  `subscriptions/listen` request;
* every request carries `MCP-Protocol-Version` plus mandatory `_meta` keys
  for the protocol version and the client's capabilities;
* routing headers (`Mcp-Method`, `Mcp-Name`, `Mcp-Param-{name}`) must agree
  with the body or the request is rejected with `HeaderMismatch`
  (`-32020`) and HTTP `400`.

A `POST` gets a `text/event-stream` reply in exactly three cases: its
`_meta` carries `io.modelcontextprotocol/logLevel`, its `_meta` carries a
`progressToken`, or it is a `subscriptions/listen` request. Everything else
gets a single JSON object.

## Server setup

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")
                .with_endpoint("/mcp")))
        .run()
        .await;
}
```

`with_default_http()` is `127.0.0.1:3000` + `/mcp`.

### TLS

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let http = HttpServer::new("localhost:7878")
        .with_tls(|tls| tls.with_dev_cert(DevCertMode::Auto));

    App::new()
        .with_options(|opt| opt.set_http(http))
        .run()
        .await;
}
```

`DevCertMode::Auto` generates a self-signed certificate for local
development. In production supply your own certificate and key.

### JWT authentication

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");

    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .with_auth(|auth| auth
                    .with_aud(["my-service"])
                    .with_iss(["my-issuer"])
                    .set_decoding_key(secret.as_bytes()))))
        .run()
        .await;
}
```

| Method | Purpose |
|---|---|
| `set_decoding_key()` | Secret or public key verifying signatures |
| `with_aud()` | Accepted audiences |
| `with_iss()` | Accepted issuers |
| `validate_exp()` | Validate expiry (default `true`) |

Roles and permissions then gate individual primitives, answering `403` when
a token does not satisfy them:

```rust
use neva::prelude::*;

#[tool(roles = ["admin"])]
async fn admin_tool(name: String) {
    tracing::info!("admin tool for {name}");
}

#[resource(uri = "res://restricted/{name}", permissions = ["read"])]
async fn restricted_resource(uri: Uri, name: String) -> (String, String) {
    (uri.to_string(), name)
}
```

### OAuth 2.1 — server side

`server-oauth` (in `server-full`) makes the server an OAuth 2.1 **protected
resource**: it validates bearer tokens against an issuer's JWKS, publishes
the RFC 9728 Protected Resource Metadata document, and answers an
unauthorized request with a `WWW-Authenticate` challenge pointing at it —
which is how a client discovers the authorization server from the `401`.

One call is a working resource server:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")
                .with_auth(|auth| auth
                    .with_oauth(|oauth| oauth
                        .with_issuer("https://auth.example.com")))))
        .run()
        .await;
}
```

`with_issuer` is **mandatory** in OAuth mode — a build without one fails at
server start rather than accepting unvalidated tokens. It also applies the
MCP defaults: the token's `aud` must contain this server's canonical
resource URI (RFC 8707) and `iss` must match, and the metadata document is
derived from the issuer.

Spell the document out to advertise scopes or correct the resource
identifier behind a reverse proxy — the default is the *bind* address, not
the public URL:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")
                .with_oauth_metadata(|oauth| oauth
                    .with_resource("https://api.example.com/mcp")
                    .with_authorization_servers(["https://auth.example.com"])
                    .with_scopes(["mcp:tools"]))
                .with_auth(|auth| auth
                    .with_oauth(|oauth| oauth
                        .with_issuer("https://auth.example.com")))))
        .run()
        .await;
}
```

| On `with_oauth(..)` | |
|---|---|
| `with_issuer(..)` | Issuer whose keys validate tokens. Mandatory |
| `with_refresh_cooldown(..)` | Minimum interval between JWKS refreshes (default 60 s) |
| `with_max_key_age(..)` | Re-fetch the key set even for known kids after this (default 15 min) |
| `with_config(\|cfg\| cfg.with_client_config(\|c\| c.require_https(false)))` | Local dev issuer over plain http |

The metadata document, its well-known path and the challenge are
engine-neutral, so a custom `HttpEngine` serves identical bytes; token
*validation* is the engine's job.

### OAuth 2.1 — client side

`client-oauth` (in `client-full`). The first `401` drives everything:
discovery, obtaining a `client_id`, the grant, attaching the token, and
refreshing it afterwards. `with_oauth(|oauth| oauth)` is a complete
configuration.

```rust
use neva::prelude::*;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")
                .with_oauth(|oauth| oauth))
            // The browser round may take a while — the default is 10 s.
            .with_timeout(Duration::from_secs(300)));

    client.connect().await?;
    client.disconnect().await
}
```

**Obtaining a `client_id`** — three mechanisms, tried in the spec's order:

| Priority | Mechanism | Configure |
|---|---|---|
| 1 | Pre-registration | `with_client_id("..")` **plus** `with_issuer("..")` |
| 2 | Client ID Metadata Document (CIMD) — an https URL the server dereferences | `with_client_id_document("https://app.example.com/mcp-client.json")` |
| 3 | Dynamic Client Registration (RFC 7591) — **deprecated** by 2026-07-28 | the fallback; nothing to configure |

`with_issuer` is not optional decoration. A `client_id` and a refresh token
belong to one authorization server; naming it is what makes a stored
refresh token reusable across a restart, and what refuses credentials to a
server that never issued them. **Without `with_issuer` the session
re-authorizes interactively on every start** (0.5.3 tightened this: the
resource alone vouches for the authorization server a flow discovers, and
that is exactly what an attacker controlling the resource rewrites).

A CIMD describes a *public* client, so pairing it with a client secret is
refused. Generate the JSON to host with `client_metadata_document`, listing
every redirect URI the handler may produce — which means pinning the
loopback port:

```rust
use neva::auth::oauth::OAuthClientConfig;

fn main() -> Result<(), neva::error::Error> {
    let config = OAuthClientConfig::default()
        .with_client_id_document("https://app.example.com/mcp-client.json");

    let document = config.client_metadata_document([
        "http://127.0.0.1:8919/callback",
        "http://localhost:8919/callback",
    ])?;

    println!("{}", serde_json::to_string_pretty(&document).unwrap());
    Ok(())
}
```

**Grants.** Authorization code + PKCE is the default and needs a browser.
Three profiles authenticate the client itself, for deployments with no user:

```rust
use neva::prelude::*;

fn main() {
    // RFC 6749 §4.4 — client credentials
    let _ = Client::new().with_options(|opt| opt
        .with_http(|http| http
            .with_oauth(|oauth| oauth
                .with_client_id("mcp-service")
                .with_client_secret("s3cret")
                .with_client_credentials())));
}
```

| Grant | Use | Notes |
|---|---|---|
| authorization code + PKCE | default, a user is present | runs through the `AuthorizationHandler` |
| `with_client_credentials()` | a service, no user | requires a configured `client_id`; no refresh token, so renewal is the grant run again, proactively |
| `with_jwt_bearer(provider)` | workload identity federation (RFC 7523 §2.1) | `provider` is asked per token request, so a rotating credential is read fresh; a `String` is itself an `AssertionProvider` |
| `with_identity_assertion(..)` | enterprise SSO | sugar over `with_jwt_bearer`; `IdentityAssertion` runs the RFC 8693 exchange at the IdP |

For all three the `AuthorizationHandler` is never called and no redirect
listener is bound. **A refusal ends the call** — the client presented the
only credential it has and neither resends it nor tries another grant.

**Authenticating to the token endpoint.** A secret goes as HTTP Basic
unless the server advertises only `client_secret_post`. Better, behind
`client-oauth-jwt` (in `client-full`), is a signed assertion:

```rust
use neva::prelude::*;
use neva::auth::oauth::{JwsAlgorithm, PrivateKeyJwt};

fn main() -> Result<(), neva::auth::oauth::ClientError> {
    let key = PrivateKeyJwt::from_pem(b"-----BEGIN PRIVATE KEY-----", JwsAlgorithm::ES256)?;

    let _ = Client::new().with_options(|opt| opt
        .with_http(|http| http
            .with_oauth(|oauth| oauth
                .with_client_id("mcp-service")
                .with_private_key_jwt(key)
                .with_client_credentials())));
    Ok(())
}
```

Paired with a CIMD this is what lets an unregistered client authenticate at
all. The document must then carry the verifying key — embedded via
`PrivateKeyJwt::with_public_jwk`, **or** referenced via `with_jwks_uri`,
exactly one of the two (RFC 7591 §2). `client_metadata_document` refuses to
emit a document that declares `private_key_jwt` with neither.

**DPoP** (`client-oauth-dpop`, in `client-full`) binds every token to a key
the client holds, so a stolen token is worth nothing:

```rust
use neva::prelude::*;
use neva::auth::oauth::Dpop;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key = Dpop::generate()?;

    let _ = Client::new().with_options(|opt| opt
        .with_http(|http| http
            .with_oauth(|oauth| oauth.with_dpop(key))));
    Ok(())
}
```

| | |
|---|---|
| default | bearer tokens; DPoP never turns itself on |
| `with_dpop(key)` | always DPoP, and **refuses** a server that answers with an unbound token |
| `with_dpop_auto()` | mints an `ES256` key where a server asks (a `DPoP` challenge, or `dpop_signing_alg_values_supported`), bearer elsewhere — the setting for servers you do not control |

Two things to know: a **DPoP connection does not follow HTTP redirects** (a
proof covers one method and one URL, so a `3xx` is surfaced as itself), and
DPoP is scored as an extension — SEP-1932 is unmerged and it appears
nowhere in the 2026-07-28 text.

**Other knobs:** `with_scopes([..])` (defaults to the resource's
`scopes_supported`), `require_https(false)` (local dev issuers only),
`with_token_store(..)` (the default is in-process; the key is
`{issuer}|{client}|{resource}` as of 0.5.3, so entries written by 0.5.2 are
not found and those sessions re-authorize once), `with_handler(..)` (replace
the browser round; `LoopbackHandler::new().with_port(8919)` pins the port a
registered redirect URI needs).

### DNS-rebinding protection

A server on loopback is reachable by any page the browser loads: point
`evil.example.com` at `127.0.0.1` and the browser connects. The request is
genuinely local; the name it was addressed by is what gives the attack
away. neva validates `Origin` and `Host` and answers `403` before reading
the body.

**The default needs no call.** Bound to loopback, only loopback names are
accepted — `localhost`, `127.0.0.0/8`, `[::1]` — on any port. Bound to
anything else, everything is accepted, because the legitimate names are not
knowable from there.

Fixed in 0.5.4: `bind("::1:3000")` now gets the protection. `std` reads the
last colon of an unbracketed IPv6 string as the port separator, so that
address listens on `[::1]:3000` — but the policy read the string whole,
where it parses as the *different*, non-loopback `::1:3000`, and the server
silently defaulted to `allow_any_origin`. On 0.5.3 or earlier, write
`[::1]:3000`.

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let http = HttpServer::new("0.0.0.0:3000")
        .with_allowed_origins(["https://mcp.example.com", "https://app.example.com"]);

    App::new()
        .with_options(|opt| opt.set_http(http))
        .run()
        .await;
}
```

| Entry | Matches an `Origin` of |
|---|---|
| `https://app.example.com` | that scheme, host **and** port (missing port = the scheme's default) |
| `app.example.com` | that host, any scheme, any port |
| `app.example.com:8443` | that host, any scheme, that port |

Prefer the full origin — a bare host trusts everything served under that
name, including other ports. `Host` is matched by hostname either way.
Matching is case-insensitive, loopback is always accepted, and a request
with neither header is left alone.

`HttpServer::new("127.0.0.1:3000").allow_any_origin()` turns the gate off.
Only meaningful on a loopback bind, and only when something in front
already validates the name — not to silence a `403` whose cause has not
been read.

## Client setup

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("localhost:7878")
                .with_tls(|tls| tls.with_certs_verification(false))   // dev only
                .with_auth("eyJhbGci...")));

    client.connect().await?;
    client.disconnect().await
}
```

`with_auth(token)` sends `Authorization: Bearer <token>` on every request —
for a token the application already holds. Against a server fronted by an
authorization server use `with_oauth(..)` instead (above): the client
discovers, registers, authorizes and refreshes on its own.

Never disable certificate verification outside local development.

## A custom HTTP stack

`http-server` ships the engine-agnostic abstractions with **no** framework;
`http-server-volga` is the bundled default. To host the MCP endpoint on
axum, hyper, actix-web or your own adapter, implement `HttpEngine` and wire
it in:

```toml
neva = { version = "0.5", features = ["server-macros", "http-server", "tracing", "di", "tasks"] }
axum = "0.8"
```

```rust
// HttpServer::from_engine(my_engine) — then the usual
// opt.set_http(server). Auth, TLS and role gates are configured the
// same way; the DNS-rebinding gate lives in the transport core, so a
// custom engine gets it too and it survives `with_engine(...)`.
```

Working adapters live in the neva repository under `examples/axum`,
`examples/hyper` and `examples/actix`.

## Running more than one instance

Mandatory once you scale past one process, because a multi-round request
can land anywhere and a subscription stream is held by exactly one process:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_request_state_secret(std::env::var("MCP_STATE_SECRET").unwrap().as_bytes())
        .with_request_state_audience("https://weather.example.com/mcp")
        .with_options(|opt| opt.with_default_http())
        .run()
        .await;
}
```

| Setting | Without it |
|---|---|
| `with_request_state_secret(..)` | A cross-instance MRTR retry cannot decrypt its `requestState`. neva warns at startup |
| `with_request_state_store(<shared store>)` | A lost-response retry re-runs the handler and double-fires `on_commit`. The default store is per-process |
| `with_notification_bus(<shared bus>)` | **0.5.3.** A subscriber on one instance never hears a mutation produced on another — see `server.md` |
| `with_request_state_audience(..)` | **0.5.3.** Where several services share one state secret, a state minted by one is accepted by the others |

`with_request_state_audience` must be **identical on every instance of the
same service**. The check runs both ways — a state naming an audience is
refused by a server configuring none — and an audience-bound state is
sealed under wire version `v2.` so a binary predating the option refuses it
rather than dropping the field it does not know.

See `mrtr.md` for what each protects and why the state is sealed rather
than signed.

## Stopping a server

Signals (`SIGINT` / `SIGTERM`) work with no configuration. **New in 0.5.4:**
stop one from code — a test, or neva embedded in a service that owns its
lifecycle:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let (app, shutdown) = App::new()
        .with_options(|opt| opt.with_default_http())
        .with_shutdown();

    let server = tokio::spawn(app.run());

    shutdown.shutdown();
    server.await.expect("the server task panicked");
}
```

`ShutdownHandle` **composes with** the signal handler rather than replacing
it, so Ctrl+C still works. `shutdown()` only *requests* the stop — await
`run()` to know the server finished. `with_shutdown_signal(handle)` takes a
handle you already own; `ShutdownHandle::from_token(token)` wraps an
existing `CancellationToken`.

Shutdown is two-phase under 2026-07-28: the signal ends the live
`subscriptions/listen` streams and waits for their graceful empty results to
reach the wire, then the transport goes down and the writers drain.
`App::with_shutdown_drain(Duration)` caps the whole teardown — 2 seconds by
default, a **ceiling not a delay**, skipped outright when no subscription is
open, and `Duration::ZERO` restores an abrupt close.

Before 0.5.4 clients saw `SubscriptionEnd::Abrupt` at shutdown where
`Graceful` was owed. Under `run_blocking`, take **0.5.5** for the last leg:
there `run` also waits for the transport writers instead of returning on the
same signal that started them draining.

## Feature flags

| Preset | Contains |
|---|---|
| `server-full` | `server-macros`, `tracing`, `http-server-volga`, `server-tls`, `server-oauth`, `di`, `tasks` |
| `client-full` | `client-macros`, `tracing`, `http-client`, `client-tls`, `client-oauth`, `client-oauth-jwt`, `client-oauth-dpop`, `tasks` |
| `full` | both |

Individually: `server`, `server-macros`, `http-server`,
`http-server-volga`, `server-tls`, `server-oauth`; `client`,
`client-macros`, `http-client`, `client-tls`, `client-oauth`,
`client-oauth-jwt`, `client-oauth-dpop`; shared `macros`, `di`, `tasks`,
`tracing`.

`client-oauth-jwt` (`private_key_jwt` client authentication) and
`client-oauth-dpop` (RFC 9449 sender-constrained tokens) are new in 0.5.4.
Both are opt-in because they are the only parts of the OAuth client needing
a JWS signing backend, and both are in `client-full`.

`legacy-spec` is not a capability — it selects the protocol generation and
compiles the other one out. `--all-features` therefore builds the *legacy*
profile; use `--features "server-full client-full"` for the default one.

Minimal builds worth knowing:

```toml
# stdio-only server, macros, no HTTP
neva = { version = "0.5", features = ["server-macros", "tracing"] }

# lightweight HTTP client
neva = { version = "0.5", features = ["http-client"] }

# a server that is also a client (agent pattern)
neva = { version = "0.5", features = ["server-full", "http-client"] }
```

## Testing a server

```bash
npx @modelcontextprotocol/inspector cargo run     # stdio
```

For HTTP, run the server and connect the Inspector to
`http://127.0.0.1:3000/mcp`.
