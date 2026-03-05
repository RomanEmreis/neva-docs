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

Когда список доступных ресурсов изменяется на сервере и MCP-сервер объявил `listChanged`,
публикуется уведомление `notifications/resources/list_changed`.
На стороне клиента можно подписаться на него следующим образом:

```rust
client.on_resources_changed(|_: Notification| async {
    println!("Resource list has been updated");
});
```

Кроме того, когда конкретный ресурс обновляется на сервере,
отправляется уведомление `notifications/resources/updated`.
Для подписки или отписки от этих обновлений используйте:

```rust
client.on_resource_changed(|n: Notification| async move {
    let params = n.params::<SubscribeRequestParams>()
        .expect("Expected SubscribeRequestParams");

    println!("Resource '{}' has been updated", params.uri);
});

client.subscribe_to_resource("res://some-resource").await?;

// ...

client.unsubscribe_from_resource("res://some-resource").await?;
```

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/client) доступен здесь.

### Дополнительные примеры

* [Подписка на обновления ресурсов](https://github.com/RomanEmreis/neva/tree/main/examples/subscription)
