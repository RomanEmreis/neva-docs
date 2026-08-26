---
sidebar_position: 12
---

# OAuth 2.1

A neva client authorizes itself. Point it at a protected server, call
`connect()`, and the first `401` drives the whole sequence: read the
`WWW-Authenticate` challenge, fetch the
[Protected Resource Metadata](../mcp-server/oauth#publishing-the-metadata-document),
discover the authorization server, obtain a `client_id`, run a grant, attach
the token — and refresh it transparently from then on.

Enabled by the `client-oauth` feature (included in `client-full`).

## The smallest configuration

Everything is optional. `with_oauth(|oauth| oauth)` is a complete
configuration:

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
            // The first request may wait for the user to finish in the
            // browser — give it more than the default 10 seconds.
            .with_timeout(Duration::from_secs(300)));

    client.connect().await?;

    let result = client.call_tool("whoami", ()).await?;
    println!("{:?}", result.content);

    client.disconnect().await
}
```

With nothing configured: the client registers dynamically, requests the
resource's advertised `scopes_supported`, opens the system browser for the
authorization-code + PKCE round, catches the redirect on an ephemeral loopback
port, and keeps the token in an in-process store.

## Obtaining a `client_id`

MCP defines three registration mechanisms and a priority order among them,
which the configuration follows:

| Priority | Mechanism | Configure with |
|---|---|---|
| 1 | **Pre-registration** — credentials issued out of band | `with_client_id(..)`, bound to its server with `with_issuer(..)` |
| 2 | **Client ID Metadata Document (CIMD)** — an https URL the authorization server dereferences | `with_client_id_document(url)` |
| 3 | **Dynamic Client Registration** (RFC 7591) — the fallback, **deprecated** by the 2026-07-28 spec | nothing; it is what happens when neither of the above is configured |

A server offering none of the three is refused **before the browser opens**,
naming `with_client_id` as the way out — rather than spending a user
interaction on an id that cannot be obtained.

### Pre-registered credentials

```rust
.with_oauth(|oauth| oauth
    .with_client_id("mcp-cli")
    .with_issuer("https://auth.example.com")
    .with_handler(LoopbackHandler::new().with_port(8919)))
```

`with_issuer` is not decoration. A `client_id` is issued by one authorization
server and means nothing at another, and neither does a refresh token. Naming
the issuer is what lets the client tell *the same server as before* from *the
resource now points somewhere else*:

* pre-registered credentials meeting a different issuer fail, naming both,
  instead of being presented to a server that never issued them;
* a stored refresh token is only ever offered to the server that minted it.

:::warning A stored refresh token needs `with_issuer`
A refresh token is a bearer credential for its token endpoint, and the
authorization server a flow discovers is vouched for by the resource alone —
exactly what an attacker controlling the resource rewrites. Since **0.5.3**
the after-restart refresh therefore requires `with_issuer` and reads the token
back under it. Without one the session re-authorizes interactively; pointing
`with_issuer` at a new server does not carry the old server's token over, and
dynamically registered clients never reuse one.
:::

### Client ID Metadata Documents

CIMD is the forward path for a client and server with no prior relationship:
the `client_id` **is** an https URL, and the authorization server dereferences
it for the client's metadata. No registration request at all.

```rust
.with_oauth(|oauth| oauth
    .with_client_id_document("https://app.example.com/mcp-client.json")
    .with_handler(LoopbackHandler::new().with_port(8919)))
```

The URL must use `https` and carry a path component; it is checked when the
client connects, so a malformed one fails there rather than mid-flow. A
document describes a *public* client, so pairing it with `with_client_secret`
is rejected — the document is resolved by whichever authorization server meets
the URL, so there is nobody to have shared a secret with.

Hosting the document is your job — it is a static file. Generate its contents
from the same configuration so the two cannot drift:

```rust
use neva::auth::oauth::OAuthClientConfig;

let config = OAuthClientConfig::default()
    .with_client_id_document("https://app.example.com/mcp-client.json");

