---
sidebar_position: 11
---

# Подписки

В [MCP 2026-07-28](../spec-2026-07-28) клиент получает серверные уведомления,
только *попросив* о них: один долгоживущий запрос
**`subscriptions/listen`** несёт фильтр, а всё, на что клиент подписался,
приходит по потоку ответа этого же запроса.

Один этот запрос заменяет сразу две вещи — отдельный SSE-поток `GET` и пару
RPC-методов `resources/subscribe` / `resources/unsubscribe`. Подписка на
конкретный ресурс никуда не делась: она стала URI внутри фильтра,
привязанным к тому потоку, который её несёт.

:::info Появилось в neva 0.5.1
`Client::listen` появился в **neva 0.5.1**. До него у серверных уведомлений
не было канала на HTTP-транспорте без состояния, и эта документация
советовала опрашивать сервер — но тот совет описывал release candidate, а не
финальную спецификацию. Он больше не актуален.
:::

## Открытие подписки

```rust
use neva::prelude::*;
use neva::types::notification::Notification;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http.bind("127.0.0.1:3000").with_endpoint("/mcp"))
            .with_timeout(Duration::from_secs(5)));

    client.connect().await?;

    // Сначала регистрируем обработчики — именно их питает поток.
    client.on_tools_changed(|_: Notification| async {
        println!("the tool list changed — time to re-list");
    });
    client.on_resource_changed(|n: Notification| async move {
        let params = n.params::<SubscribeRequestParams>()
            .expect("Expected SubscribeRequestParams");

        println!("resource '{}' has been updated", params.uri);
    });

    // Один поток, два типа уведомлений.
    let mut subscription = client
        .listen(SubscriptionFilter::new()
            .with_tools_changed()
            .with_resource("res://config"))
        .await?;

    // ... работа ...

    subscription.cancel().await?;
    println!("subscription ended: {:?}", subscription.closed().await);

    client.disconnect().await
}
```

[`Client::listen`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.listen)
возвращает управление только после того, как сервер **подтвердил** подписку,
поэтому полученный `Subscription` — это уже живой поток.

## Фильтр

