---
sidebar_position: 18
---

# OAuth 2.1

[MCP 2026-07-28](../spec-2026-07-28) makes a Streamable HTTP server an **OAuth 2.1
protected resource**: it validates the bearer tokens it is handed against an
authorization server's keys, publishes an
[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) *Protected Resource Metadata*
document, and answers an unauthorized request with a `WWW-Authenticate`
challenge pointing at it. That challenge is the whole discovery story on the
client side — a client that knows nothing but the endpoint URL finds the
authorization server from the `401`.

Enabled by the `server-oauth` feature (included in `server-full`).

:::info Two ways to authenticate
This page covers OAuth. If your deployment mints its own JWTs and you only need
signature and claim validation, [JWT authentication](./http#jwt-authentication)
is the smaller path — `set_decoding_key` and nothing else. The role and
permission gates below are identical either way.
:::

## The smallest protected server

Name an issuer and you have a resource server:

```rust
use neva::prelude::*;

#[tool]
async fn whoami() -> &'static str {
    "an authenticated caller"
}

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

That single `with_issuer` does four things:

* discovers the issuer's metadata and JWKS, and validates every bearer token
  against the keys it finds;
* requires the token's `aud` to contain this server's canonical resource URI
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)) — a token minted for
  another resource is refused rather than accepted because it happens to be
  valid;
* requires `iss` to match the configured issuer;
* derives the Protected Resource Metadata document from the issuer and serves
  it at the well-known path, so `with_oauth_metadata` below is optional.

An issuer is **mandatory** in OAuth mode: a build that configures
`with_oauth` without one fails at server start rather than accepting
unvalidated tokens.

### Token validation options

| Method | Description |
|---|---|
| `with_issuer()` | Issuer identifier URL whose keys validate tokens. Mandatory |
| `with_refresh_cooldown()` | Minimum interval between two JWKS refresh attempts (default 60 s) |
| `with_max_key_age()` | Age after which the cached key set is re-fetched even for known key ids, so a revoked key does not stay trusted (default 15 min) |
| `with_config()` | Escape hatch to the underlying [`volga::auth::OAuthConfig`](https://docs.rs/volga) for knobs with no neva-level counterpart |

The `aud`, `iss` and expiry checks come from
[`AuthConfig`](./http#auth-configuration-options) and can be overridden there;
OAuth mode only supplies the defaults.

## Publishing the metadata document

The derived document is usually right. Spell it out when you want to advertise
scopes, name more than one authorization server, or correct the resource
identifier behind a reverse proxy:

```rust
App::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("127.0.0.1:3000")
            .with_oauth_metadata(|oauth| oauth
                .with_authorization_servers(["https://auth.example.com"])
                .with_scopes(["mcp:tools", "mcp:resources"]))
            .with_auth(|auth| auth
                .with_oauth(|oauth| oauth
                    .with_issuer("https://auth.example.com")))))
    .run()
    .await;
```

| Method | Description |
|---|---|
| `with_authorization_servers()` | Issuer identifiers that can authorize access to this server |
| `with_scopes()` | Scope values a client should request |
| `with_resource()` | Canonical resource identifier URI, when the public URL differs from the bind address |
| `with_metadata()` | Full-document escape hatch onto the RFC 9728 builder — `resource_name`, documentation URLs, everything else |

### Behind a reverse proxy

The resource identifier defaults to the server's own URL (`proto://addr/endpoint`),
which is the bind address — not what clients type. Terminating TLS in front of
the server, or mapping the endpoint to a different path, makes those two
disagree, and a token whose `aud` names the public URL is then rejected by a
server that expects the private one. State the public URL:

```rust
.with_oauth_metadata(|oauth| oauth
    .with_resource("https://api.example.com/mcp"))
```

The value is canonicalized per RFC 8707 — scheme and host lowercased, default
ports dropped — so the string you write and the string a client derives agree.

## What a client sees

```
--> POST /mcp                      (no Authorization header)
<-- 401 Unauthorized
    WWW-Authenticate: Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"

--> GET  /.well-known/oauth-protected-resource/mcp
<-- 200 { "resource": "https://api.example.com/mcp",
          "authorization_servers": ["https://auth.example.com"],
          "scopes_supported": ["mcp:tools", "mcp:resources"] }
```

From there the client discovers the authorization server, obtains a token and
retries. [Client → OAuth 2.1](../mcp-client/oauth) is that half; a neva client
runs the whole sequence behind `connect()`.

## Roles and permissions

Token claims gate individual primitives exactly as they do under JWT auth —
access is denied with `403 Forbidden` when the token does not satisfy the
declaration:

```rust
/// Any authenticated caller
#[tool]
async fn whoami() -> &'static str {
    "an authenticated caller"
}

/// Admins only
#[tool(roles = ["admin"])]
async fn admin_report(name: String) -> String {
    format!("confidential report: {name}")
}

/// Requires the "read" permission
#[resource(uri = "res://restricted/{name}", permissions = ["read"])]
async fn restricted_resource(uri: Uri, name: String) -> (String, String) {
    (uri.to_string(), name)
}
```

See [Role-Based Access Control](./http#role-based-access-control).

## A local development issuer

Discovery rejects plain-`http` issuers by default. Against a local Keycloak or
similar, drop that requirement — and only there:

```rust
.with_auth(|auth| auth
    .with_oauth(|oauth| oauth
        .with_issuer("http://localhost:8080/realms/neva")
        .with_config(|cfg| cfg
            .with_client_config(|c| c.require_https(false)))))
```

## On a custom HTTP stack

The metadata document, its well-known path and the `WWW-Authenticate`
challenge are **engine-neutral**: they live in the transport core, so every
[`HttpEngine`](./custom-http) serves byte-identical bytes. Token *validation*
is the engine's job — the bundled Volga adapter uses Volga's bearer/JWKS
pipeline, and a custom engine brings its own middleware. The protocol types
(`ProtectedResourceMetadata`, `BearerChallenge`, `OAuthError`,
`canonicalize_resource_uri`, …) are re-exported from `neva::auth::oauth` for
exactly that.

## Learn By Example

* [`examples/oauth-server`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-server)
  — a protected resource server against any OAuth 2.1 / OIDC issuer
* [`examples/oauth-with-keycloak`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-with-keycloak)
  — server + client + a ready-made realm
* [`examples/oauth-hyper-engine`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-hyper-engine)
  — the same contract on a custom engine
* [Client → OAuth 2.1](../mcp-client/oauth) — the other half
