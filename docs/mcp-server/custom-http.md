---
sidebar_position: 8
---

# Custom HTTP Stack

Neva's Streamable HTTP transport is **pluggable**. The default server is built on [Volga](https://docs.rs/volga) and is enabled by `server-full` / `http-server-volga`, but starting with **v0.3.3** you can host the MCP endpoint on any HTTP stack — `axum`, `hyper`, `actix-web`, or a hand-rolled adapter — by implementing a single trait.

All JSON-RPC framing, SSE replay & dedup, batch fast-path, and pending-oneshot routing stay inside neva. Your adapter is the thinnest possible shim that maps your framework's native request/response/SSE types onto neva's neutral ones.

This page walks through the contract using **axum** as the canonical example. The pattern is the same for any framework — see the [hyper](https://github.com/RomanEmreis/neva/tree/main/examples/hyper) and [actix-web](https://github.com/RomanEmreis/neva/tree/main/examples/actix) examples for stack-specific variations.

## When to Use It

Reach for a custom HTTP stack when you need to:

* Serve MCP from the same process and the same router as an existing HTTP application.
* Reuse framework-specific middleware (CORS, request logging, rate limiting, observability, custom auth schemes).
* Replace Volga with a stack you already operate.
* Drop framework overhead entirely and run on raw `hyper`.

If none of these apply, stay with the [default HTTP transport](./http) — it gives you JWT auth, TLS, and dev certificates out of the box.

## Cargo Setup

Use the engine-agnostic `http-server` feature — it ships only the abstractions and does **not** pull in any HTTP framework.

```toml
[dependencies]
neva = { version = "0.3", features = ["http-server", "server-macros", "tracing", "di"] }

axum = "0.8"
http = "1.4"
http-body-util = "0.1"
tokio = { version = "1", features = ["full"] }
tokio-util = "0.7"
```

:::note
Don't combine `http-server` with `http-server-volga` or `server-full` — those activate the bundled Volga adapter. Pick one HTTP path per build.
:::

## The `HttpEngine` Contract

An adapter implements [`HttpEngine`](https://docs.rs/neva/latest/neva/transport/http/core/engine/trait.HttpEngine.html):

```rust
pub trait HttpEngine: Send + Sync + 'static {
    type Request:  'static;            // framework-native request
    type Response: 'static;            // framework-native response
    type SseEvent: Send + 'static;     // framework-native SSE event

    async fn adapt_request(req: Self::Request) -> HttpRequest;
    fn adapt_response(resp: HttpResponse) -> Self::Response;

    fn tracked_event(seq: u64, msg: &Message) -> Self::SseEvent;
    fn ephemeral_event(msg: &Message) -> Self::SseEvent;

    async fn run(self, ctx: HttpContext, token: CancellationToken) -> Result<(), Error>;
}
```

Five responsibilities:

1. **`adapt_request`** — buffer the inbound body and convert your framework's request into neva's neutral `http::Request<Bytes>`.
2. **`adapt_response`** — convert neva's neutral `http::Response<Bytes>` back into your framework's response type.
3. **`tracked_event`** — build an SSE event **with** an `id:` field (eligible for `Last-Event-ID` replay).
4. **`ephemeral_event`** — build an SSE event **without** an `id:` field (log/notification, not replayed).
5. **`run`** — start the HTTP server with the supplied `HttpContext`, and shut down when `token` fires.

Inside your route handlers, three free helpers do everything else:

* [`handlers::dispatch_post`](https://docs.rs/neva/latest/neva/transport/http/core/handlers/fn.dispatch_post.html) — handle the JSON-RPC POST endpoint (single request, batch, or accepted-202 notification).
* [`handlers::dispatch_delete`](https://docs.rs/neva/latest/neva/transport/http/core/handlers/fn.dispatch_delete.html) — handle session deletion.
* [`handlers::dispatch_get_sse`](https://docs.rs/neva/latest/neva/transport/http/core/handlers/fn.dispatch_get_sse.html) — handle the SSE GET stream, including `Last-Event-ID` replay.

`dispatch_get_sse` returns an [`SseResponse`](https://docs.rs/neva/latest/neva/transport/http/core/types/enum.SseResponse.html):

```rust
enum SseResponse<S> {
    Stream { headers: http::HeaderMap, stream: S },
    Status(HttpResponse),
}
```

`Stream` is the live SSE feed; `Status` is an HTTP-level error/redirect (you just `adapt_response` it).

## End-to-End: axum Adapter

The full example below is a working axum-backed MCP server. It exposes a single tool, `hello`, on `POST /mcp`.

```rust
use axum::{
    Router,
    body::Body,
    extract::State,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::post,
};
use http_body_util::BodyExt;
use neva::prelude::*;
use std::convert::Infallible;
use tokio_util::sync::CancellationToken;

#[derive(Default, Debug)]
struct AxumEngine;

impl HttpEngine for AxumEngine {
    type Request  = http::Request<Body>;
    type Response = Response;
    type SseEvent = Result<Event, Infallible>;

    async fn adapt_request(req: Self::Request) -> HttpRequest {
        let (parts, body) = req.into_parts();
        let bytes = body.collect().await.map(|c| c.to_bytes()).unwrap_or_default();

        let mut builder = http::Request::builder()
            .method(parts.method)
            .uri(parts.uri)
            .version(parts.version);
        if let Some(headers) = builder.headers_mut() {
            for (name, value) in parts.headers.iter() {
                headers.append(name, value.clone());
            }
        }
        builder.body(bytes).expect("valid request")
    }

    fn adapt_response(resp: HttpResponse) -> Self::Response {
        let (parts, body) = resp.into_parts();
        let mut builder = http::Response::builder()
            .status(parts.status)
            .version(parts.version);
        if let Some(headers) = builder.headers_mut() {
            for (name, value) in parts.headers.iter() {
                headers.append(name, value.clone());
            }
        }
        builder.body(Body::from(body)).expect("valid response")
    }

    fn tracked_event(seq: u64, msg: &Message) -> Self::SseEvent {
        Ok(Event::default()
            .id(seq.to_string())
            .json_data(msg)
            .unwrap_or_default())
    }

    fn ephemeral_event(msg: &Message) -> Self::SseEvent {
        Ok(Event::default().json_data(msg).unwrap_or_default())
    }

    async fn run(self, ctx: HttpContext, token: CancellationToken) -> Result<(), Error> {
        let addr = ctx.addr().to_owned();
        let endpoint = ctx.endpoint().to_owned();

        let app = Router::new()
            .route(
                &endpoint,
                post(post_handler).get(get_handler).delete(delete_handler),
            )
            .with_state(ctx);

        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))?;

        axum::serve(listener, app)
            .with_graceful_shutdown(async move { token.cancelled().await })
            .await
            .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))
    }
}

async fn post_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    handlers::dispatch_post::<AxumEngine>(req, &ctx).await
}

async fn delete_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    handlers::dispatch_delete::<AxumEngine>(req, &ctx).await
}

async fn get_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    match handlers::dispatch_get_sse::<AxumEngine>(req, &ctx).await {
        SseResponse::Stream { headers, stream } => {
            let sse = Sse::new(stream).keep_alive(KeepAlive::default());
            let mut response: Response = sse.into_response();
            for (name, value) in headers.iter() {
                response.headers_mut().insert(name, value.clone());
            }
            response
        }
        SseResponse::Status(resp) => AxumEngine::adapt_response(resp),
    }
}

#[tool]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let http = HttpServer::from_engine("127.0.0.1:3000", AxumEngine)
        .with_endpoint("/mcp");

    App::new()
        .with_options(|opt| opt
            .with_name("Axum Example Server")
            .set_http(http)
            .with_mcp_version("2025-06-18"))
        .run()
        .await;
}
```

## Anatomy of the Adapter

**Request adaptation.** `Body::collect()` buffers the inbound body fully — neva's neutral request type is `http::Request<Bytes>`, so streaming bodies are not supported on the request path. Header and URI plumbing is plain `http` crate work.

**Response adaptation.** Same idea in reverse: neva hands back `http::Response<Bytes>`, you rebuild axum's `Response` and return it.

**Tracked vs. ephemeral SSE events.** Tracked events carry an `id:` field and bump the client's `Last-Event-ID` cursor — they're replayed on reconnect. Ephemeral events have no `id:` and are dropped if the client misses them. neva decides which one to build; you just produce the bytes in whatever format your framework expects.

**`run`.** This is where your framework's plumbing lives:

* `ctx.addr()` and `ctx.endpoint()` come from the same `with_http(...)` / `from_engine(...)` config the default server uses, so behaviour stays consistent across engines.
* Inject `ctx` into the router's state (axum's `with_state`, actix's `app_data`, etc.) so handlers can reach it.
* Wire shutdown to the supplied `CancellationToken` — neva calls it when the `App` exits.

**Route handlers are one-liners.** All of the per-method logic — protocol dispatch, batch fast-path, SSE setup, oneshot routing — lives behind `dispatch_post` / `dispatch_delete` / `dispatch_get_sse`. Handlers just forward the request and the context.

## Wiring the Engine

Once the adapter compiles, plug it in with [`HttpServer::from_engine`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.from_engine) instead of the usual `with_http(...)`:

```rust
let http = HttpServer::from_engine("127.0.0.1:3000", AxumEngine)
    .with_endpoint("/mcp");

App::new()
    .with_options(|opt| opt.set_http(http))
    .run()
    .await;
```

`bind()`, `with_endpoint()`, and the SSE-buffer tuning methods are available on the engine-generic `HttpServer` too — the surface is the same as the default server.

## Authentication

Neva's per-tool / per-prompt / per-resource [role and permission gates](./http#role-based-access-control) work with any engine, but the engine is responsible for **decoding** the inbound credential (bearer token, session cookie, custom header — anything) and inserting the resulting claims into `request.extensions_mut()` **before** the request reaches `dispatch_post`.

The contract:

1. Implement [`neva::auth::Claims`](https://docs.rs/neva/latest/neva/auth/trait.Claims.html) on your decoded claims type (or reuse `DefaultClaims`).
2. Wrap them in `Arc<dyn Claims>`.
3. Insert into `req.extensions_mut()` from a middleware layer on the framework side, before calling the dispatch helper.

If no claims are present, neva treats the request as unauthenticated, and any tool / prompt / resource that declares required roles or permissions will reject it with `403 Forbidden`. Public tools are unaffected.

The default `VolgaEngine` does this step automatically using Volga's `BearerTokenService`. Custom engines wire up the equivalent inside their own POST middleware chain.

## Choosing a Stack

| Engine | When it fits | Notes |
|---|---|---|
| **axum** | You're already on axum, or want a Send-friendly, tower-compatible stack. | The canonical pattern shown above. |
| **hyper** | You want raw HTTP with no router and no framework overhead. | The engine's `run` owns the accept loop and `(method, path)` dispatch. |
| **actix-web** | You're already on actix or need its actor model. | actix's request/response types are `!Send`; handlers stay on the actix runtime and avoid `tokio::spawn`. |
| **Volga (default)** | You don't need any of the above. | Enable `server-full` or `http-server-volga` and use [`with_http(...)`](./http) — no `HttpEngine` impl required. |

## Learn By Example

* [axum adapter](https://github.com/RomanEmreis/neva/tree/main/examples/axum) — the canonical pattern.
* [hyper adapter](https://github.com/RomanEmreis/neva/tree/main/examples/hyper) — raw protocol layer, no router.
* [actix-web adapter](https://github.com/RomanEmreis/neva/tree/main/examples/actix) — handling `!Send` request/response types and a dedicated runtime.
