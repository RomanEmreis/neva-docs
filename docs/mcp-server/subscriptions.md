---
sidebar_position: 17
---

# Subscriptions

Under [MCP 2026-07-28](../spec-2026-07-28) a client opts into server-initiated
notifications with a single long-lived **`subscriptions/listen`** request
carrying a filter. On the server side there is **no handler to write**: neva
answers `subscriptions/listen` itself and fans your existing `Context` calls
out to every stream whose filter admits them.

:::info New in neva 0.5.1
Subscription delivery arrived in **neva 0.5.1**. Until then `listChanged` and
`resources.subscribe` were masked off in the default build because nothing
could deliver them. A listen stream now can, so a server that configures
`with_list_changed()` / `with_subscribe()` starts seeing those capabilities on
the wire again.
:::

## Advertise what you can push

The accepted filter is the requested one **narrowed to the advertised
capabilities**, so what a server announces is exactly what a client may
subscribe to:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http.bind("127.0.0.1:3000").with_endpoint("/mcp"))
            .with_tools(|tools| tools.with_list_changed())
            .with_prompts(|prompts| prompts.with_list_changed())
            .with_resources(|res| res.with_list_changed().with_subscribe()))
        .run()
        .await;
}
```

| Capability | Enables | Notification |
|---|---|---|
| `tools.listChanged` | `toolsListChanged` | `notifications/tools/list_changed` |
| `prompts.listChanged` | `promptsListChanged` | `notifications/prompts/list_changed` |
| `resources.listChanged` | `resourcesListChanged` | `notifications/resources/list_changed` |
| `resources.subscribe` | `resourceSubscriptions` | `notifications/resources/updated` |

A category a client asks for but the server does not advertise is **dropped
from the acknowledgment** rather than refused. The subscription still opens,
and the client learns immediately that those types will never arrive.

## Your handlers do not change

The `Context` mutators fan out on their own — every existing call site keeps
working, and a server that never had a subscription now feeds one:

```rust compile-fragment
use neva::prelude::*;

// Emits `notifications/tools/list_changed` to every stream that asked for it
ctx.add_tool(Tool::new("greet", || async { "hello" })).await?;
let _ = ctx.remove_tool("greet").await?;

// `notifications/prompts/list_changed`
let _ = ctx.remove_prompt("summarize").await?;

// `notifications/resources/list_changed`
ctx.add_resource(Resource::new("res://config", "config")).await?;
let _ = ctx.remove_resource("res://config").await?;

// `notifications/resources/updated` — only to streams listing this URI
ctx.resource_updated("res://config").await?;
```

The registry lives on the shared `McpOptions`, so a `Context` belonging to any
in-flight request reaches every live stream — a notification is not confined to
the request that produced it.

Log and progress notifications are **not** subscribable and keep their
request-scoped behavior: they ride the response stream of the request that
triggered them — see [Logging → Delivery](./logging#delivery).

`notifications/tasks` is a subscription category in the spec, but it is not in
`SubscriptionFilter` yet, so `Context::task_changed` has no stream to reach in
a default build and clients learn task status by polling
[`tasks/get`](./tasks).

## Asking who is listening

[`Context::is_subscribed`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.is_subscribed)
answers from the live streams, so you can skip work nobody will receive:

```rust compile-fragment
use neva::prelude::*;

if ctx.is_subscribed(&"res://config".into()) {
    // somebody is listening for this resource
    ctx.resource_updated("res://config").await?;
}
```

## What goes on the wire

```
--> subscriptions/listen  { "notifications": SubscriptionFilter }
<-- notifications/subscriptions/acknowledged  { "notifications": …, "_meta": { subscriptionId } }
<-- notifications/tools/list_changed          { "_meta": { subscriptionId } }
…
<-- { "id": …, "result": { "resultType": "complete", "_meta": { subscriptionId } } }
```

The acknowledgment is always the **first** message on the stream, and every
message carries `_meta["io.modelcontextprotocol/subscriptionId"]` so a client
sharing one channel across several subscriptions can demultiplex them.

## How a subscription ends

| Trigger | Where it applies |
|---|---|
| `notifications/cancelled` for the listen request | `stdio` |
| The client closing the stream | Streamable HTTP |
| Transport close | both |
| Server shutdown | both — after a graceful empty result |

Over HTTP a `notifications/cancelled` travels on its own `POST` and proves
nothing about who opened the stream, so closing the response body is the
sound mechanism there — and the client sees `Cancelled` rather than a final
result.

## Transports

| Transport | How the stream is carried |
|---|---|
| Streamable HTTP | The listen `POST` gets a `text/event-stream` reply and the notifications land on its body. This is the third way a `POST` becomes a stream, alongside a `logLevel` and a `progressToken` — and unlike those two it needs no `tracing` feature |
| `stdio` | Messages interleave on stdout |

## Under `legacy-spec`

The RPC pair comes back and the server owns the subscription again:
`Context::subscribe_to_resource`, `Context::unsubscribe_from_resource` and
`resource::commands::{SUBSCRIBE, UNSUBSCRIBE}` exist only under
[`legacy-spec`](../legacy-spec). In the default build, drop
`ctx.subscribe_to_resource(..)` from your handlers — the client owns the
subscription now, and there is nothing for the server to add.

## Learn By Example

* [`examples/subscriptions`](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
  — server + client over HTTP
* [`examples/updates`](https://github.com/RomanEmreis/neva/tree/main/examples/updates)
  — the resource mutations that produce the notifications
* [Client → Subscriptions](../mcp-client/subscriptions) — the other half