let document = config.client_metadata_document([
    "http://127.0.0.1:8919/callback",
    "http://localhost:8919/callback",
])?;

println!("{}", serde_json::to_string_pretty(&document)?);
```

Every redirect URI the handler may produce has to be listed — an authorization
server validates the one it is sent against this list. A `LoopbackHandler` on
an *ephemeral* port therefore cannot be described by any document: pin it with
`with_port` and list both the `127.0.0.1` and `localhost` spellings. A grant
with no redirect (client credentials, JWT bearer) passes an empty list.

## Grants

The authorization-code + PKCE flow is the default and needs a user in front of
a browser. Three profiles authenticate the **client itself**, for a deployment
where there is nobody to prompt:

```rust
// RFC 6749 §4.4 — the client authenticates as itself
.with_oauth(|oauth| oauth
    .with_client_id("mcp-service")
    .with_client_secret("s3cret")
    .with_client_credentials())
```

```rust
// RFC 7523 §2.1 — workload identity federation
.with_oauth(|oauth| oauth
    .with_client_id("customer-router-agent")
    .with_jwt_bearer(workload_jwt))
```

```rust
// The enterprise-managed profile — RFC 8693 at the identity provider,
// then the resulting grant at the resource's authorization server
use neva::auth::oauth::IdentityAssertion;

.with_oauth(|oauth| oauth
    .with_client_id("mcp-app")
    .with_client_secret("s3cret")
    .with_identity_assertion(IdentityAssertion::new(
        "https://acme.idp.example", "idp-app", id_token)))
```

| Grant | When | Notes |
|---|---|---|
| Authorization code + PKCE | Default. A user is present | The browser round runs through the [`AuthorizationHandler`](#the-interactive-step) |
| `with_client_credentials()` | A service with no user | The `io.modelcontextprotocol/oauth-client-credentials` extension. Requires a configured `client_id` — dynamic registration is not used here |
| `with_jwt_bearer(provider)` | A workload that already holds a platform-minted credential (projected service-account token, SPIFFE SVID) | `provider` is asked again for every token request, so a rotating credential is read fresh. A `String` is itself an `AssertionProvider` |
| `with_identity_assertion(..)` | Enterprise SSO | Sugar over `with_jwt_bearer` — `IdentityAssertion` is the provider that runs the RFC 8693 exchange |

Two behaviors worth knowing about the non-interactive grants:

* **Everything ahead of the token request is unchanged** — the `401`,
  discovery, the RFC 8707 resource indicator. The browser round is simply not
  there, so the `AuthorizationHandler` is never called and no redirect
  listener is bound.
* **A refusal ends the call.** The client presented the only credential it
  has; it neither resends it nor reaches for another grant. For client
  credentials, renewal is the grant run again — proactively, because RFC 6749
  §4.4.3 issues no refresh token to renew with.

:::note Two registrations, two servers
For `with_identity_assertion`, the credentials on the `OAuthClientConfig`
belong to the *MCP server's* authorization server, where the grant is
presented. The ones on `IdentityAssertion` belong to the identity provider,
where it is obtained. They are not interchangeable.
:::

## Authenticating to the token endpoint

### A client secret

```rust
.with_oauth(|oauth| oauth
    .with_client_id("mcp-cli")
    .with_client_secret("s3cret"))
```

Sent as HTTP Basic credentials (RFC 6749 §2.3.1) — the preference, and the
fallback for a server that advertises nothing — unless the authorization
server's `token_endpoint_auth_methods_supported` lists only
`client_secret_post`, in which case it travels in the request body instead. A
server that accepts neither fails the flow rather than having the secret sent
a way it said it would refuse.

### `private_key_jwt`

The client signs a short-lived assertion with its own key and nothing it holds
ever leaves the process. This is what the client-credentials extension
RECOMMENDS over a secret. Behind the **`client-oauth-jwt`** feature — it is the
only part of the OAuth client that needs a JWS backend — and enabled by
`client-full`.

```rust
use neva::auth::oauth::{JwsAlgorithm, PrivateKeyJwt};

