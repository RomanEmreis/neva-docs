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
            .with_tasks(|t| t.with_all())
            .with_default_http());

    client.connect().await?;

    // ...

    client.disconnect().await
}
```

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

## Listing Active Tasks

Use [`list_tasks()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.list_tasks) to retrieve the current list of running or completed tasks:

```rust
let tasks = client.list_tasks(None).await?;
println!("{:?}", tasks);
```

## Handling Sampling and Elicitation in Tasks

Task-capable tools may trigger [sampling](/docs/mcp-client/sampling) or [elicitation](/docs/mcp-client/elicitation) mid-execution.
To support these interactions, register handlers using the `#[sampling]` and `#[elicitation]` macros. The framework invokes them automatically when the server-side tool calls `ctx.sample()` or `ctx.elicit()` during task execution.

```rust
#[sampling]
async fn sampling_handler(params: CreateMessageRequestParams) -> CreateMessageResult {
    CreateMessageResult::assistant()
        .with_model("gpt-5")
        .with_content("Response text")
        .end_turn()
}

#[elicitation]
async fn elicitation_handler(params: ElicitRequestParams) -> ElicitResult {
    match params {
        ElicitRequestParams::Url(_url) => ElicitResult::accept(),
        ElicitRequestParams::Form(_form) => ElicitResult::decline(),
    }
}
```

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/tasks).
