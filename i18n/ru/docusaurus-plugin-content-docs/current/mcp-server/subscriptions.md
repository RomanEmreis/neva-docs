---
sidebar_position: 17
---

# Подписки

В [MCP 2026-07-28](../spec-2026-07-28) клиент подписывается на серверные
уведомления одним долгоживущим запросом **`subscriptions/listen`** с фильтром.
На стороне сервера **писать обработчик не нужно**: neva отвечает на
`subscriptions/listen` сама и рассылает ваши обычные вызовы `Context` во все
потоки, чей фильтр их допускает.

:::info Появилось в neva 0.5.1
Доставка по подпискам появилась в **neva 0.5.1**. До этого `listChanged` и
`resources.subscribe` были скрыты в сборке по умолчанию, потому что доставлять
их было нечем. Теперь поток listen может это делать, поэтому сервер,
настроенный с `with_list_changed()` / `with_subscribe()`, снова объявляет эти
возможности в протоколе.
:::

## Объявите то, что умеете отправлять

Принятый фильтр — это запрошенный, **суженный до объявленных возможностей**,
так что объявленное сервером и есть то, на что клиент может подписаться:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http.bind("127.0.0.1:3000").with_endpoint("/mcp"))
            .with_tools(|tools| tools.with_list_changed())
            .with_prompts(|prompts| prompts.with_list_changed())
            .with_resources(|res| res.with_list_changed().with_subscribe()))
        .run()
        .await;
}
```

| Возможность | Открывает | Уведомление |
|---|---|---|
| `tools.listChanged` | `toolsListChanged` | `notifications/tools/list_changed` |
| `prompts.listChanged` | `promptsListChanged` | `notifications/prompts/list_changed` |
| `resources.listChanged` | `resourcesListChanged` | `notifications/resources/list_changed` |
| `resources.subscribe` | `resourceSubscriptions` | `notifications/resources/updated` |

Категория, о которой клиент просит, но которую сервер не объявляет,
**исключается из подтверждения**, а не приводит к отказу. Подписка всё равно
открывается, и клиент сразу узнаёт, что эти типы никогда не придут.

## Ваши обработчики не меняются

Мутирующие методы `Context` рассылают уведомления сами — все существующие
места вызова продолжают работать, а сервер, у которого раньше не было
подписок, теперь их питает:

```rust
// Отправляет `notifications/tools/list_changed` каждому потоку, который просил
ctx.add_tool(Tool::new("greet", || async { "hello" })).await?;
let _ = ctx.remove_tool("greet").await?;

// `notifications/prompts/list_changed`
let _ = ctx.remove_prompt("summarize").await?;

// `notifications/resources/list_changed`
ctx.add_resource(Resource::new("res://config", "config")).await?;
let _ = ctx.remove_resource("res://config").await?;

// `notifications/resources/updated` — только потокам, где указан этот URI
ctx.resource_updated("res://config").await?;
```

Реестр живёт в общем `McpOptions`, поэтому `Context` любого выполняющегося
запроса достаёт до всех живых потоков — уведомление не заперто внутри того
запроса, который его породил.

Уведомления журнала и прогресса **не** подписочные и сохраняют поведение в
области запроса: они идут по потоку ответа того запроса, который их вызвал, —
см. [Журналирование → Доставка](./logging#delivery).

`notifications/tasks` в спецификации является категорией подписки, но в
`SubscriptionFilter` его пока нет, поэтому в сборке по умолчанию
`Context::task_changed` некуда доставлять, а клиенты узнают статус задачи
опросом [`tasks/get`](./tasks).

## Кто слушает

[`Context::is_subscribed`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.is_subscribed)
отвечает по живым потокам, так что можно не делать работу, которую всё равно
никто не получит:

```rust
if ctx.is_subscribed(&"res://config".into()) {
    // кто-то слушает этот ресурс
    ctx.resource_updated("res://config").await?;
}
```

## Что идёт по проводу

```
--> subscriptions/listen  { "notifications": SubscriptionFilter }
<-- notifications/subscriptions/acknowledged  { "notifications": …, "_meta": { subscriptionId } }
<-- notifications/tools/list_changed          { "_meta": { subscriptionId } }
…
<-- { "id": …, "result": { "resultType": "complete", "_meta": { subscriptionId } } }
```

Подтверждение всегда **первое** сообщение в потоке, и каждое сообщение несёт
`_meta["io.modelcontextprotocol/subscriptionId"]`, чтобы клиент, у которого по
одному каналу идёт несколько подписок, мог их разделить.

## Как завершается подписка

| Что происходит | Где применимо |
|---|---|
| `notifications/cancelled` для запроса listen | `stdio` |
| Клиент закрывает поток | Streamable HTTP |
| Закрытие транспорта | оба |
| Остановка сервера | оба — после корректного пустого результата |

По HTTP `notifications/cancelled` едет отдельным `POST` и ничего не доказывает
о том, кто открыл поток, поэтому корректный механизм там — закрытие тела
ответа, и клиент видит `Cancelled`, а не финальный результат.

## Транспорты

| Транспорт | Как несётся поток |
|---|---|
| Streamable HTTP | `POST` с listen получает ответ `text/event-stream`, и уведомления идут в его теле. Это третий способ превратить `POST` в поток — наряду с `logLevel` и `progressToken`, — и, в отличие от них, он не требует фичи `tracing` |
| `stdio` | Сообщения перемежаются с выводом в stdout |

## Под флагом `legacy-spec`

Пара RPC-методов возвращается, и подпиской снова владеет сервер:
`Context::subscribe_to_resource`, `Context::unsubscribe_from_resource` и
`resource::commands::{SUBSCRIBE, UNSUBSCRIBE}` существуют только под
[`legacy-spec`](../legacy-spec). В сборке по умолчанию уберите
`ctx.subscribe_to_resource(..)` из обработчиков — подпиской теперь владеет
клиент, и серверу добавлять нечего.

## Обучение на примерах

* [`examples/subscriptions`](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
  — сервер и клиент по HTTP
* [`examples/updates`](https://github.com/RomanEmreis/neva/tree/main/examples/updates)
  — изменения ресурсов, порождающие уведомления
* [Клиент → Подписки](../mcp-client/subscriptions) — вторая половина