let key = PrivateKeyJwt::from_pem(pem, JwsAlgorithm::ES256)?;

let client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .with_oauth(|oauth| oauth
                .with_client_id("mcp-service")
                .with_private_key_jwt(key)
                .with_client_credentials())));
```

The assertion *is* the credential, so pairing it with `with_client_secret` is
rejected rather than quietly resolved in the assertion's favour.

**Paired with a CIMD**, a key is what lets a client with no pre-registration
authenticate at all: the server dereferences one URL and learns both who the
client is and which key to verify with. `client_metadata_document` then
publishes the verifying key too — embedded via `PrivateKeyJwt::with_public_jwk`,
or referenced through `with_jwks_uri`:

```rust
let config = OAuthClientConfig::default()
    .with_client_id_document("https://app.example.com/mcp-client.json")
    .with_jwks_uri("https://app.example.com/jwks.json")
    .with_private_key_jwt(key);
```

Exactly one of the two, per RFC 7591 §2: publishing neither is refused when the
document is generated rather than answered `invalid_client` on every token
request afterwards, and publishing both is nonconforming outright.

## DPoP: sender-constrained tokens

A bearer token is a password — whoever steals it may spend it. A DPoP-bound
one ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)) is worth nothing
without the key, because every request carries a proof signed over its own
method and URL and over the token itself. Behind the **`client-oauth-dpop`**
feature, enabled by `client-full`.

```rust
use neva::auth::oauth::Dpop;

let key = Dpop::generate()?;

let client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .with_oauth(|oauth| oauth.with_dpop(key))));
```

| Setting | Behavior |
|---|---|
| *(default)* | Bearer tokens. DPoP is an optional extension and never turns itself on |
| `with_dpop(key)` | Binds every token to `key` and **refuses** an authorization server that answers with an unbound one. `Dpop::generate()` mints a throwaway key per session; `Dpop::from_pem` loads a lasting one whose thumbprint a server was told about out of band |
| `with_dpop_auto()` | Mints an `ES256` key the first time a server asks — by challenging with the `DPoP` scheme (§7.1) or advertising `dpop_signing_alg_values_supported` (§5.1) — and uses bearer tokens elsewhere |

`with_dpop_auto()` is the setting for a client talking to servers it does not
control: it never turns a working bearer flow into a refusal. It does leave the
choice to the server, so a client that must not hold an unbound credential
wants `with_dpop` instead.

Both nonce rounds are answered — the token endpoint's (§8) and the resource's
(§9), the second costing one repeat of the request rather than a
re-authorization, since the token and the key were never in question.

:::warning A DPoP connection does not follow redirects
A proof covers one method and one URL, nothing can re-sign it mid-chain, and
neither retry recovers from a hop that carried the wrong one — so a `3xx` is
surfaced as itself. Bearer connections are unaffected.
:::

:::note An extension, scored as one
SEP-1932 is unmerged and DPoP appears nowhere in the 2026-07-28 text, so
neva's conformance suite scores `auth/dpop` and `auth/dpop-nonce` as
extensions. Both are green on both profiles.
:::

## The interactive step

`AuthorizationHandler` is the seam for the browser round; `LoopbackHandler` is
the default, opening the system browser and catching the redirect on an
ephemeral loopback port.

```rust
use neva::auth::oauth::LoopbackHandler;

.with_oauth(|oauth| oauth
    .with_handler(LoopbackHandler::new().with_port(8919)))
```

Pin the port whenever the authorization server validates redirect URIs against
a registered list — which a pre-registered client and a CIMD-published one both
face. A redirect anywhere in `127.0.0.0/8` registers as a **native** client
(RFC 8252 §7.3), so a handler bound to `127.0.0.2` is not mistaken for a `web`
client and refused for its plain-http redirect URI.

Replace the handler entirely for a headless or GUI-embedded flow — implement
`redirect_uri` and `authorize` and drive the user however your application
does:

```rust
use neva::auth::oauth::{AuthorizationHandler, CallbackParams};
use neva::error::Error;

