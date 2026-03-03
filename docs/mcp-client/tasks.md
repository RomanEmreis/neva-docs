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

Use [`call_tool_as_task()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.call_tool_as_task) to execute a tool asynchronously as a managed task.
This is required when calling a tool that has `task_support = "required"` on the server side (see the [server Tasks guide](/docs/mcp-server/tasks)).

```rust
let result = client.call_tool_as_task("my_long_tool", (), None).await;
println!("{:?}", result);
```

### With a TTL

Pass an optional TTL (in milliseconds) to automatically cancel the task if it exceeds the given time limit:

```rust
let ttl = 10_000; // 10 seconds
let result = client.call_tool_as_task("endless_tool", (), Some(ttl)).await;
```

If the TTL expires before the tool completes, the task is cancelled and an appropriate error is returned.

### With Arguments

Pass arguments the same way as with [`call_tool()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.call_tool):

```rust
let args = [("city1", "London"), ("city2", "Paris")];
let result = client.call_tool_as_task("generate_weather_report", args, None).await;
```

## Listing Active Tasks

Use [`list_tasks()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.list_tasks) to retrieve the current list of running or completed tasks:

```rust
let tasks = client.list_tasks(None).await?;
println!("{:?}", tasks);
```

## Handling Sampling and Elicitation in Tasks

Task-capable tools may trigger [sampling](/docs/mcp-client/sampling) or [elicitation](/docs/mcp-client/elicitation) mid-execution.
To support these interactions within a task call, configure sampling and elicitation handlers on the client before connecting:

```rust
#[sampling]
async fn sampling_handler(params: CreateMessageRequestParams) -> CreateMessageResult {
    // Handle the LLM sampling request
    CreateMessageResult::assistant()
        .with_model("gpt-5")
        .with_content("Response text")
        .end_turn()
}

#[elicitation]
async fn elicitation_handler(params: ElicitRequestParams) -> ElicitResult {
    match params {
        ElicitRequestParams::Form(_) => ElicitResult::decline(),
        ElicitRequestParams::Url(_) => ElicitResult::accept(),
    }
}

let mut client = Client::new()
    .with_options(|opt| opt
        .with_tasks(|t| t.with_all())
        .with_default_http());
```

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/tasks).
