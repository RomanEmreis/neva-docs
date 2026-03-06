---
sidebar_position: 4
---

# Промпты

Model Context Protocol (MCP) предоставляет стандартизированный способ для серверов предоставлять клиентам [шаблоны промптов](https://modelcontextprotocol.io/specification/draft/server/prompts). Промпты позволяют серверам передавать структурированные сообщения и инструкции для взаимодействия с языковыми моделями. Клиенты могут получать список доступных промптов, извлекать их содержимое и передавать аргументы для их настройки.

В главе [Основы](/docs/mcp-server/basics#adding-a-prompt-handler) мы научились объявлять простой промпт:
```rust
#[prompt(descr = "Generates a user message requesting a hello world code generation.")]
async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}
```

Того же результата можно добиться **без** использования процедурного макроса:
```rust
use neva::prelude::*;

async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}

#[tokio::main]
async fn main() {
    let mut mcp_server = App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP Server")
            .with_version("1.0.0"));

    mcp_server
        .map_prompt("hello_world_code", hello_world_code)
        .with_description("Generates a user message requesting a hello world code generation.");

    mcp_server.run().await;
}
```

В примере выше имя промпта должно быть задано явно.
При использовании атрибутного макроса [`#[prompt]`](https://docs.rs/neva/latest/neva/attr.prompt.html) имя промпта автоматически выводится из имени функции.

Все остальные параметры промпта, доступные в атрибутном макросе, можно настроить с помощью методов `with_*` (например, [`with_description()`](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html#method.with_description)).

Метод [`map_prompt()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_prompt) регистрирует обработчик промпта под указанным именем и возвращает изменяемую ссылку на зарегистрированный [промпт](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html).

## Входные аргументы

Для промпта можно явно задать [входные аргументы](https://docs.rs/neva/latest/neva/types/prompt/struct.PromptArgument.html).
Если аргументы не указаны, Neva автоматически генерирует их на основе сигнатуры функции-обработчика.

Для переопределения сгенерированной схемы укажите её в виде JSON-строки:
```rust
#[prompt(
    descr = "Generates a user message requesting a hello world code generation.",
    args = r#"[
        {
            "name": "lang",
            "description": "A language to use",
            "required": true
        }
    ]"#
)]
async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}
```

## MCP-контекст

В более сложных сценариях — например, когда промпту нужен доступ к ресурсам, объявленным на том же MCP-сервере, — можно внедрить [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) в обработчик промпта:

```rust
#[prompt(descr = "Generates a user message requesting a translate a text using the glossary.")]
async fn translate_with_glossary(ctx: Context, text: String) -> PromptMessage {
    let glossary = ctx.resource("res://glossary").await?;
    let resource = result.contents
        .into_iter()
        .next()
        .expect("No resource contents");

    PromptMessage::user()
        .with(format!("Translate using this glossary:\n{glossary}\n\nText: {text}"))
}
```

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/server) доступен здесь.
