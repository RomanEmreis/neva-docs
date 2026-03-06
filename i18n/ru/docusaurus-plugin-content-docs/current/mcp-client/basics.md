---
sidebar_position: 1
---

# Основы

Давайте воспользуемся MCP-клиентом Neva для подключения к вашим MCP-серверам (и другим тоже).

## Создание приложения

Создайте новое бинарное приложение:
```bash
cargo new neva-mcp-client
cd neva-mcp-client
```

Добавьте следующие зависимости в ваш `Cargo.toml`:

```toml
[dependencies]
neva = { version = "0.2.5", features = "client-full" }
tokio = { version = "1", features = ["full"] }
```

## Вызов инструмента {#call-a-tool}

Для начала вызовем инструмент, созданный в разделе [основы сервера](/docs/mcp-server/basics#setup-a-tool).

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

    let args = ("name", "John");
    let result = client.call_tool("hello", args).await?;

    println!("{:?}", result.content);

    client.disconnect().await
}
```

Здесь мы настраиваем [MCP-клиент](https://docs.rs/neva/latest/neva/client/struct.Client.html) для подключения к серверу через `stdio`.
После подключения можно вызывать инструменты, получать запросы или читать ресурсы вплоть до отключения (или удаления клиента).

## Получение промпта {#get-a-prompt}

Далее получим [промпт](/docs/mcp-server/basics#adding-a-prompt-handler), чтобы увидеть, как они работают на стороне клиента.

```rust
let args = ("lang", "Rust");
let prompt = client.get_prompt("hello_world_code", args).await?;
```

## Чтение ресурса {#read-a-resource}

Затем прочитаем ресурс, объявленный [здесь](/docs/mcp-server/basics#adding-a-resource-tempate-handler).
```rust
let resource = client.read_resource("res://resource-1").await?;
```

## Список инструментов, промптов и ресурсов

Наконец, вот как динамически изучить все доступные инструменты, промпты и ресурсы.

```rust
// Возвращает список инструментов
let tools = client
    .list_tools(None)
    .await?;

// Возвращает список ресурсов
let resources = client
    .list_resources(None)
    .await?;

// Возвращает список шаблонов ресурсов
let templates = client
    .list_resource_templates(None)
    .await?;

// Возвращает список промптов
let prompts = client
    .list_prompts(None)
    .await?;
```

## Пагинация

Большие списки по умолчанию возвращаются постранично по 10 элементов.
Используйте значение [`next_cursor`](https://docs.rs/neva/latest/neva/types/cursor/struct.Cursor.html) для получения следующих страниц:

```rust
// Первые 10
let resources = client
    .list_resources(None)
    .await?;

// Следующие 10
let resources = client
    .list_resources(resources.next_cursor)
    .await?;

// Ещё 10
let resources = client
    .list_resources(resources.next_cursor)
    .await?;
```

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/client) доступен здесь.
