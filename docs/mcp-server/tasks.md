---
sidebar_position: 12
---

# Tasks

Neva supports **long-running tasks** — a way to call tools asynchronously and manage their lifecycle. Tasks allow clients to execute tools that may take a long time or require additional interactions, with optional TTL-based cancellation.

Under MCP 2026-07-28 Tasks is an **extension**
([`modelcontextprotocol/ext-tasks`](https://github.com/modelcontextprotocol/ext-tasks)),
advertised as `capabilities.extensions["io.modelcontextprotocol/tasks"]`.
Neva registers it through the `Extension` trait; `with_tasks()` thinly wraps
that registration.

## Enabling Tasks on the Server

Use [`with_tasks()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_tasks) to enable task support:

```rust
use neva::prelude::*;

fn main() {
    App::new()
        .with_options(|opt| opt
            .with_default_http()
            .with_tasks())
        .run_blocking();
}
```

The extension capability is an **empty object** — advertising it *is* the
declaration — so `with_tasks()` takes no closure.

:::note Under `legacy-spec`
The 2025-11-25 surface applies instead: a `cancel` / `list` / `requests`
capability sub-tree configured with `with_tasks(|t| t.with_all())`, plus
`tasks/list`, `tasks/result`, and client-hosted tasks. See
[Legacy spec](../legacy-spec.md).
:::

## Declaring a Task-Capable Tool

Mark a tool as a task by setting `task_support = "required"` in the `#[tool]` attribute macro:

```rust
#[tool(task_support = "required")]
async fn endless_tool() {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}
```

A tool marked with `task_support = "required"` must be called as a task (via [`client.task().call_tool()`](https://docs.rs/neva/latest/neva/client/task/struct.TaskBuilder.html#method.call_tool) on the client side). Calling it as a regular tool will be rejected.

## The Task Methods

| Method | What it does |
|---|---|
| `tasks/get` | The single polling method. Returns a `DetailedTask`: the status plus, depending on it, the outstanding `inputRequests`, the terminal `result`, or the `error` |
| `tasks/update` | The client answers a task's input requests, keyed to what `tasks/get` surfaced |
| `tasks/cancel` | Acknowledges with an empty result — cancellation is cooperative, so the outcome is learned by polling |

`tasks/list` and `tasks/result` **do not exist**. A task id is a durable
handle the requestor already holds, so enumeration is the requestor's job.

`CreateTaskResult` is flat (`Result & Task`) and carries
`resultType: "task"` — the task's fields sit at the top level rather than
under a nested `task` object. On the wire, `Task::ttl` serializes as
`ttlMs` (now `Option<usize>`, matching the schema's nullable "unlimited"
case) and `poll_interval` as `pollIntervalMs`. The status notification is
`notifications/tasks`.

Each task method also carries `params.taskId` in the `Mcp-Name` routing
header, so an intermediary can route a task's calls to the instance holding
its state.

## Combining Tasks with Elicitation

A task-capable tool can await user input mid-execution via `ctx.task()`:

```rust
#[tool(task_support = "required")]
async fn tool_with_elicitation(mut ctx: Context, task: Meta<RelatedTaskMetadata>) -> String {
    let params = ElicitRequestParams::form("Are you sure to proceed?")
        .with_related_task(task);

    // A task does not re-run — it genuinely suspends. So unlike the MRTR
    // `ctx.elicit(key, params)`, this takes no replay key.
    let res = ctx.task().elicit(params.into()).await;

    format!("{:?}", res.unwrap().action)
}
```

[`Meta<RelatedTaskMetadata>`](https://docs.rs/neva/latest/neva/types/struct.Meta.html) carries task context automatically injected by the framework. It is passed to [`with_related_task()`](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestFormParams.html#method.with_related_task) so the client can correlate the elicitation request with the running task.

:::warning Tasks and sampling do not mix
There is no task-augmented *sampling* in MCP 2026-07-28. Sampling lost its
capability-driven server→client request and now lives on the
[MRTR substrate](../spec-2026-07-28.md#multi-round-trip-requests-mrtr)
(`ctx.sample(key, params)`), which never mixes with the task substrate — the
one suspends, the other re-runs. Elicitation is the only input kind a task
can await.
:::

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/tasks).
