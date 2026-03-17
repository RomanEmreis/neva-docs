---
sidebar_position: 12
---

# Dependency Injection

Neva includes a built-in dependency injection (DI) container that lets you register shared services — database connections, HTTP clients, configuration objects, caches — and have them automatically provided to your tool, resource, and prompt handlers.

:::info
DI is included in the `server-full` feature preset. If you are using a custom feature set, add the `di` feature explicitly:

```toml
neva = { version = "...", features = ["server-macros", "di"] }
```
:::

## Service Lifetimes

Neva supports three service lifetimes that control how and when instances are created:

| Lifetime | Created | Shared across |
|----------|---------|---------------|
| **Singleton** | Once at startup | All requests and sessions |
| **Scoped** | Once per incoming MCP message | All handlers within the same request |
| **Transient** | On every resolution | Nothing — each call gets a new instance |

Choose **singleton** for stateless or thread-safe services (e.g. an HTTP client or a read-only config). Choose **scoped** when a service should be shared within a single request but isolated from others (e.g. a database transaction). Choose **transient** when you always need a fresh instance.

## Registering Services

Services are registered on `App` during setup, before calling `.run()`.

### Singleton

Pass an already-constructed instance:

```rust
use neva::prelude::*;

#[derive(Clone)]
struct AppConfig {
    api_url: String,
}

#[tokio::main]
async fn main() {
    let config = AppConfig { api_url: "https://api.example.com".into() };

    App::new()
        .with_options(|opt| opt.with_stdio())
        .add_singleton(config)
        .run()
        .await;
}
```

`T` must implement `Send + Sync + 'static`. `Clone` is required to extract the value directly; to share by pointer use `Dc<T>` (covered below).

### Scoped — via `Inject` trait

Implement the [`Inject`](https://docs.rs/volga-di/latest/volga_di/trait.Inject.html) trait to describe how the service constructs itself from the container. The container calls this once per request scope.

```rust
use neva::prelude::*;

#[derive(Clone)]
struct RequestLogger {
    prefix: String,
}

impl Inject for RequestLogger {
    fn inject(_: &Container) -> Result<Self, DiError> {
        Ok(Self { prefix: "[req]".into() })
    }
}

App::new()
    .with_options(|opt| opt.with_stdio())
    .add_scoped::<RequestLogger>()
    .run()
    .await;
```

### Scoped — via factory

When construction is simple or you don't want to implement `Inject`, pass a closure:

```rust
App::new()
    .add_scoped_factory(|| RequestLogger { prefix: "[req]".into() })
    .run()
    .await;
```

### Scoped — via `Default`

If your type implements `Default`, use the shorthand:

```rust
#[derive(Default, Clone)]
struct RequestContext {
    trace_id: Option<String>,
}

App::new()
    .add_scoped_default::<RequestContext>()
    .run()
    .await;
```

### Transient — via `Inject`, factory, or `Default`

The transient variants mirror the scoped ones. The only difference is that the factory (or `Inject::inject`, or `Default::default`) is called every time the type is resolved, not just once per scope:

```rust
App::new()
    .add_transient::<MyService>()           // via Inject
    .add_transient_factory(|| MyService::new())  // via closure
    .add_transient_default::<MyService>()   // via Default
    .run()
    .await;
```

## Extracting Services in Handlers

Use `Dc<T>` as a function parameter to receive a service in any tool, resource, or prompt handler. `Dc` (Dependency Container) wraps the resolved instance in an `Arc` and implements `Deref`, so you can use it like a plain reference.

```rust
use neva::prelude::*;

#[derive(Default, Clone)]
struct AppConfig {
    greeting: String,
}

#[tool(descr = "Greets a user using configured greeting")]
async fn hello(config: Dc<AppConfig>, name: String) -> String {
    format!("{}, {name}!", config.greeting)
}

#[tokio::main]
async fn main() {
    let config = AppConfig { greeting: "Hello".into() };

    App::new()
        .with_options(|opt| opt.with_stdio())
        .add_singleton(config)
        .run()
        .await;
}
```

`Dc<T>` works with all handler types:

```rust
// In a resource handler
#[resource(uri = "data://{id}", title = "Fetch data")]
async fn fetch_data(db: Dc<Database>, uri: Uri, id: String) -> ResourceContents {
    let row = db.get(&id).await?;
    ResourceContents::new(uri).with_text(row)
}

// In a prompt handler
#[prompt(descr = "Generate a prompt using config")]
async fn my_prompt(config: Dc<AppConfig>, topic: String) -> PromptMessage {
    PromptMessage::user().with(format!("{}: {topic}", config.greeting))
}
```

### Getting an owned value

If you need an owned `T` rather than a shared reference, call `.cloned()` on the `Dc<T>`:

```rust
#[tool(descr = "Returns config details")]
async fn describe(config: Dc<AppConfig>) -> String {
    let owned: AppConfig = config.cloned();
    owned.greeting
}
```

## Extracting Services in Middleware

Inside middleware, use `ctx.resolve::<T>()` for a cloned value or `ctx.resolve_shared::<T>()` for an `Arc<T>`:

```rust
use neva::prelude::*;

async fn auth_middleware(ctx: MwContext, next: Next) -> Response {
    let config = ctx.resolve_shared::<AppConfig>()?;
    // Use config for auth checks, logging, etc.
    next(ctx).await
}
```

:::note
`resolve` and `resolve_shared` are only available when the `di` feature is enabled.
:::

## The `Inject` Trait

`Inject` gives a type the ability to pull its own dependencies from the container — useful when a service itself depends on other registered services:

```rust
use neva::prelude::*;

#[derive(Clone)]
struct EmailService {
    config: AppConfig,
}

impl Inject for EmailService {
    fn inject(container: &Container) -> Result<Self, DiError> {
        let config = container.resolve::<AppConfig>()?;
        Ok(Self { config })
    }
}
```

When you call `add_scoped::<EmailService>()`, neva will call `EmailService::inject(container)` at the start of each request scope.

## Full Example

```rust
use neva::prelude::*;

// --- Services ---

#[derive(Clone)]
struct AppConfig {
    api_url: String,
}

#[derive(Clone)]
struct ApiClient {
    base_url: String,
}

impl ApiClient {
    async fn fetch(&self, path: &str) -> String {
        format!("GET {}{path}", self.base_url)
    }
}

impl Inject for ApiClient {
    fn inject(container: &Container) -> Result<Self, DiError> {
        let config = container.resolve::<AppConfig>()?;
        Ok(Self { base_url: config.api_url.clone() })
    }
}

// --- Handlers ---

#[tool(descr = "Fetches data from the upstream API")]
async fn fetch_data(client: Dc<ApiClient>, path: String) -> String {
    client.fetch(&path).await
}

// --- Main ---

#[tokio::main]
async fn main() {
    let config = AppConfig { api_url: "https://api.example.com".into() };

    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("API MCP server")
            .with_version("1.0.0"))
        .add_singleton(config)   // shared, pre-built
        .add_scoped::<ApiClient>() // rebuilt once per request using Inject
        .run()
        .await;
}
```
