---
sidebar_position: 11
---

# Middlewares

Neva supports a middleware pipeline that allows you to intercept, inspect, or modify requests before and after they are processed. Middlewares are async functions that receive a [`MwContext`](https://docs.rs/neva/latest/neva/middleware/struct.MwContext.html) and a [`Next`](https://docs.rs/neva/latest/neva/middleware/type.Next.html) callback.

## Writing a Middleware

A middleware has the following signature:

```rust
async fn my_middleware(ctx: MwContext, next: Next) -> Response {
    // Logic before the handler runs
    let resp = next(ctx).await;
    // Logic after the handler runs
    resp
}
```

Call `next(ctx).await` to pass control to the next middleware or the actual handler.

## Answering a Request Yourself

A middleware that returns **without** calling `next` answers the request
itself: what it returns is sent to the caller, over any transport and inside a
batch alike. Build the answer with the request's id:

```rust compile
use neva::prelude::*;

async fn require_params(ctx: MwContext, next: Next) -> Response {
    if ctx.request().is_some_and(|req| req.params.is_none()) {
        let err = Error::new(ErrorCode::InvalidParams, "a tool call needs params");
        return Response::error(ctx.id(), err);
    }
    next(ctx).await
}
```

Once a middleware has called `next`, the reply the caller gets is the
handler's — it goes out when the request reaches the end of the pipeline, so a
different `Response` returned afterwards is not sent. The exception is a
middleware that stops waiting for `next` before the reply is out, a timeout
around it say: then its own answer is the reply.

```rust compile
use neva::prelude::*;
use std::time::Duration;

async fn deadline(ctx: MwContext, next: Next) -> Response {
    let id = ctx.id();
    match tokio::time::timeout(Duration::from_secs(5), next(ctx)).await {
        Ok(resp) => resp,
        Err(_) => Response::error(id, Error::new(ErrorCode::InternalError, "timed out")),
    }
}
```

A notification gets no reply either way.

## Who Is Calling

On an HTTP server with authentication,
[`MwContext::claims()`](https://docs.rs/neva/latest/neva/middleware/struct.MwContext.html#method.claims)
returns the claims of the caller's token — the same ones a handler reads with
[`ctx.claims()`](./oauth#who-is-calling), and `None` in the same cases:

```rust compile
use neva::prelude::*;

async fn audit(ctx: MwContext, next: Next) -> Response {
    let client = ctx.claims().and_then(|c| c.client_id()).unwrap_or("-");
    tracing::info!("tool call by client {client}");
    next(ctx).await
}
```

## Global Middleware

Use [`wrap()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.wrap) to register a middleware that wraps **all incoming requests**:

```rust
async fn logging_middleware(ctx: MwContext, next: Next) -> Response {
    let id = ctx.id();
    tracing::info!("Request start: {id:?}");
    let resp = next(ctx).await;
    tracing::info!("Request end: {id:?}");
    resp
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .wrap(logging_middleware)
        .run()
        .await;
}
```

## Tool-Scoped Middleware

Use [`wrap_tools()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.wrap_tools) to apply a middleware to **all `tools/call` requests**:

```rust
async fn global_tool_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("Tool called");
    next(ctx).await
}

App::new()
    .with_options(|opt| opt.with_stdio())
    .wrap_tools(global_tool_middleware)
    .run()
    .await;
```

## Per-Handler Middleware

You can attach a middleware to a specific tool, prompt, or handler using the `middleware` parameter in the attribute macro:

```rust
async fn specific_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("Hello from specific middleware");
    next(ctx).await
}

#[tool(middleware = [specific_middleware])]
async fn greeter(name: String) -> String {
    format!("Hello, {name}!")
}

#[prompt(middleware = [specific_middleware])]
async fn my_prompt(topic: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Topic: {topic}"))
}

#[handler(command = "ping", middleware = [specific_middleware])]
async fn ping_handler() {
    eprintln!("pong");
}
```

## Combining Middlewares

Global, tool-scoped, and per-handler middlewares can all be combined in the same application. They execute in the following order for a `tools/call` request:

1. Global middleware (`wrap`)
2. Tool-scoped middleware (`wrap_tools`)
3. Per-handler middleware (`middleware = [...]`)
4. Tool handler

```rust
async fn logging_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("1. Global");
    next(ctx).await
}

async fn tool_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("2. Tool-scoped");
    next(ctx).await
}

async fn specific_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("3. Per-handler");
    next(ctx).await
}

#[tool(middleware = [specific_middleware])]
async fn greeter(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .wrap(logging_middleware)
        .wrap_tools(tool_middleware)
        .run()
        .await;
}
```

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/middlewares).
