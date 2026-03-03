---
sidebar_position: 8
---

# Logging

Neva integrates with Rust's [`tracing`](https://docs.rs/tracing) ecosystem to emit structured log messages. When configured correctly, these log messages are automatically forwarded to connected clients as **MCP log notifications** (`notifications/message`).

## Setup

To enable MCP log notifications, configure `tracing_subscriber` with Neva's [`NotificationFormatter`](https://docs.rs/neva/latest/neva/notification/struct.NotificationFormatter.html) and register the handle with [`with_logging()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_logging):

```rust
use neva::prelude::*;
use tracing_subscriber::{filter, reload, prelude::*};

#[tokio::main]
async fn main() {
    // Create a reloadable log filter with an initial level
    let (filter, handle) = reload::Layer::new(filter::LevelFilter::DEBUG);

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer()
            .event_format(notification::NotificationFormatter)) // Route logs to MCP clients
        .init();

    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_logging(handle)) // Register the reload handle
        .run()
        .await;
}
```

The `reload::Layer` allows the MCP server to dynamically change the log level at runtime, which MCP clients can request via the `logging/setLevel` method.

## Emitting Log Messages from Tools

Once logging is configured, use standard `tracing` macros inside your handlers to emit log messages:

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

## Progress Notifications via Tracing

For long-running tools, Neva also uses `tracing` to emit **progress notifications** (`notifications/progress`).
See the [Progress](./progress) guide for details.

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/logging).
