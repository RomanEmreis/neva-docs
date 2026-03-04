---
sidebar_position: 16
---

# JWT Claims

When using [HTTP transport with JWT authentication](./http#jwt-authentication), neva decodes the bearer token on each request and makes the claims available to your handlers. This page shows how to read claim values in tool, resource, and prompt handlers.

## Default Claims

Neva parses incoming JWTs into [`DefaultClaims`](https://docs.rs/neva/latest/neva/auth/struct.DefaultClaims.html), which maps standard JWT fields plus the `role`, `roles`, and `permissions` fields used for [role-based access control](./http#role-based-access-control):

| Field | Type | Description |
|-------|------|-------------|
| `sub` | `Option<String>` | Subject — typically the user ID |
| `iss` | `Option<String>` | Issuer |
| `aud` | `Option<String>` | Audience |
| `exp` | `Option<i64>` | Expiration timestamp |
| `nbf` | `Option<i64>` | Not-before timestamp |
| `iat` | `Option<i64>` | Issued-at timestamp |
| `jti` | `Option<String>` | JWT ID |
| `role` | `Option<String>` | Single role |
| `roles` | `Option<Vec<String>>` | List of roles |
| `permissions` | `Option<Vec<String>>` | List of permissions |

All fields are optional — neva will not reject a token that is missing any of these.

## Accessing Claims in Handlers

Extract the raw [`Request`](https://docs.rs/neva/latest/neva/types/struct.Request.html) object as a handler parameter to read claim values:

```rust
use neva::prelude::*;

#[tool(descr = "Returns a personalized greeting")]
async fn greet(req: Request) -> String {
    let subject = req.claims
        .as_ref()
        .and_then(|c| c.sub.as_deref())
        .unwrap_or("anonymous");

    format!("Hello, {subject}!")
}
```

`Request` can be combined with other parameters freely:

```rust
#[tool(descr = "Creates a note for the authenticated user")]
async fn create_note(req: Request, title: String, body: String) -> Result<String, Error> {
    let user_id = req.claims
        .as_ref()
        .and_then(|c| c.sub.clone())
        .ok_or_else(|| Error::new(ErrorCode::InvalidParams, "Authentication required"))?;

    let id = save_note(&user_id, title, body).await
        .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))?;

    Ok(id)
}
```

## Accessing Claims in Middleware

In [middleware](./middlewares), claims are not directly on `MwContext`. Access them by reading the raw JSON-RPC message and headers:

```rust
use neva::prelude::*;
use neva::app::middleware::{MwContext, Next};

async fn audit_middleware(ctx: MwContext, next: Next) -> Response {
    if let Some(req) = ctx.request() {
        // Log the request method; full claims are available after the handler runs
        tracing::info!("method={}", req.method);
    }
    next(ctx).await
}
```

For claim-aware authorization in middleware, inject the validated claims via the DI container. Store them as a singleton or scoped service after decoding them in a preceding middleware:

```rust
use neva::prelude::*;
use neva::app::middleware::{MwContext, Next};
use neva::di::Dc;

#[derive(Clone)]
struct CallerIdentity {
    subject: String,
    roles: Vec<String>,
}

async fn identity_middleware(mut ctx: MwContext, next: Next) -> Response {
    // Read the Authorization header to build CallerIdentity,
    // then make it available downstream via DI.
    next(ctx).await
}
```

## Mapping Custom Claim Fields

If your JWT uses non-standard field names for roles or permissions, implement the [`AuthClaims`](https://docs.rs/volga-di/latest/volga_di/trait.Inject.html) trait on your own type:

```rust
use neva::auth::{AuthClaims, DefaultClaims};
use serde::Deserialize;

#[derive(Default, Clone, Deserialize)]
struct MyClaims {
    sub: Option<String>,
    exp: Option<i64>,
    /// Your org uses "group" instead of "roles"
    group: Option<String>,
    /// And "scope" instead of "permissions"
    scope: Option<Vec<String>>,
}

impl AuthClaims for MyClaims {
    fn role(&self) -> Option<&str> {
        self.group.as_deref()
    }

    fn roles(&self) -> Option<&[String]> {
        None // using single role field only
    }

    fn permissions(&self) -> Option<&[String]> {
        self.scope.as_deref()
    }
}
```

:::info
Custom claims types are used by the auth layer for role/permission validation. To access claim data in handlers, use the `Request` extractor as shown above — handlers always receive `DefaultClaims`.
:::

## Example: Per-User Data Isolation

A common pattern is using the `sub` claim to scope database queries to the authenticated user:

```rust
use neva::prelude::*;
use neva::di::Dc;

#[derive(Clone)]
struct Database { /* ... */ }

impl Database {
    async fn list_for_user(&self, user_id: &str) -> Vec<String> {
        // query filtered by user_id
        vec![]
    }
}

#[tool(descr = "Lists the caller's documents")]
async fn list_documents(req: Request, db: Dc<Database>) -> Result<CallToolResponse, Error> {
    let user_id = req.claims
        .as_ref()
        .and_then(|c| c.sub.as_deref())
        .ok_or_else(|| Error::new(ErrorCode::InvalidParams, "Authentication required"))?;

    let docs = db.list_for_user(user_id).await;
    Ok(CallToolResponse::json(docs))
}

#[tokio::main]
async fn main() {
    let secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");

    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .with_auth(|auth| auth
                    .set_decoding_key(secret.as_bytes())
                    .with_iss(["my-issuer"]))))
        .add_singleton(Database { /* ... */ })
        .run()
        .await;
}
```

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/protected-server).
