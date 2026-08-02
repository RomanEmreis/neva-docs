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
            .with_tasks()
            .with_default_http());

    client.connect().await?;

    // ...

    client.disconnect().await
}
```

В MCP 2026-07-28 Tasks — это расширение, и его возможность представлена
пустым объектом (само объявление и есть декларация), поэтому `with_tasks()`
не принимает замыкание.

:::note Под флагом `legacy-spec`
Действует поверхность 2025-11-25: `with_tasks(|t| t.with_all())` настраивает
поддерево `cancel` / `list` / `requests`, и существуют задачи на стороне
клиента. См. [Легаси-спецификация](../legacy-spec.md).
:::

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

## Опрос задачи

`tasks/get` — единственный метод опроса. Он возвращает `DetailedTask`:
статус и, в зависимости от него, незакрытые `inputRequests`, финальный
`result` либо `error`. `tasks/update` отвечает на эти input-запросы, а
`tasks/cancel` подтверждает пустым результатом (отмена кооперативная,
поэтому итог узнаётся опросом).

`client.task().call_tool(...)` прогоняет этот цикл за вас и разрешается
финальным исходом, поэтому обращаться к методам напрямую обычно не нужно.

:::warning `tasks/list` больше нет
`tasks/list` и `tasks/result` удалены в MCP 2026-07-28, вместе с ними —
`Client::list_tasks`. Идентификатор задачи — это долговременный дескриптор,
который у запросившей стороны уже есть, поэтому **перечисление — ваша
задача**: храните нужные идентификаторы и опрашивайте их по отдельности.
:::

В протоколе `ttl` сериализуется как `ttlMs`, а `poll_interval` — как
`pollIntervalMs`; `ttl` допускает `null` в значении «без ограничения».
Уведомление о статусе называется `notifications/tasks`.

:::note
В спецификации подписка на `notifications/tasks` оформляется через механизм
[`subscriptions/listen`](./subscriptions). Сам `subscriptions/listen` в neva
реализован начиная с 0.5.1, но статус задач пока не входит в категории его
фильтра — уведомление никем не доставляется, поэтому **опрашивайте задачу
через `tasks/get`**.
:::

## Обработка получения данных в задачах

Инструменты с поддержкой задач могут запросить ввод в процессе выполнения.
Зарегистрируйте обработчик [получения данных](/docs/mcp-client/elicitation)
макросом `#[elicitation]`; фреймворк вызовет его, когда серверный инструмент
обратится к `ctx.task().elicit()` в ходе выполнения задачи.

```rust
#[elicitation]
async fn elicitation_handler(params: ElicitRequestParams) -> ElicitResult {
    match params {
        ElicitRequestParams::Url(_url) => ElicitResult::accept(),
        ElicitRequestParams::Form(_form) => ElicitResult::decline(),
    }
}
```

:::warning Сэмплирования, расширенного задачей, нет
MCP 2026-07-28 убрал серверный push-запрос `sampling/createMessage`, поэтому
отвечать на сэмплирование в рамках задачи не приходится.
[Сэмплирование](/docs/mcp-client/sampling) теперь идёт по подложке MRTR,
которая никогда не смешивается с подложкой задач: одна перезапускается,
другая приостанавливается.
:::

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/tasks) доступен здесь.
