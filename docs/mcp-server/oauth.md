---
sidebar_position: 19
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
This page covers OAuth. If your deployment mints its own JWTs, or holds the
issuer's public key, and you only need signature and claim validation,
[JWT authentication](./http#jwt-authentication) is the smaller path — a decoding
key and nothing else. The role, permission and scope gates below, and
[`ctx.claims()`](#who-is-calling), are identical either way.
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
| `with_jwks_uri()` | Fetch the issuer's key set from this URL instead of discovering it — see [below](#an-issuer-the-server-cannot-reach) |
| `with_refresh_cooldown()` | Minimum interval between two JWKS refresh attempts (default 60 s) |
| `with_max_key_age()` | Age after which the cached key set is re-fetched even for known key ids, so a revoked key does not stay trusted (default 15 min) |
| `with_config()` | Escape hatch to the underlying [`volga::auth::OAuthConfig`](https://docs.rs/volga) for knobs with no neva-level counterpart — the HTTP client policy for discovery and key fetches among them |

The `aud`, `iss` and expiry checks come from
[`AuthConfig`](./http#auth-configuration-options) and can be overridden there;
OAuth mode only supplies the defaults.

### An issuer the server cannot reach

Discovery fetches the issuer's metadata from the issuer URL itself, and that
document names the URL twice: as its `issuer`, which must equal the address it
was fetched from, and inside its `jwks_uri`. A server that reaches the issuer
under another name cannot discover it — the issuer runs on the host as
`http://localhost:8787` while the server, in a container, reaches it as
`http://host.docker.internal:8787`; or a Kubernetes service sits behind a public
ingress host. Name the key set directly and discovery is skipped:

```rust
.with_auth(|auth| auth
    .with_oauth(|oauth| oauth
        .with_issuer("http://localhost:8787")
        .with_jwks_uri("http://host.docker.internal:8787/jwks")
        .with_config(|cfg| cfg
            .with_client_config(|c| c.require_https(false)))))
```

`with_issuer` keeps its meaning: tokens must carry it in `iss`, and the metadata
document sends clients to it. Only where the keys come from changes — rotation,
the refresh cooldown and the key age work as they do with discovery. The
transport policy from `with_config` applies to the key URL as well, which is
why the plain-`http` URL above needs `require_https(false)`.

Where no URL serves the keys at all, ship the issuer's public key with the
deployment and validate with it directly —
[`with_decoding_key`](./http#a-public-key) instead of `with_oauth`. That key
does not follow the issuer's rotations. The two modes exclude each other: a
server configured with both a static key and `with_oauth` fails to start.

## Publishing the metadata document

The derived document is usually right. Spell it out when you want to advertise
other scopes than the derived ones, name more than one authorization server, or
correct the resource identifier behind a reverse proxy:

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
| `with_scopes()` | Scope values a client should request. Defaults to every scope the server's items [require](#scopes) |
| `with_resource()` | Canonical resource identifier URI, when the public URL differs from the bind address |
| `with_metadata()` | Full-document escape hatch onto the RFC 9728 builder — `resource_name`, documentation URLs, everything else |

### `scopes_supported`

Left alone, `scopes_supported` lists every scope a tool, prompt or resource
[requires](#scopes), so the document and the gates cannot drift apart. Set
`with_scopes` when a client should start with less than all of them and
[step up](#scopes) for the rest, or to advertise scopes the server checks some
other way; an empty list advertises none. A non-empty `scopes_supported` set
through `with_metadata` replaces the derived list too — an empty one there
reads as unset.

The derived list is built once, at start: an item added while the server runs
is not in it.

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

A token that is valid but too narrow for what it is used on gets a `403`
instead — the [step-up](#scopes) challenge:

```
--> POST /mcp                      Authorization: Bearer <a token granting mcp:tools>
    { "method": "tools/call", "params": { "name": "purge_cache", … } }
<-- 403 Forbidden
    WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:tools mcp:admin", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"
    { "error": { "code": -31403,
                 "data": { "requiredScopes": ["mcp:tools", "mcp:admin"],
                           "missingScopes": ["mcp:admin"] }, … } }
```

## Roles, permissions and scopes

Token claims gate individual primitives exactly as they do under JWT auth:

```rust compile
use neva::prelude::*;

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

/// Requires a token granting both scopes
#[tool(scopes = ["mcp:tools", "mcp:admin"])]
async fn purge_cache() -> &'static str {
    "cache purged"
}
```

The three gates read different claims and fail differently:

| Gate | Satisfied by | A caller short of it gets |
|---|---|---|
| `roles` | **any one** of them, in the token's `role` or `roles` | `InvalidParams` (-32602), in a `200` |
| `permissions` | **any one** of them, in `permissions` | `InvalidParams` (-32602), in a `200` |
| `scopes` | **every one** of them, in the token's `scope` | `403` with an `insufficient_scope` challenge, and `InsufficientScope` (-31403) |

Declared together, every gate must pass. The builder form is
`with_roles([..])`, `with_permissions([..])` and `with_scopes([..])` on a
`Tool`, `Prompt`, `ResourceTemplate` or
[`UiResource`](./apps#authorization).

### Scopes

A role or a permission is a decision about the caller, and no new token changes
it. A scope is a grant the caller can ask for — so a scope refusal is the one a
client can act on. It is answered before the request is dispatched, with a
`403` whose `WWW-Authenticate` challenge names **every** scope the item
requires (RFC 6750 §3.1), and the JSON-RPC error carries the same list as
`requiredScopes` plus the ones the token lacks as `missingScopes`. The client
re-authorizes for those scopes and retries; a [neva client](../mcp-client/oauth#stepping-up)
does that by itself.

* **A gated item stays in its listing.** `tools/list` still shows
  `purge_cache`: a client has to see a tool before it can step up for it.
* **A missing role outranks a missing scope.** When an item requires both and
  the caller has neither, the refusal is the role's `InvalidParams` — no client
  is sent off to re-authorize for a call that would be refused again.
* **Streams and batches step up too.** The check runs before dispatch, so a
  request that would have opened an event stream gets its `403` first. A batch
  with any request short of a scope is refused whole, for the union of the
  scopes, and its other requests are answered "not processed" — the client sends
  all of it again with the wider token.
* **`ErrorCode::InsufficientScope` is neva's own code.** MCP allocates none for
  this, so neva takes `-31403`, outside the range JSON-RPC reserves, where no
  later MCP code can land on it.

By default the metadata document advertises every declared scope as
[`scopes_supported`](#scopes_supported).

## Who is calling

A handler asks for the claims of the caller's token with
[`ctx.claims()`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.claims):

```rust compile
use neva::prelude::*;

#[tool]
async fn whoami(ctx: Context) -> Result<String, Error> {
    let Some(caller) = ctx.claims() else {
        return Err(Error::new(ErrorCode::InvalidRequest, "no authenticated caller"));
    };
    // A subject is unique only within its issuer: key per-user data by both.
    Ok(format!(
        "{} from {}",
        caller.subject().unwrap_or("nobody"),
        caller.issuer().unwrap_or("no issuer")
    ))
}
```

| Method | Claim |
|---|---|
| `subject()` | `sub` — who the token was issued for |
| `issuer()` | `iss` — who issued it |
| `audience()` | `aud` — every audience it names, one or several |
| `client_id()` | `client_id` ([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068)) — the OAuth client acting for the subject, e.g. the agent that made the call |
| `scopes()` | `scope`, split into one scope per element |
| `role()` / `roles()` / `permissions()` | What the role and permission gates check |

It is `None` without an authenticated caller: a server with no bearer auth, or
a build without an HTTP transport, where the call still compiles and always
answers `None`. A [middleware](./middlewares#who-is-calling) reads the same
claims through `MwContext::claims()`.

`claims()` returns a `&dyn Claims`. The concrete type is behind it —
[`DefaultClaims`](https://docs.rs/neva/latest/neva/auth/struct.DefaultClaims.html)
under the bundled Volga engine, whatever a [custom engine](./custom-http#authentication)
decoded under one of your own — and `downcast_ref` gets it back, for the claims
the trait does not expose:

```rust compile-fragment
use neva::prelude::*; // DefaultClaims is in the prelude

let expires = ctx
    .claims()
    .and_then(|c| c.downcast_ref::<DefaultClaims>())
    .and_then(|c| c.exp);
```

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
challenges — the `401` and the `403` step-up — are **engine-neutral**: they live in the transport core, so every
[`HttpEngine`](./custom-http) serves byte-identical bytes. Token *validation*
is the engine's job — the bundled Volga adapter uses Volga's bearer/JWKS
pipeline, and a custom engine brings its own middleware. The protocol types
(`ProtectedResourceMetadata`, `BearerChallenge`, `OAuthError`,
`canonicalize_resource_uri`, …) are re-exported from `neva::auth::oauth` for
exactly that.

## Learn By Example

* [`examples/oauth-server`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-server)
  — a protected resource server against any OAuth 2.1 / OIDC issuer, with a
  scope-gated tool and `OAUTH_JWKS_URI` for an issuer it cannot reach
* [`examples/oauth-with-keycloak`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-with-keycloak)
  — server + client + a ready-made realm
* [`examples/oauth-hyper-engine`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-hyper-engine)
  — the same contract on a custom engine
* [Client → OAuth 2.1](../mcp-client/oauth) — the other half
