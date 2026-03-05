---
sidebar_position: 11
---

# Задачи

Neva поддерживает **долгосрочные задачи** — способ асинхронного вызова инструментов с управлением их жизненным циклом. Задачи позволяют клиентам выполнять инструменты, которые могут занимать много времени или требуют дополнительных взаимодействий (например, сэмплирование или получение данных), с опциональной отменой по истечении TTL.

## Включение задач на сервере

Используйте [`with_tasks()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_tasks) для включения поддержки задач:

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

[`with_all()`](https://docs.rs/neva/latest/neva/types/struct.TasksCapability.html#method.with_all) включает все возможности, связанные с задачами. При необходимости их можно включать по отдельности.

## Объявление инструмента с поддержкой задач

Пометьте инструмент как задачу, указав `task_support = "required"` в атрибутном макросе `#[tool]`:

```rust
#[tool(task_support = "required")]
async fn endless_tool() {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}
```

Инструмент, помеченный `task_support = "required"`, должен вызываться как задача (через [`call_tool_as_task()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.call_tool_as_task) на стороне клиента). Вызов его как обычного инструмента будет отклонён.

## Комбинирование задач с сэмплированием и получением данных

Инструменты с поддержкой задач также могут инициировать сэмплирование или получение данных в процессе выполнения:

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

[`Meta<RelatedTaskMetadata>`](https://docs.rs/neva/latest/neva/types/struct.Meta.html) несёт контекст задачи, автоматически внедряемый фреймворком. Он передаётся в [`with_related_task()`](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestFormParams.html#method.with_related_task), чтобы клиент мог связать запрос на получение данных с выполняющейся задачей.

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/tasks) доступен здесь.
