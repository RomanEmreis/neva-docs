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
answers from the live streams, so you can skip **expensive local work** nobody
will receive:

```rust compile-fragment
use neva::prelude::*;

if ctx.is_subscribed(&"res://config".into()) {
    // re-render the snapshot, refresh the cache — the expensive part,
    // worth skipping when nobody on this node is listening
}

// Publish either way — the subscription filters route it.
ctx.resource_updated("res://config").await?;
```

:::warning `is_subscribed` is node-local — changed in 0.5.3
It can only answer for the instance running the handler. Under a
[notification bus](#running-more-than-one-instance) a subscriber elsewhere may
be waiting for exactly the update this instance would skip.

That is why `Context::resource_updated` **no longer pre-checks it**: since
**0.5.3** it publishes unconditionally and lets the filters route the result,
which is what they already did. Use `is_subscribed` to skip work, never to
decide whether to notify.
:::

## Running more than one instance

A `subscriptions/listen` stream is a socket held open by exactly one process,
and the [stateless transport](./http#the-transport-is-stateless) pins nothing
to an instance — so the subscriber and the request that mutates the server
routinely land on different ones:

```text
client --- subscriptions/listen ------------> instance A   (stream held here)
client --- tools/call (mutates the tools) --> instance B   (ctx.add_tool)
                                              instance B has no subscribers
                                              instance A's subscriber hears nothing
```

The subscriber was told its filter was accepted, so the loss reads as "the
server never changes" rather than as a delivery failure.

:::info New in neva 0.5.3
[`App::with_notification_bus(..)`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.with_notification_bus)
carries notifications between instances: each one publishes what it produces
and delivers what it receives to the streams it holds.
:::

```rust
use neva::prelude::*;
use neva::app::notification_bus::{BusNotification, NotificationBus};
use neva::shared::Stream;

struct RedisBus { /* … */ }

impl NotificationBus for RedisBus {
    async fn publish(&self, notification: BusNotification) {
        // hand off to a background connection
    }

    fn subscribe(&self) -> impl Stream<Item = BusNotification> + Send + 'static {
        // every instance's notifications, this one's own included
    }
}

App::new()
    .with_notification_bus(RedisBus { /* … */ })
    .with_options(|opt| opt.with_default_http())
    .run()
    .await;
```

The **subscriber table stays node-local** by construction: half of every entry
is a handle to a socket on one node, so a shared registry could not deliver
anyway. What is pluggable is the *distribution*. neva ships the trait and the
local default; shared implementations (Redis pub/sub, NATS, Postgres
`LISTEN`/`NOTIFY`) live outside the crate, as for
[`RequestStateStore`](./http#running-more-than-one-instance).

### The contract

| Rule | Why |
|---|---|
| **No echo suppression** — `subscribe` must yield this instance's own publishes | Local delivery goes through that same stream and only through it. A bus that hides an instance's messages from itself silences that instance's own subscribers. Redis pub/sub, NATS and `tokio::sync::broadcast` all echo by default |
| **At-most-once is enough** | A subscription whose buffer is full drops the notification with a warning rather than blocking the request that produced it. Redelivery after an instance dies buys nothing — subscriptions are not resumable by spec, and a client whose stream drops re-sends `subscriptions/listen` |
| **`publish` is awaited inside the producing request** | A slow bus slows that request down. Prefer an implementation that hands off to a background connection over one that waits for a round trip |
| **A stream that ends stops delivery for good** | An implementation that can reconnect should do so *inside* the stream rather than end it |

`BusNotification` serializes as the notification body it describes
(`{"method": …, "params": …}`), so a bus that ships JSON can hand it straight
to `serde_json` in both directions. It carries nothing about the instance that
produced it or the subscription it lands on — the receiving instance matches it
against its own filters and stamps each copy with that stream's subscription
id.

**Nothing changes without one.** There is no bus by default, notifications go
straight to this instance's subscribers, and a single-instance server pays no
channel, no allocation and no task for the trait's existence.

:::note Three things, not two
A multi-instance stateless deployment serving subscriptions now configures
`with_request_state_secret`, `with_request_state_store` **and**
`with_notification_bus`.
:::

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

:::info Graceful close on shutdown — fixed in 0.5.4
The spec says a server ending a subscription on its own initiative SHOULD send
the empty result first, so a client can tell an orderly end from a dropped
connection. neva constructed that result but rarely delivered it: one
cancellation token drove both the subscription and the transport, so the result
raced a writer that had already broken out of its loop on the very same signal
— and clients saw `SubscriptionEnd::Abrupt` where `Graceful` was owed.

Shutdown is [two-phase](./shutdown#what-shutdown-actually-does) now. The signal
ends the subscriptions and waits until every result has reached the outbound
channel; only then is the transport torn down.
[`App::with_shutdown_drain(..)`](./shutdown) caps that wait (2 seconds by
default) and is skipped outright when no subscription is open, so a server that
never uses them shuts down exactly as fast as before.

**0.5.5** finished the job: `run` now waits for the transport writers before it
returns, so the result survives a runtime dropped right behind it — and the
bundled Volga engine actually stops on the transport's token, which is what
makes any of this reach an HTTP client.
:::

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
