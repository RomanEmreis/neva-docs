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

## Необязательные аргументы {#optional-arguments}

Аргумент, объявленный как `Option<T>`, публикуется с `"required": false`, а
`prompts/get`, который его не передал, отдаёт обработчику `None`:

```rust
#[prompt(descr = "Generates a user message requesting a hello world code generation.")]
async fn hello_world_code(lang: String, tone: Option<String>) -> PromptMessage {
    let tone = tone.unwrap_or_else(|| "neutral".into());
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}, tone: {tone}"))
}
```

Если вы собираете список аргументов вручную,
[`PromptArgument::named(name, required)`](https://docs.rs/neva/latest/neva/types/prompt/struct.PromptArgument.html#method.named) —
это форма без описания; `PromptArgument::required` и
`PromptArgument::optional` — то же самое с описанием.

## Имена аргументов {#argument-names}

Аргументы промпта читаются из `prompts/get` **по имени**, поэтому имена, по
которым читает обработчик, обязаны совпадать с теми, что публикует
`prompts/list`.

`#[prompt]` берёт имена параметров самой функции. У «голого» замыкания их
нет — Rust их не сохраняет, — и оно откатывается к позиционным `arg0`,
`arg1`, … Макрос `map_prompt!` считывает их с замыкания:

```rust
use neva::{App, map_prompt, types::Role};

#[tokio::main]
async fn main() {
    let mut app = App::new();

    map_prompt!(app, "analyze", |lang: String, code: String| async move {
        (format!("Analyze this {lang} code: {code}"), Role::User)
    })
    .with_description("Analyzes a code snippet");

    app.run().await;
}
```

[`Prompt::with_args()`](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html#method.with_args) —
явная форма: она задаёт публикуемые аргументы и имена для извлечения одним
вызовом, так что разойтись они не могут.

Промпт, публикующий аргументы, которые его обработчик не читает, роняет
`App::run` при старте — см.
[Инструменты → Проверка при старте](./tools#startup-validation): к промптам
применяется то же правило.

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
