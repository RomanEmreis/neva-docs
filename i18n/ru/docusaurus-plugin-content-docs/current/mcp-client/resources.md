---
sidebar_position: 3
---

# Ресурсы

В главе [Основы](/docs/mcp-client/basics#read-a-resource) мы научились читать ресурс.
В этом разделе подробнее рассмотрим работу с ресурсами, предоставляемыми MCP-сервером.

## Чтение ресурса

Для чтения ресурса используйте метод [`read_resource()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.read_resource).
Он принимает имя инструмента и необязательные аргументы.

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio(
                "cargo",
                ["run", "--manifest-path", "./neva-mcp-server/Cargo.toml"]));

    client.connect().await?;

    let resource = client.read_resource("res://resource-1").await?

    println!("{:?}", result.contents);

    client.disconnect().await
}
```

## Содержимое

В приведённом выше примере метод [`read_resource`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.read_resource) возвращает [`ReadResourceResult`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.ReadResourceResult.html),
содержащий [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) из [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html).

Доступ к отдельным полям ресурса осуществляется с помощью следующих методов:

* [`uri()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.uri)
* [`title()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.title)
* [`mime()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.mime)
* [`annotations()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.annotations)
* [`text()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.text) — возвращает текстовое содержимое
* [`blob()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.blob) — возвращает бинарное содержимое (blob)
* [`json()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.json) — возвращает JSON-содержимое

## Подписка на обновления ресурсов

Изменения ресурсов несут два уведомления:
`notifications/resources/list_changed` — когда меняется сам список (сервер
должен объявить `listChanged`), и `notifications/resources/updated` — когда
меняется конкретный ресурс (сервер должен объявить `subscribe`).

Регистрируйте обработчики **после `connect()`** — они проверяют то, что
объявляет сервер, а это неизвестно, пока не выполнен discovery:

```rust
client.on_resources_changed(|_: Notification| async {
    println!("Resource list has been updated");
});

client.on_resource_changed(|n: Notification| async move {
    let params = n.params::<SubscribeRequestParams>()
        .expect("Expected SubscribeRequestParams");

    println!("Resource '{}' has been updated", params.uri);
});
```

Одних обработчиков мало: в MCP 2026-07-28 клиент запрашивает уведомления
потоком `subscriptions/listen`, где и живёт подписка на конкретный ресурс:

```rust
let mut subscription = client
    .listen(SubscriptionFilter::new()
        .with_resources_changed()
        .with_resource("res://some-resource"))
    .await?;

// ...

subscription.cancel().await?;
```

О фильтре, подтверждении и жизненном цикле подписки см.
[Подписки](./subscriptions).

:::note Замена `subscribe_to_resource`
`client.subscribe_to_resource(uri)` / `unsubscribe_from_resource(uri)` — это
легаси-пара. Они остаются скомпилированными (двойной режим по-прежнему
достаёт до легаси-серверов), но на узле 2026-07-28 отвечают
`MethodNotFound`. Используйте `SubscriptionFilter::with_resource(uri)`, как
выше.
:::

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/client) доступен здесь.

### Дополнительные примеры

* [Подписки (MCP 2026-07-28)](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
* [Подписка на обновления ресурсов (легаси)](https://github.com/RomanEmreis/neva/tree/main/examples/subscription)
