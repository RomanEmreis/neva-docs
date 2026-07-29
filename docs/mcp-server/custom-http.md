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
neva = { version = "0.5", features = ["http-server", "server-macros", "tracing", "di"] }

axum = "0.8"
http = "1.4"
http-body-util = "0.1"
tokio = { version = "1", features = ["full"] }
tokio-util = "0.7"
tracing-subscriber = "0.3"
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

    async fn adapt_request(req: Self::Request) -> Result<HttpRequest, Error>;
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

The last two compile in either build, but under MCP 2026-07-28 the stateless
transport gives them nothing to serve.

### `StreamResponse`: one shape for both routes

Streamable HTTP has allowed a POST reply to be either a single JSON body or
an SSE stream since spec revision 2025-03-26, and under MCP 2026-07-28 that
is how request-scoped [logging](./logging) and [progress](./progress)
notifications reach the client. So **`dispatch_post` and `dispatch_get_sse`
return the same two-arm type**:

```rust
enum StreamResponse<S> {
    Stream { headers: http::HeaderMap, stream: S },
    Complete(HttpResponse),
}
```

`Stream` is a live SSE feed; `Complete` carries a full JSON reply or an
HTTP-level error (you just `adapt_response` it).

:::warning Renamed in v0.5.0
`SseResponse` became `StreamResponse` and its `Status` variant became
`Complete` — it carries full JSON replies, not just error statuses. A
deprecated `SseResponse` alias remains for one release.

`dispatch_post` also changed shape: it now returns
`Result<StreamResponse<impl Stream<Item = E::SseEvent>>, Error>` rather than
`E::Response`, so engines handle the same two-arm match their GET route
already had. `handlers::handle_post` stays available as the JSON-only
building block. Builds without `tracing` — and `legacy-spec` builds — always
produce `Complete`, so the behavior is unchanged there.
:::

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

    async fn adapt_request(req: Self::Request) -> Result<HttpRequest, Error> {
        // `from_parts` preserves method, URI, version, headers AND
        // extensions — including any `Arc<dyn Claims>` inserted by an
        // upstream auth middleware. Dropping `parts.extensions` here
        // would make every protected tool see the request as
        // unauthenticated.
        let (parts, body) = req.into_parts();
        let bytes = body
            .collect()
            .await
            .map(|c| c.to_bytes())
            .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))?;
        Ok(http::Request::from_parts(parts, bytes))
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
    // Same two-arm shape as `get_handler`: a POST reply is either a single
    // body (`Complete`) or a request-scoped SSE stream (`Stream`) carrying
    // the request's notifications followed by its response.
    let outcome = match handlers::dispatch_post::<AxumEngine>(req, &ctx).await {
        Ok(outcome) => outcome,
        Err(e) => return internal_error(e),
    };
    match outcome {
        StreamResponse::Stream { headers, stream } => {
            let sse = Sse::new(stream).keep_alive(KeepAlive::default());
            let mut response: Response = sse.into_response();
            for (name, value) in headers.iter() {
                response.headers_mut().insert(name, value.clone());
            }
            response
        }
        StreamResponse::Complete(resp) => AxumEngine::adapt_response(resp),
    }
}

async fn delete_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    handlers::dispatch_delete::<AxumEngine>(req, &ctx)
        .await
        .unwrap_or_else(internal_error)
}

async fn get_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    let outcome = match handlers::dispatch_get_sse::<AxumEngine>(req, &ctx).await {
        Ok(outcome) => outcome,
        Err(e) => return internal_error(e),
    };
    match outcome {
        StreamResponse::Stream { headers, stream } => {
            let sse = Sse::new(stream).keep_alive(KeepAlive::default());
            let mut response: Response = sse.into_response();
            for (name, value) in headers.iter() {
                response.headers_mut().insert(name, value.clone());
            }
            response
        }
        StreamResponse::Complete(resp) => AxumEngine::adapt_response(resp),
    }
}

/// Translate a neva engine-adapter `Error` into a 500 axum response.
fn internal_error(err: Error) -> Response {
    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
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
            .set_http(http))
        .run()
        .await;
}
```

:::note
`with_mcp_version(...)` is **not** available on the server in the default
build — MCP 2026-07-28 is pinned, and a server advertises the set it speaks
through `server/discover`. The method returns under
[`legacy-spec`](../legacy-spec.md), where version selection is meaningful.
:::

Under MCP 2026-07-28 the transport is stateless, so `delete_handler` and
`get_handler` have nothing to serve — the routes exist for `legacy-spec`
builds and for engines that want a single source file across both
generations.

## Anatomy of the Adapter

**Request adaptation.** `Body::collect()` buffers the inbound body fully — neva's neutral request type is `http::Request<Bytes>`, so streaming bodies are not supported on the request path. A body that fails to collect surfaces as an `Err`, which the route handler turns into a `500`. Using `http::Request::from_parts(parts, bytes)` carries over the method, URI, version, headers, **and** request extensions in one move. Preserving extensions is mandatory for auth: the engine's auth middleware (covered below) stores `Arc<dyn Claims>` in the request extensions, and `dispatch_post` reads it back from the neutral request — a rebuild that drops `parts.extensions` would silently downgrade every authenticated call to unauthenticated.

Headers matter more than they used to: `dispatch_post` validates
`Mcp-Method`, `Mcp-Name`, and `Mcp-Param-{name}` against the body and
rejects a mismatch with `HeaderMismatch` (`-32020`) and HTTP `400`. Your
adapter must forward the inbound headers verbatim — dropping or rewriting
them turns valid calls into `400`s.

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
