---
sidebar_position: 4
---

# Промпты

В главе [Основы](/docs/mcp-client/basics#get-a-prompt) мы научились получать простой промпт.
В этом разделе подробнее рассмотрим работу с промптами, предоставляемыми MCP-сервером.

## Получение промпта

Для получения промпта используйте [`client.prompts().get()`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html#method.get).
Он принимает имя промпта и необязательные аргументы.

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

    let args = ("lang", "Rust");
    let prompt = client.prompts().get("hello_world_code", args).await?;

    println!("{prompt.descr:?}: {prompt.messages:?}");

    client.disconnect().await
}
```

## Передача аргументов

Если промпт принимает один параметр, передайте кортеж с именем параметра и его значением:

```rust
let args = ("lang", "Rust");
let prompt = client.prompts().get("hello_world_code", args).await?;
```

Если промпт принимает **несколько параметров**, передайте их в виде массива, [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) или [`HashMap`](https://doc.rust-lang.org/std/collections/struct.HashMap.html):

```rust
let args = [
    ("lang", "Rust"),
    ("topic", "Hello World function"),
];
let prompt = client.prompts().get("write_code", args).await?;
```

Если промпт **не принимает параметров**, передайте [тип-единицу `()`](https://doc.rust-lang.org/std/primitive.unit.html):

```rust
let prompt = client.prompts().get("rust_hello_world", ()).await?;
```

## Список промптов {#listing-prompts}

[`list(cursor)`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html#method.list) запрашивает одну
страницу промптов сервера, а [`list_all()`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html#method.list_all)
обходит все страницы:

```rust
for prompt in client.prompts().list_all().await? {
    println!("{}: {:?}", prompt.name, prompt.descr);
}
```

Промпт выбирает пользователь, а не вызывает модель. Чтобы начать с него
разговор, [`neva::svir::prompt_messages`](../svir#prompts-and-resources)
превращает его в сообщения, которые отправляются модели.

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/client) доступен здесь.
