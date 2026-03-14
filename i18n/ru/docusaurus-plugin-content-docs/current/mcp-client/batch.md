---
sidebar_position: 10
---

# Пакетные запросы

Neva поддерживает **пакетные запросы JSON-RPC 2.0** — способ отправить несколько запросов к серверу за один сетевой обмен и получить все ответы сразу.
Это удобно, когда нужно получить несколько независимых данных (список инструментов, ресурсы, результаты промптов и т.д.) и хочется минимизировать задержку.

## Создание пакета

Используйте [`client.batch()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.batch), чтобы получить [`BatchBuilder`](https://docs.rs/neva/latest/neva/client/batch/struct.BatchBuilder.html), добавьте нужные запросы цепочкой и вызовите `.send()`:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_default_http());

    client.connect().await?;

    let responses = client
        .batch()
        .list_tools()
        .list_resources()
        .call_tool("add", [("a", 40_i32), ("b", 2_i32)])
        .send()
        .await?;

    println!("{responses:?}");

    client.disconnect().await
}
```

[`send()`](https://docs.rs/neva/latest/neva/client/batch/struct.BatchBuilder.html#method.send) возвращает `Vec<Response>` в том же порядке, в котором были добавлены запросы.

## Доступные методы пакета

| Метод | Эквивалент одиночного вызова |
|---|---|
| `.list_tools()` | `client.list_tools(None)` |
| `.call_tool(name, args)` | `client.call_tool(name, args)` |
| `.list_resources()` | `client.list_resources(None)` |
| `.read_resource(uri)` | `client.read_resource(uri)` |
| `.list_resource_templates()` | `client.list_resource_templates(None)` |
| `.list_prompts()` | `client.list_prompts(None)` |
| `.get_prompt(name, args)` | `client.get_prompt(name, args)` |
| `.ping()` | `client.ping()` |
| `.notify(method, params)` | уведомление без ожидания ответа |

## Обработка ответов

Каждый элемент возвращаемого `Vec<Response>` соответствует запросу по порядку. Используйте [`into_result::<T>()`](https://docs.rs/neva/latest/neva/types/enum.Response.html#method.into_result) для десериализации ответа в нужный тип:

```rust
let responses = client
    .batch()
    .list_tools()
    .call_tool("add", [("a", 40_i32), ("b", 2_i32)])
    .send()
    .await?;

let tools = responses[0].clone().into_result::<ListToolsResult>()?;
let add   = responses[1].clone().into_result::<CallToolResponse>()?;

println!("Инструменты: {:?}", tools.tools);
println!("add(40, 2) = {:?}", add.content);
```

### Деструктуризация по шаблону

Для пакета фиксированного размера можно деструктурировать срез напрямую:

```rust
let responses = client
    .batch()
    .list_tools()
    .list_resources()
    .list_prompts()
    .call_tool("add", [("a", 40_i32), ("b", 2_i32)])
    .read_resource("notes://daily")
    .get_prompt("greeting", [("name", "Neva")])
    .ping()
    .send()
    .await?;

let [tools, resources, prompts, add_result, daily, greeting, ping] =
    responses.as_slice() else {
        return Err(Error::new(ErrorCode::InternalError, "неожиданное количество ответов"));
    };

let tools    = tools.clone().into_result::<ListToolsResult>()?;
let add      = add_result.clone().into_result::<CallToolResponse>()?;
let daily    = daily.clone().into_result::<ReadResourceResult>()?;
let greeting = greeting.clone().into_result::<GetPromptResult>()?;
```

## Уведомления в пакете

Уведомления отправляются без ожидания ответа — они включаются в запрос, но **не** порождают слот в возвращаемом `Vec`:

```rust
use serde_json::json;

let responses = client
    .batch()
    .notify("notifications/message", Some(json!({ "level": "info", "data": "hello" })))
    .list_tools()
    .send()
    .await?;

// responses содержит 1 элемент (только list_tools вернул ответ)
let tools = responses[0].clone().into_result::<ListToolsResult>()?;
```

## На стороне сервера

Никакой дополнительной настройки сервера не требуется. Любой Neva-сервер — на транспортах `stdio` и HTTP — обрабатывает пакетные запросы JSON-RPC 2.0 автоматически.
Стандартной конфигурации достаточно:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_default_http())
        .run()
        .await;
}
```

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/batch) доступен здесь.
