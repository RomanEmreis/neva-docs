---
sidebar_position: 19
---

# Graceful Shutdown

A neva server stops on an OS signal — `SIGINT` / `SIGTERM` and the Windows
equivalents — with no configuration at all. That is the right default for a
process whose whole job is to be an MCP server, and no use for the two cases
that are not that: a **test** that has to observe an orderly shutdown, and neva
**embedded** in a larger service that owns its own lifecycle.

:::info New in neva 0.5.4
[`App::with_shutdown()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.with_shutdown),
`with_shutdown_signal(..)` and `with_shutdown_drain(..)` arrived in **0.5.4**
(alongside the [subscription drain](#what-shutdown-actually-does)). Before
them a test could only `handle.abort()` the server task, which skips every
graceful path by construction.
:::

## Stopping without a signal

`with_shutdown()` hands back a
[`ShutdownHandle`](https://docs.rs/neva/latest/neva/app/struct.ShutdownHandle.html)
alongside the app:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let (app, shutdown) = App::new()
        .with_options(|opt| opt.with_default_http())
        .with_shutdown();

    let server = tokio::spawn(app.run());

    // ... later, from anywhere:
    shutdown.shutdown();

    server.await.expect("the server task panicked");
}
```

The handle **composes with the signal handler rather than replacing it** —
whichever fires first wins — so a server built this way still stops on Ctrl+C.

Shutdown is *requested* by the handle, not completed by it: `shutdown()`
returns as soon as the request is recorded. **Await `run()`** to know the
server actually finished.

## Sharing a signal you already own

Embedded in a service with its own lifecycle, take the signal from that service
instead of handing one out:

```rust
use neva::prelude::*;
use neva::app::ShutdownHandle;

let shutdown = ShutdownHandle::new();
let app = App::new().with_shutdown_signal(shutdown.clone());

let server = tokio::spawn(app.run());
shutdown.shutdown();
server.await.expect("the server task panicked");
```

| Method | Description |
|---|---|
| `ShutdownHandle::new()` | A handle backed by a fresh signal |
| `ShutdownHandle::from_token(token)` | Wraps an existing `tokio_util::sync::CancellationToken`, so the server stops on a signal another subsystem already owns |
| `handle.shutdown()` | Requests shutdown. Idempotent |
| `handle.is_shutdown_requested()` | Whether shutdown was *requested* — not whether it finished |

Clones share one signal: any clone calling `shutdown()` stops the server the
handle came from.

## What shutdown actually does

Under [MCP 2026-07-28](../spec-2026-07-28) a server ending a
[subscription](./subscriptions) on its own initiative SHOULD send the empty
result first, so a client can tell an orderly end from a dropped connection.
Delivering it means shutdown is two-phase:

1. The signal **ends the subscriptions**, and the server waits until the
   registry is empty and no message is still inside the middleware pipeline —
   together that means every result has reached the outbound channel.
2. Only then is the transport torn down, and the writers **drain what is
   queued** before they exit.

`with_shutdown_drain(..)` caps the whole teardown:

```rust
use std::time::Duration;

App::new()
    .with_shutdown_drain(Duration::from_secs(5))
    .with_options(|opt| opt.with_default_http())
    .run()
    .await;
```

| | |
|---|---|
| Default | 2 seconds |
| It is a **ceiling, not a delay** | The wait ends the moment the last result is queued, and is skipped outright when no subscription is open — a server that never uses them shuts down exactly as fast as it did before |
| `Duration::ZERO` | Opts out, restoring an abrupt close |

Raise it for a server whose subscriptions have deep buffers to flush.

:::note The two halves share one budget
The deadline is stamped when the shutdown request arrives. Waiting for the
subscriptions to answer spends part of it; the writers get the remainder.
Whatever is still writing when it runs out is stopped rather than left on a
runtime that may outlive the server.
:::

## Under `run_blocking`

[`run_blocking()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.run_blocking)
builds a runtime, runs the server on it, and drops the runtime the moment
`run` returns — so anything still draining in a detached task would be aborted
mid-write. `run` waits for the transport writers before returning, which is
what makes the drain mean the same thing under both runners.

:::warning Fixed in 0.5.5
That last leg — `run` waiting for the writers rather than returning on the same
signal that started them draining — landed in **0.5.5**. Cancelling the
transport token used to do two things at once: the writers began draining what
was queued, and `run`'s own loop broke on that same signal and returned.
Nothing joined the first to the second, so on 0.5.4 the subscription phase
works but under `run_blocking` a writer that had not finished is aborted
mid-drain — the abrupt close the drain exists to prevent. If you rely on the
graceful close, take the patch release.
:::

## The HTTP engine has to stop too

An [`HttpEngine`](./custom-http) is handed a `CancellationToken` and is
expected to bring its listener down when the token fires. That contract is what
the drain rests on: `run` waits for the engine's own `run` to return, so an
engine that takes the token and never acts on it spends the whole shutdown
budget on every stop.

:::warning Fixed in 0.5.5
The bundled Volga engine took the token and used it only to report its own
failures, so the listener came down on Volga's signal handling and nothing
else. A server stopped through a `ShutdownHandle` rather than Ctrl+C returned
from `run` **with the port still bound and serving**, until whatever owned the
runtime dropped it — which under `tokio::spawn` may be never. Ctrl+C was
unaffected. If you stop servers from code, this is the fix to take.
:::

## Learn By Example

* [Subscriptions → How a subscription ends](./subscriptions#how-a-subscription-ends)
* [`examples/subscriptions`](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
