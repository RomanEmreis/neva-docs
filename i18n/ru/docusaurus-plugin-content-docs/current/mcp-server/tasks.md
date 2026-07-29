---
sidebar_position: 12
---

# Задачи

Neva поддерживает **долгосрочные задачи** — способ асинхронного вызова инструментов с управлением их жизненным циклом. Задачи позволяют клиентам выполнять инструменты, которые могут занимать много времени или требуют дополнительных взаимодействий, с опциональной отменой по истечении TTL.

В MCP 2026-07-28 Tasks — это **расширение**
([`modelcontextprotocol/ext-tasks`](https://github.com/modelcontextprotocol/ext-tasks)),
объявляемое через `capabilities.extensions["io.modelcontextprotocol/tasks"]`.
Neva регистрирует его через трейт `Extension`, а `with_tasks()` — тонкая
обёртка над этой регистрацией.

## Включение задач на сервере

Используйте [`with_tasks()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_tasks) для включения поддержки задач:

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

Возможность расширения представлена **пустым объектом** — само её объявление
и есть декларация, — поэтому `with_tasks()` не принимает замыкание.

:::note Под флагом `legacy-spec`
Действует поверхность 2025-11-25: поддерево возможностей
`cancel` / `list` / `requests`, настраиваемое через
`with_tasks(|t| t.with_all())`, а также `tasks/list`, `tasks/result` и задачи
на стороне клиента. См. [Легаси-спецификация](../legacy-spec.md).
:::

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

Инструмент, помеченный `task_support = "required"`, должен вызываться как задача (через [`client.task().call_tool()`](https://docs.rs/neva/latest/neva/client/task/struct.TaskBuilder.html#method.call_tool) на стороне клиента). Вызов его как обычного инструмента будет отклонён.

## Методы задач

| Метод | Что делает |
|---|---|
| `tasks/get` | Единственный метод опроса. Возвращает `DetailedTask`: статус и, в зависимости от него, незакрытые `inputRequests`, финальный `result` либо `error` |
| `tasks/update` | Клиент отвечает на input-запросы задачи, опираясь на то, что показал `tasks/get` |
| `tasks/cancel` | Подтверждает пустым результатом — отмена кооперативная, поэтому итог узнаётся опросом |

`tasks/list` и `tasks/result` **отсутствуют**. Идентификатор задачи — это
долговременный дескриптор, который у запросившей стороны уже есть, поэтому
перечисление — её собственная задача.

`CreateTaskResult` теперь плоский (`Result & Task`) и несёт
`resultType: "task"` — поля задачи лежат на верхнем уровне, а не во
вложенном объекте `task`. В протоколе `Task::ttl` сериализуется как `ttlMs`
(теперь `Option<usize>` — под допустимый по схеме случай «без ограничения»),
а `poll_interval` — как `pollIntervalMs`. Уведомление о статусе называется
`notifications/tasks`.

Каждый метод задач также несёт `params.taskId` в заголовке маршрутизации
`Mcp-Name`, чтобы промежуточный узел мог направить вызовы задачи на тот
экземпляр, где хранится её состояние.

## Комбинирование задач с получением данных

Инструмент с поддержкой задач может дождаться ввода пользователя прямо во
время выполнения — через `ctx.task()`:

```rust
#[tool(task_support = "required")]
async fn tool_with_elicitation(mut ctx: Context, task: Meta<RelatedTaskMetadata>) -> String {
    let params = ElicitRequestParams::form("Are you sure to proceed?")
        .with_related_task(task);

    // Задача не перезапускается — она действительно приостанавливается.
    // Поэтому, в отличие от MRTR-вызова `ctx.elicit(key, params)`,
    // replay-ключ здесь не нужен.
    let res = ctx.task().elicit(params.into()).await;

    format!("{:?}", res.unwrap().action)
}
```

[`Meta<RelatedTaskMetadata>`](https://docs.rs/neva/latest/neva/types/struct.Meta.html) несёт контекст задачи, автоматически внедряемый фреймворком. Он передаётся в [`with_related_task()`](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestFormParams.html#method.with_related_task), чтобы клиент мог связать запрос на получение данных с выполняющейся задачей.

:::warning Задачи и сэмплирование не сочетаются
В MCP 2026-07-28 нет сэмплирования, расширенного задачей. Сэмплирование
лишилось серверного запроса к клиенту и теперь живёт на
[подложке MRTR](../spec-2026-07-28.md#multi-round-trip-requests-mrtr),
которая никогда не смешивается с подложкой задач: одна приостанавливается,
другая перезапускается. Получение данных — единственный вид ввода, которого
может дождаться задача.
:::

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/tasks) доступен здесь.
