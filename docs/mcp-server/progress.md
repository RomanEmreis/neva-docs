---
sidebar_position: 10
---

# Progress

For long-running tools, Neva can emit **progress notifications** (`notifications/progress`) to keep clients informed about how far along a task has progressed.

## Enabling Progress Notifications

Progress notifications are emitted via [`tracing`](https://docs.rs/tracing). Configure the notification layer using [`notification::fmt::layer()`](https://docs.rs/neva/latest/neva/types/notification/fmt/fn.layer.html):

```rust
use neva::prelude::*;
use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(notification::fmt::layer())
        .init();

    App::new()
        .with_options(|opt| opt
            .with_tasks(|tasks| tasks.with_all())
            .with_default_http())
        .run()
        .await;
}
```

:::tip
[`with_tasks()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_tasks) enables the [Tasks](./tasks) feature, which is required for clients to issue a `progressToken` alongside a tool call. See the [Tasks](./tasks) guide for more details.
:::

## Reporting Progress from a Tool

Inject [`Meta<ProgressToken>`](https://docs.rs/neva/latest/neva/types/struct.Meta.html) into your tool handler to access the progress token provided by the client. Then emit progress events using the `tracing::info!` macro with the `target: "progress"` target:

```rust
use neva::prelude::*;

#[tool]
async fn long_running_task(token: Meta<ProgressToken>, command: String) {
    tracing::info!("Starting {command}");

    let mut progress = 0;
    loop {
        if progress == 100 {
            break;
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        progress += 5;

        tracing::info!(
            target: "progress",
            token = %token,   // The progress token from the client
            value = progress, // Current progress value
            total = 100       // Total (optional)
        );
    }

    tracing::info!("{command} has been successfully completed!");
}
```

### Required tracing fields

| Field | Description |
|---|---|
| `target: "progress"` | Routes the event to the MCP progress notification handler |
| `token = %token` | The [`ProgressToken`](https://docs.rs/neva/latest/neva/types/enum.ProgressToken.html) from the client request |
| `value = <number>` | Current progress value |
| `total = <number>` | *(Optional)* Total steps; helps clients display a percentage |

If a client does not include a `progressToken` in its request, `Meta<ProgressToken>` will still be present but empty — progress events emitted with it will simply be discarded.

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/progress).
