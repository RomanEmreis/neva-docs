---
sidebar_position: 9
---

# Задачи

Клиенты Neva поддерживают **долгосрочные задачи** — расширенный способ асинхронного вызова инструментов с опциональной отменой по TTL и управлением жизненным циклом.

## Включение задач на клиенте

Используйте [`with_tasks()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_tasks) для включения поддержки задач:

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

## Вызов инструмента как задачи

Используйте [`client.task()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.task) для получения строителя задачи, затем вызовите [`call_tool()`](https://docs.rs/neva/latest/neva/client/task/struct.TaskBuilder.html#method.call_tool) для асинхронного выполнения инструмента в виде управляемой задачи.
Это необходимо при вызове инструмента с `task_support = "required"` на стороне сервера (см. [руководство по задачам сервера](/docs/mcp-server/tasks)).

```rust
let result = client
    .task()
    .call_tool("my_long_tool", ()).await;

println!("{:?}", result);
```

### С TTL

Цепочечно вызовите [`with_ttl()`](https://docs.rs/neva/latest/neva/client/task/struct.TaskBuilder.html#method.with_ttl) (в миллисекундах) для автоматической отмены задачи при превышении указанного лимита времени:

```rust
let ttl = 10_000; // 10 секунд
let result = client
    .task()
    .with_ttl(ttl)
    .call_tool("endless_tool", ()).await;
```

Если TTL истекает до завершения инструмента, задача отменяется и возвращается соответствующая ошибка.

### С аргументами

Передавайте аргументы так же, как в [`call_tool()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.call_tool):

```rust
let args = [("city1", "London"), ("city2", "Paris")];
let result = client
    .task()
    .call_tool("generate_weather_report", args).await;
```

## Получение списка активных задач

Используйте [`list_tasks()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.list_tasks) для получения текущего списка выполняющихся или завершённых задач:

```rust
let tasks = client.list_tasks(None).await?;
println!("{:?}", tasks);
```

## Обработка сэмплирования и получения данных в задачах

Инструменты с поддержкой задач могут инициировать [сэмплирование](/docs/mcp-client/sampling) или [получение данных](/docs/mcp-client/elicitation) в процессе выполнения.
Для поддержки этих взаимодействий зарегистрируйте обработчики с помощью макросов `#[sampling]` и `#[elicitation]`. Фреймворк вызывает их автоматически, когда серверный инструмент обращается к `ctx.sample()` или `ctx.elicit()` в ходе выполнения задачи.

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

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/tasks) доступен здесь.
