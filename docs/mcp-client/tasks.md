---
sidebar_position: 9
---

# Tasks

Neva clients support **long-running tasks** — an extended way to call tools asynchronously with optional TTL-based cancellation and lifecycle management.

## Enabling Tasks on the Client

Use [`with_tasks()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_tasks) to enable task support:

```rust
use std::time::Duration;
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_tasks()
            .with_default_http());

    client.connect().await?;

    // ...

    client.disconnect().await
}
```

Tasks is an extension under MCP 2026-07-28, and its capability is an empty
object — advertising it *is* the declaration — so `with_tasks()` takes no
closure.

:::note Under `legacy-spec`
The 2025-11-25 surface applies: `with_tasks(|t| t.with_all())` configures a
`cancel` / `list` / `requests` sub-tree, and client-hosted tasks exist. See
[Legacy spec](../legacy-spec.md).
:::

## Calling a Tool as a Task

Use [`client.task()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.task) to obtain a task builder, then call [`call_tool()`](https://docs.rs/neva/latest/neva/client/task/struct.TaskBuilder.html#method.call_tool) to execute a tool asynchronously as a managed task.
This is required when calling a tool that has `task_support = "required"` on the server side (see the [server Tasks guide](/docs/mcp-server/tasks)).

```rust
let result = client
    .task()
    .call_tool("my_long_tool", ()).await;

println!("{:?}", result);
```

### With a TTL

Chain [`with_ttl()`](https://docs.rs/neva/latest/neva/client/task/struct.TaskBuilder.html#method.with_ttl) (in milliseconds) to automatically cancel the task if it exceeds the given time limit:

```rust
let ttl = 10_000; // 10 seconds
let result = client
    .task()
    .with_ttl(ttl)
    .call_tool("endless_tool", ()).await;
```

If the TTL expires before the tool completes, the task is cancelled and an appropriate error is returned.

### With Arguments

Pass arguments the same way as with [`call_tool()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.call_tool):

```rust
let args = [("city1", "London"), ("city2", "Paris")];
let result = client
    .task()
    .call_tool("generate_weather_report", args).await;
```

## Polling a Task

`tasks/get` is the single polling method. It returns a `DetailedTask` — the
status plus, depending on it, the outstanding `inputRequests`, the terminal
`result`, or the `error`. `tasks/update` answers those input requests, and
`tasks/cancel` acknowledges with an empty result (cancellation is
cooperative, so the outcome is learned by polling).

`client.task().call_tool(...)` drives that loop for you and resolves to the
terminal outcome, so most code never issues the methods directly.

:::warning There is no `tasks/list`
`tasks/list` and `tasks/result` were removed in MCP 2026-07-28, and so was
`Client::list_tasks`. A task id is a durable handle the requestor already
holds, so **enumeration is your job** — keep the ids you care about and poll
them individually.
:::

On the wire, `ttl` serializes as `ttlMs` and `poll_interval` as
`pollIntervalMs`; `ttl` is nullable, meaning "unlimited". The status
notification is `notifications/tasks`.

:::note
Opting into `notifications/tasks` is the spec's `subscriptions/listen`
mechanism, which does not exist in neva yet and is tracked separately. Poll
with `tasks/get` in the meantime.
:::

## Handling Elicitation in Tasks

Task-capable tools may ask for input mid-execution. Register an
[elicitation](/docs/mcp-client/elicitation) handler with the
`#[elicitation]` macro; the framework invokes it when the server-side tool
calls `ctx.task().elicit()` during task execution.

```rust
#[elicitation]
async fn elicitation_handler(params: ElicitRequestParams) -> ElicitResult {
    match params {
        ElicitRequestParams::Url(_url) => ElicitResult::accept(),
        ElicitRequestParams::Form(_form) => ElicitResult::decline(),
    }
}
```

:::warning No task-augmented sampling
MCP 2026-07-28 removed the server-push `sampling/createMessage` request, so
there is no task-augmented sampling to answer.
[Sampling](/docs/mcp-client/sampling) now rides the MRTR substrate, which
never mixes with the task substrate — the one re-runs, the other suspends.
:::

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/tasks).
