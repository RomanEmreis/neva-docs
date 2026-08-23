---
sidebar_position: 11
---

# Subscriptions

Under [MCP 2026-07-28](../spec-2026-07-28) a client receives server-initiated
notifications by *asking* for them: one long-lived **`subscriptions/listen`**
request carries a filter, and everything the client opted in to comes back on
that request's own stream.

That single request replaces two things at once — the standalone SSE `GET`
stream, and the `resources/subscribe` / `resources/unsubscribe` RPC pair. A
per-resource subscription did not disappear; it became a URI in the filter,
scoped to the stream that carries it.

:::info New in neva 0.5.1
`Client::listen` arrived in **neva 0.5.1**. Before it, server-initiated
notifications had no channel on the stateless HTTP transport, and this site
told you to poll instead — that advice described the release candidate, not
the final spec. It no longer applies.
:::

## Opening a subscription

```rust compile
use neva::prelude::*;
use neva::types::notification::Notification;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http.bind("127.0.0.1:3000").with_endpoint("/mcp"))
            .with_timeout(Duration::from_secs(5)));

    client.connect().await?;

    // Register the handlers first — they are what the stream feeds.
    client.on_tools_changed(|_: Notification| async {
        println!("the tool list changed — time to re-list");
    });
    client.on_resource_changed(|n: Notification| async move {
        let params = n.params::<SubscribeRequestParams>()
            .expect("Expected SubscribeRequestParams");

        println!("resource '{}' has been updated", params.uri);
    });

    // One stream, two notification types.
    let mut subscription = client
        .listen(SubscriptionFilter::new()
            .with_tools_changed()
            .with_resource("res://config"))
        .await?;

    // ... work ...

    subscription.cancel().await?;
    println!("subscription ended: {:?}", subscription.closed().await);

    client.disconnect().await
}
```

[`Client::listen`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.listen)
returns only once the server has **acknowledged** the subscription, so a
`Subscription` in your hands is a stream that is already live.

## The filter