[`SubscriptionFilter`](https://docs.rs/neva/latest/neva/types/subscription/struct.SubscriptionFilter.html)
— набор явных согласий: сервер не имеет права доставлять категорию, о которой
его не просили, а отсутствующее поле означает ровно «не подписан»:

| Метод построителя | Поле протокола | Что доставляет |
|---|---|---|
| `with_tools_changed()` | `toolsListChanged` | `notifications/tools/list_changed` |
| `with_prompts_changed()` | `promptsListChanged` | `notifications/prompts/list_changed` |
| `with_resources_changed()` | `resourcesListChanged` | `notifications/resources/list_changed` |
| `with_resource(uri)` / `with_resources(uris)` | `resourceSubscriptions` | `notifications/resources/updated` для этих URI |

[Логи](../mcp-server/logging#delivery) и
[прогресс](../mcp-server/progress) подписки не требуют — они остаются в
области запроса и идут по потоку ответа того запроса, который их породил.
`notifications/tasks` в спецификации *является* категорией подписки, но в
фильтре neva его пока нет, поэтому [статус задачи](./tasks) по-прежнему
узнают опросом `tasks/get`.

## Обработчики — сначала, и после `connect()`

Уведомления, пришедшие по потоку, направляются в обычные обработчики,
зарегистрированные через
[`Client::subscribe`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.subscribe)
и его помощники (`on_tools_changed`, `on_prompts_changed`,
`on_resources_changed`, `on_resource_changed`). **Существующий клиентский код
менять не нужно** — именно поэтому в neva нет отдельного потока на каждую
подписку, который пришлось бы читать.

Отсюда два правила порядка:

* Регистрируйте обработчики **после `connect()`**. Помощники проверяют, что
  сервер объявляет соответствующую возможность, а возможности неизвестны, пока
  не выполнен discovery.
* Регистрируйте их **до `listen()`**. Подтверждение — первое сообщение в
  потоке, и уведомления могут пойти сразу за ним.

## Сервер может сузить ваш фильтр

Принятый фильтр — это запрошенный, пересечённый с тем, что сервер реально
объявляет. Категория, которую сервер не объявил, **исключается из
подтверждения**, а не приводит к отказу: подписка открывается, и вы сразу
узнаёте, какие типы никогда не придут, вместо того чтобы бесконечно ждать
push, которого и не планировалось:

```rust
if !subscription.is_fully_honored() {
    println!("requested: {:?}", subscription.requested());
    println!("accepted:  {:?}", subscription.acknowledged());
}
```

Подтверждение *шире* запроса — нарушение протокола: `listen` отклоняет его с
`InvalidRequest`, и подписка не устанавливается.

## Дескриптор `Subscription`

Дескриптор отвечает за **жизненный цикл** потока, а не за его содержимое:

| Метод | Что даёт |
|---|---|
| [`id()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.id) | Идентификатор подписки — JSON-RPC-идентификатор запроса `subscriptions/listen`, который несёт `_meta` каждого сообщения |
| [`requested()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.requested) | Фильтр, который запросил клиент |
| [`acknowledged()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.acknowledged) | Подмножество, которое согласился обслуживать сервер |
| [`is_fully_honored()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.is_fully_honored) | Ничего ли не было отсечено |
| [`cancel()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.cancel) | Завершает подписку |
| [`closed()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.closed) | Дожидается завершения и сообщает, как оно произошло |

## Как завершается подписка

[`closed()`](https://docs.rs/neva/latest/neva/client/struct.Subscription.html#method.closed)
разрешается в
[`SubscriptionEnd`](https://docs.rs/neva/latest/neva/client/enum.SubscriptionEnd.html):

| Вариант | Значение |
|---|---|
| `Cancelled` | Этот клиент вызвал `cancel()` |
| `Graceful(SubscriptionsListenResult)` | Сервер ответил на запрос listen результатом закрытия. Результат называет подписку, которую закрывает, и ответ с чужим идентификатором сообщается как `Abrupt` |
| `Abrupt` | Поток исчез без финального результата — разорванное соединение, таймаут или упавший сервер |

Подписки **не восстанавливаются**: клиент, который хочет слушать дальше,
отправляет `subscriptions/listen` заново.

Уничтожение дескриптора также завершает подписку, равно как и
`Client::disconnect` — ни то, ни другое не может оставить сервер вещающим в
клиент, которому уже нечем его остановить.

:::tip Почему по HTTP — `Cancelled`, а не `Graceful`
Отмена закрывает тело ответа на `POST` с listen, и именно это и есть механизм
отмены по спецификации на HTTP. Канала для финального результата не остаётся,
и его никто не ждёт.
:::

## Каждое сообщение несёт идентификатор подписки

Каждое сообщение потока — подтверждение, любое уведомление, финальный
результат — несёт `_meta["io.modelcontextprotocol/subscriptionId"]`. Именно
это позволяет клиенту разделять несколько подписок, идущих по одному каналу
(а на `stdio` это всегда так). neva проверяет это за вас: подписочное
уведомление, пришедшее без метки, вне области фильтра или раньше
подтверждения, отбрасывается, а не передаётся обработчикам, которые ничего не
знают о подписках.

## Транспорты

| Транспорт | Как устроен поток |
|---|---|
| Streamable HTTP | Подписка едет в теле `text/event-stream` того самого `POST` с listen; его закрытие завершает подписку |
| `stdio` | Сообщения перемежаются с выводом в stdout; подписка завершается по `notifications/cancelled` |

:::warning Недоступно в батче
[`call_batch`](./batch) отклоняет `subscriptions/listen` внутри батча с
`InvalidRequest`. Слот батча — обычный слот запроса: конечный TTL, простой
`Response`, никакого дескриптора, — поэтому открытая так подписка не имела бы
чем отмениться и пережила бы вызов, её породивший. Используйте
`Client::listen`.
:::

## Переход с `subscribe_to_resource`

Спецификация не удаляет `resources/subscribe` и `resources/unsubscribe`, а
сворачивает их в `resourceSubscriptions`. На клиенте старые методы остаются
скомпилированными — двойной режим по-прежнему достаёт до легаси-серверов, — но
на узле 2026-07-28 отвечают `MethodNotFound`:

```rust
// Было (легаси)
client.subscribe_to_resource("res://some-resource").await?;
// ...
client.unsubscribe_from_resource("res://some-resource").await?;

// Стало (MCP 2026-07-28)
let mut subscription = client
    .listen(SubscriptionFilter::new().with_resource("res://some-resource"))
    .await?;
// ...
subscription.cancel().await?;
```

Серверная половина пары исчезает целиком:
`Context::subscribe_to_resource` / `unsubscribe_from_resource` переехали за
флаг [`legacy-spec`](../legacy-spec), потому что подпиской теперь владеет
клиент. См. [Сервер → Подписки](../mcp-server/subscriptions).

## Обучение на примерах

* [`examples/subscriptions`](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
  — сервер и клиент по HTTP
* [`examples/subscription`](https://github.com/RomanEmreis/neva/tree/main/examples/subscription)
  — легаси-сценарий с `resources/subscribe`