struct MyUi;

impl AuthorizationHandler for MyUi {
    async fn redirect_uri(&self) -> Result<String, Error> {
        Ok("https://my.app/oauth/callback".into())
    }

    async fn authorize(&self, authorization_url: String) -> Result<CallbackParams, Error> {
        // show `authorization_url` to the user, await the callback,
        // and hand back what the authorization server redirected with
        show_in_app_browser(&authorization_url).await;
        CallbackParams::from_query(&await_callback_query().await)
    }
}
```

`redirect_uri` is called once per flow, before registration — the URI it
returns is what gets registered and sent with the authorization request.

:::warning Plain `async fn`s — changed in 0.5.5
Both methods used to return `neva::shared::BoxFuture`, so every implementation
opened with `Box::pin(async move { … })`. That was a fact about how the
configuration keeps the handler — behind `Arc<dyn ..>` — rather than about the
seam you implement, and the boxing has moved to an internal bridge.

To migrate, drop the wrapper:

```rust
// 0.5.4
fn redirect_uri(&self) -> BoxFuture<'_, Result<String, Error>> {
    Box::pin(async { Ok("https://my.app/oauth/callback".into()) })
}

// 0.5.5
async fn redirect_uri(&self) -> Result<String, Error> {
    Ok("https://my.app/oauth/callback".into())
}
```

The futures still have to be `Send`, which an `async fn` holding nothing
thread-bound across an `.await` already satisfies. Users of the default
`LoopbackHandler` have nothing to change.
:::

## Storing tokens

The default store is in-process: tokens live as long as the client does. Give
it an encrypted file or an OS keychain to survive a restart:

```rust
.with_oauth(|oauth| oauth
    .with_issuer("https://auth.example.com")
    .with_token_store(my_keychain_store))
```

:::warning The store key changed in 0.5.3
An entry is filed under `{issuer}|{client}|{resource}` — the whole identity a
credential belongs to — rather than the resource alone, so two servers (or two
clients sharing one durable store) never share a slot. Entries written by an
earlier version are not found under the new key and are left in place; the
affected sessions re-authorize once.
:::

## Configuration reference

| Method | Description |
|---|---|
| `with_client_id(..)` | A pre-registered client id |
| `with_client_id_document(url)` | Identify by CIMD; `url` is both the id and where its metadata is hosted |
| `with_issuer(..)` | The authorization server the configured credentials belong to |
| `with_client_secret(..)` | Confidential client authenticating with a shared secret |
| `with_private_key_jwt(key)` | `private_key_jwt` client authentication (`client-oauth-jwt`) |
| `with_jwks_uri(url)` | Publish the verifying key by reference in the generated document |
| `with_client_credentials()` | The client-credentials grant |
| `with_jwt_bearer(provider)` | The RFC 7523 §2.1 assertion grant |
| `with_identity_assertion(..)` | The enterprise-managed profile |
| `with_scopes([..])` | Scopes to request; defaults to the resource's `scopes_supported` |
| `with_dpop(key)` / `with_dpop_auto()` | Sender-constrained tokens (`client-oauth-dpop`) |
| `require_https(bool)` | Whether plain-`http` discovery/token endpoints are rejected. On by default; turn off only against a local development issuer |
| `with_token_store(..)` | Replace the in-process token store |
| `with_handler(..)` | Replace the interactive step |
| `client_metadata_document([..])` | Build the JSON to host at the CIMD URL |

## Learn By Example

* [`examples/oauth-client`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-client)
  — the whole flow behind `connect()`
* [`examples/oauth-with-keycloak`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-with-keycloak)
  — a pre-registered client against a real issuer
* [Server → OAuth 2.1](../mcp-server/oauth) — the resource server side
