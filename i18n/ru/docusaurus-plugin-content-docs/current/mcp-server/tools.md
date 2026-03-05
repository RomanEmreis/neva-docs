---
sidebar_position: 2
---

# Инструменты

Model Context Protocol (MCP) позволяет серверам предоставлять [инструменты](https://modelcontextprotocol.io/specification/draft/server/tools), которые могут вызываться языковыми моделями. Инструменты позволяют моделям взаимодействовать с внешними системами: делать запросы к базам данных, вызывать API, выполнять вычисления. Каждый инструмент уникально идентифицируется по имени и содержит метаданные с описанием его схемы.

В главе [Основы](/docs/mcp-server/basics#setup-a-tool) мы научились объявлять простой инструмент:

```rust
use neva::prelude::*;

#[tool(descr = "A simple 'say hello' tool")]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

Того же результата можно добиться **без** использования процедурного макроса:

```rust
use neva::prelude::*;

async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    let mut mcp_server = App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP Server")
            .with_version("1.0.0"));

    mcp_server
        .map_tool("hello", hello)
        .with_description("A simple 'say hello' tool");

    mcp_server.run().await;
}
```

В примере выше имя инструмента должно быть задано явно.
При использовании атрибутного макроса [`#[tool]`](https://docs.rs/neva/latest/neva/attr.tool.html) имя инструмента автоматически выводится из имени функции.

Все остальные параметры инструмента, доступные в атрибутном макросе, можно настроить с помощью методов `with_*` (например, [`with_description()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_description)).

Метод [`map_tool()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_tool) регистрирует обработчик инструмента под указанным именем и возвращает изменяемую ссылку на зарегистрированный [инструмент](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html).

## Схема входных данных

Для инструмента можно явно задать [схему входных данных](https://docs.rs/neva/latest/neva/types/tool/struct.ToolSchema.html).
Если схема не указана, Neva автоматически генерирует её на основе сигнатуры функции-обработчика.

Для переопределения сгенерированной схемы укажите её в виде JSON-строки:

```rust
#[tool(
    descr = "A simple 'say hello' tool",
    input_schema = r#"{
        "properties": {
            "name": {
                "type": "string",
                "description": "The name to greet"
            }
        },
        "required": ["name"]
    }"#
)]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

## Схема выходных данных

Если инструмент возвращает [**структурированные данные**](https://modelcontextprotocol.io/specification/draft/server/tools#tool-result) (например, JSON-объект),
Neva автоматически генерирует [схему выходных данных](https://docs.rs/neva/latest/neva/types/tool/struct.ToolSchema.html) на основе возвращаемого типа.

Как и в случае [схемы входных данных](/docs/mcp-server/tools#input-schema),
её можно переопределить вручную:

```rust
#[tool(
    descr = "A 'say hello' tool with structured output",
    output_schema = r#"{
        "properties": {
            "message": {
                "type": "string",
                "description": "The generated greeting message"
            }
        },
        "required": ["message"]
    }"#
)]
async fn hello(say: String, name: String) -> Json<Results> {
    let result = Results {
        message: format!("{say}, {name}!")
    };
    result.into()
}
```

## MCP-контекст

В более сложных сценариях — например, когда инструменту нужен доступ к ресурсам, объявленным на том же MCP-сервере, — можно внедрить [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) в обработчик инструмента:

```rust
#[tool(descr = "Fetches resource metadata")]
async fn read_resource(ctx: Context, res: Uri) -> Result<Content, Error> {
    let result = ctx.resource(res).await?;
    let resource = result.contents
        .into_iter()
        .next()
        .expect("No resource contents");
    Ok(Content::resource(resource))
}
```


## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/server) доступен здесь.