[`SubscriptionFilter`](https://docs.rs/neva/latest/neva/types/subscription/struct.SubscriptionFilter.html)
is an opt-in set — a server must never deliver a category you did not ask
for, and an omitted field means exactly "not subscribed":

| Builder | Wire field | Delivers |
|---|---|---|
| `with_tools_changed()` | `toolsListChanged` | `notifications/tools/list_changed` |
| `with_prompts_changed()` | `promptsListChanged` | `notifications/prompts/list_changed` |
| `with_resources_changed()` | `resourcesListChanged` | `notifications/resources/list_changed` |
| `with_resource(uri)` / `with_resources(uris)` | `resourceSubscriptions` | `notifications/resources/updated` for those URIs |

[Logging](../mcp-server/logging#delivery) and
[progress](../mcp-server/progress) need no subscription — they stay
request-scoped and ride the response stream of the request that triggered
them. `notifications/tasks` *is* a subscription category in the spec, but not
in neva's filter yet, so [task status](./tasks) is still learned by polling
`tasks/get`.

## Handlers come first — and after `connect()`

Notifications delivered on the stream are dispatched to the ordinary handlers
registered with
[`Client::subscribe`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.subscribe)
and its helpers (`on_tools_changed`, `on_prompts_changed`,
`on_resources_changed`, `on_resource_changed`). **Existing client code needs
no change** — this is why neva has no per-subscription stream to iterate.

Two ordering rules follow from that:

* Register handlers **after `connect()`**. The helpers assert that the server
  advertises the matching capability, and capabilities are not known until
  discovery has run.
* Register them **before `listen()`**. The acknowledgment is the first message
  on the stream and notifications may follow immediately.

## The server may narrow your filter

The accepted filter is the requested one intersected with what the server
actually advertises. A category the server does not announce is **dropped
from the acknowledgment** rather than refused — so the subscription opens,
and you learn immediately which types will never arrive instead of waiting
forever for a push that was never going to come:

```rust
if !subscription.is_fully_honored() {
    println!("requested: {:?}", subscription.requested());
    println!("accepted:  {:?}", subscription.acknowledged());
}
```

An acknowledgment *broader* than the request is a protocol violation:
`listen` rejects it with `InvalidRequest` and no subscription is established.

## The `Subscription` handle

The handle is about the stream's **lifecycle**, not its contents:

| Method | What it gives you |
|---|---|
| [`id()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.id) | The subscription id — the JSON-RPC id of the `subscriptions/listen` request, carried in every message's `_meta` |
| [`requested()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.requested) | The filter this client asked for |
| [`acknowledged()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.acknowledged) | The subset the server agreed to honor |
| [`is_fully_honored()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.is_fully_honored) | Whether nothing was narrowed away |
| [`cancel()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.cancel) | Ends the subscription |
| [`closed()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.closed) | Awaits the end and reports how it happened |

## How a subscription ends

[`closed()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.closed)
resolves to a
[`SubscriptionEnd`](https://docs.rs/neva/latest/neva/client/enum.SubscriptionEnd.html):

| Variant | Meaning |
|---|---|
| `Cancelled` | This client called `cancel()` |
| `Graceful(SubscriptionsListenResult)` | The server answered the listen request with its close result. The result names the subscription it closes, and a reply naming a different one is reported as `Abrupt` instead |
| `Abrupt` | The stream went away without a final result — dropped connection, timeout, or a server that died |

:::info Server shutdown gives you `Graceful` — since neva 0.5.4
A server ending a subscription on its own initiative SHOULD send the empty
result first, and until **0.5.4** neva constructed that result but rarely
delivered it: one cancellation token drove both the subscription and the
transport, so the result raced a writer that had already broken out of its
loop on the very same signal. Against an older server, read an `Abrupt` at
shutdown as "the peer stopped", not as a fault on this side. See
[Server → Graceful Shutdown](../mcp-server/shutdown).
:::

Subscriptions are **not resumable**: a client that wants to keep listening
sends `subscriptions/listen` again.

Dropping the handle ends the subscription too, and so does
`Client::disconnect` — neither can leave the peer streaming into a client
with no way left to stop it.

:::tip Why `Cancelled` and not `Graceful` over HTTP
Cancelling closes the listen `POST`'s response body, which *is* the spec's
cancellation mechanism there. There is no channel left for a final result,
and none is expected.
:::

## Every message carries the subscription id

Each message on the stream — the acknowledgment, every notification, the
final result — carries
`_meta["io.modelcontextprotocol/subscriptionId"]`. That is what lets a client
demultiplex several subscriptions sharing one channel, which on `stdio` is
always the case. neva validates it for you: a subscribable notification that
arrives untagged, out of scope, or ahead of the acknowledgment is dropped
rather than dispatched to handlers that know nothing about subscriptions.

## Transports

| Transport | How the stream works |
|---|---|
| Streamable HTTP | The subscription rides the listen `POST`'s own `text/event-stream` body; closing it ends the subscription |
| `stdio` | Messages interleave on stdout; the subscription ends on `notifications/cancelled` |

:::warning Not available in a batch
[`call_batch`](./batch) rejects a batched `subscriptions/listen` with
`InvalidRequest`. A batch slot is an ordinary request slot — finite TTL, a
plain `Response`, no handle — so a subscription opened that way would have
nothing to cancel it and would outlive the call that made it. Use
`Client::listen`.
:::

## Migrating from `subscribe_to_resource`

`resources/subscribe` and `resources/unsubscribe` are not deleted by the
spec, they are folded into `resourceSubscriptions`. On the client the old
methods stay compiled — the dual-mode fallback still reaches legacy peers —
but they reject a 2026-07-28 peer with `MethodNotFound`:

```rust
// Before (legacy)
client.subscribe_to_resource("res://some-resource").await?;
// ...
client.unsubscribe_from_resource("res://some-resource").await?;

// After (MCP 2026-07-28)
let mut subscription = client
    .listen(SubscriptionFilter::new().with_resource("res://some-resource"))
    .await?;
// ...
subscription.cancel().await?;
```

The server side loses its half of the pair entirely:
`Context::subscribe_to_resource` / `unsubscribe_from_resource` moved behind
[`legacy-spec`](../legacy-spec), because the client now owns the
subscription. See [Server → Subscriptions](../mcp-server/subscriptions).

## Learn By Example

* [`examples/subscriptions`](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
  — server + client over HTTP
* [`examples/subscription`](https://github.com/RomanEmreis/neva/tree/main/examples/subscription)
  — the legacy `resources/subscribe` flow
