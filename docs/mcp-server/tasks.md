---
sidebar_position: 11
---

# Tasks

Neva supports **long-running tasks** — a way to call tools asynchronously and manage their lifecycle. Tasks allow clients to execute tools that may take a long time or require additional interactions (such as sampling or elicitation), with optional TTL-based cancellation.

## Enabling Tasks on the Server

Use [`with_tasks()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_tasks) to enable task support:

```rust
use neva::prelude::*;

fn main() {
    App::new()
        .with_options(|opt| opt
            .with_default_http()
            .with_tasks(|t| t.with_all()))
        .run_blocking();
}
```

[`with_all()`](https://docs.rs/neva/latest/neva/types/struct.TasksCapability.html#method.with_all) enables all task-related capabilities. You can also enable them individually as needed.

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

## Combining Tasks with Sampling and Elicitation

Task-capable tools can also trigger sampling or elicitation mid-execution:

```rust
#[tool(task_support = "required")]
async fn tool_with_sampling(mut ctx: Context) -> String {
    let params = CreateMessageRequestParams::new()
        .with_message(SamplingMessage::from("Write a haiku."))
        .with_ttl(Some(5000));

    let res = ctx.sample(params).await;
    format!("{:?}", res.unwrap().content)
}

#[tool(task_support = "required")]
async fn tool_with_elicitation(mut ctx: Context, task: Meta<RelatedTaskMetadata>) -> String {
    let params = ElicitRequestParams::form("Are you sure to proceed?")
        .with_related_task(task);

    let res = ctx.elicit(params.into()).await;
    format!("{:?}", res.unwrap().action)
}
```

[`Meta<RelatedTaskMetadata>`](https://docs.rs/neva/latest/neva/types/struct.Meta.html) carries task context automatically injected by the framework. It is passed to [`with_related_task()`](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestFormParams.html#method.with_related_task) so the client can correlate the elicitation request with the running task.

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/tasks).
