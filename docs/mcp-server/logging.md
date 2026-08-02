---
sidebar_position: 9
---

# Logging

Neva integrates with Rust's [`tracing`](https://docs.rs/tracing) ecosystem to emit structured log messages. When a client asks for them, these log messages are forwarded to it as **MCP log notifications** (`notifications/message`).

## Logging is Request-Scoped

MCP 2026-07-28 removed the `logging/setLevel` handshake. There is no global
log level to negotiate any more — instead **each request opts in for
itself**, by carrying the desired minimum severity in
`_meta["io.modelcontextprotocol/logLevel"]`.

While the server handles that request, it emits `notifications/message` at
or above the requested severity and suppresses the rest. **A request with no
requested level produces no log notifications at all.**

`notifications/message` itself is kept by the spec, but is **deprecated** —
it exists for migration. For anything operational, prefer your host's own
telemetry pipeline.

:::note Under `legacy-spec`
The global model comes back: `logging/setLevel`, plus `with_logging(handle)`
and `set_log_level()`. Those APIs do not exist in the default build. See
[Legacy spec](../legacy-spec.md).
:::

## Setup

Add Neva's notification layer to your `tracing_subscriber` registry. No
reload handle and no `with_logging()` registration are needed — the layer
resolves each event's request-scoped level on its own:

```rust
use neva::prelude::*;
use neva::types::notification;
use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(notification::fmt::layer()) // Route logs to the requesting client
        .init();

    App::new()
        .with_options(|opt| opt.with_default_http())
        .run()
        .await;
}
```

Over **stdio**, use Neva's
[`NotificationFormatter`](https://docs.rs/neva/latest/neva/types/notification/struct.NotificationFormatter.html)
instead — every supported stdio setup keeps working unchanged, including a
formatter-only subscriber:

```rust
tracing_subscriber::registry()
    .with(tracing_subscriber::fmt::layer()
        .event_format(notification::NotificationFormatter))
    .init();
```

If you need the request-scoped level resolved from a typed span extension
rather than from the formatter itself, add
`notification::fmt::span_context()` alongside your own layers.

## Delivery

Request-scoped notifications flow on the **originating request's response
stream**, per the spec:

| Transport | How they arrive |
|---|---|
| `stdio` | Interleaved on stdout |
| Streamable HTTP | The `POST` that opted in gets a `text/event-stream` reply carrying its `notifications/message` and `notifications/progress`, followed by the response |

Every other `POST` stays a single JSON object — except a
[`subscriptions/listen`](./subscriptions) request, which streams for its own
reasons. Logs are **not** subscribable: they belong to the request that asked
for them, so a listen stream carries its own request-scoped logs and no one
else's.

The suppression rule — no `logLevel`, no `notifications/message` — holds on
every transport.

## Emitting Log Messages from Tools

Use standard `tracing` macros inside your handlers:

```rust
#[tool]
async fn my_tool() {
    tracing::info!(logger = "my_tool", "Processing started");
    tracing::warn!(logger = "my_tool", "Something looks off");
    tracing::debug!(logger = "my_tool", "Debug details here");
}
```

The optional `logger` field is forwarded to the client as part of the notification payload, allowing clients to identify the source of each log entry.

### Log Levels

Neva maps `tracing` severity levels to MCP log levels as follows:

| tracing level | MCP log level |
|---|---|
| `ERROR` | `error` |
| `WARN` | `warning` |
| `INFO` | `info` |
| `DEBUG` | `debug` |
| `TRACE` | `debug` |

## Requesting Logs from the Client

A Neva client asks for logs with
[`McpOptions::with_log_level`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_log_level),
which stamps the level onto every request's `_meta`:

```rust
use neva::prelude::*;
use neva::types::notification::LoggingLevel;

#[allow(deprecated)]
let mut client = Client::new()
    .with_options(|opt| opt
        .with_log_level(LoggingLevel::Info)
        .with_default_http());
```

The method carries `#[deprecated]` on arrival, mirroring the schema.

## Progress Notifications via Tracing

For long-running tools, Neva also uses `tracing` to emit **progress notifications** (`notifications/progress`).
See the [Progress](./progress) guide for details.

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/logging).
