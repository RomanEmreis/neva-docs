---
sidebar_position: 2
---

# Инструменты

В главе [Основы](/docs/mcp-client/basics#call-a-tool) мы научились вызывать простой инструмент.
В этом разделе подробнее рассмотрим, как **вызывать инструменты**, **передавать аргументы**, **обрабатывать структурированные результаты** и **валидировать выходные данные** по схемам инструментов, предоставляемым MCP-сервером.

## Вызов инструмента

Для вызова инструмента используйте метод [`call_tool()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.call_tool).
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

    let args = ("name", "John");
    let result = client.call_tool("hello", args).await?;

    println!("{:?}", result.content);

    client.disconnect().await
}
```

## Передача аргументов

Если инструмент принимает один параметр, передайте кортеж с именем параметра и его значением:

```rust
let args = ("name", "John");
let result = client.call_tool("hello", args).await?;
```

Если инструмент принимает **несколько параметров**, передайте их в виде массива, [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) или [`HashMap`](https://doc.rust-lang.org/std/collections/struct.HashMap.html):

```rust
let args = [
    ("name", "John"),
    ("say", "Hi"),
];
let result = client.call_tool("hello", args).await?;
```

Если инструмент **не принимает параметров**, передайте [тип-единицу `()`](https://doc.rust-lang.org/std/primitive.unit.html):

```rust
let result = client.call_tool("hello", ()).await?;
```

## Структурированное содержимое

Некоторые инструменты возвращают структурированные JSON-данные (см. [спецификацию MCP Structured Content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content)).

Доступ к ним можно получить напрямую через поле [`struct_content`](https://docs.rs/neva/latest/neva/types/tool/call_tool_response/struct.CallToolResponse.html#structfield.struct_content):

```rust
let result = client.call_tool("weather-forecast", args).await?;
println!("{:?}", result.struct_content);
```

Или десериализовать в типизированную структуру с помощью [`as_json()`](https://docs.rs/neva/latest/neva/types/tool/call_tool_response/struct.CallToolResponse.html#method.as_json):

```rust
#[derive(Debug, serde::Deserialize)]
struct Weather {
    conditions: String,
    temperature: f32,
    humidity: f32,
}

let args = ("location", "London");
let result = client.call_tool("weather-forecast", args).await?;
let weather: Weather = result.as_json()?;
```

## Валидация структурированных результатов

Хорошей практикой является валидация структурированных ответов по [**схеме выходных данных**](/docs/mcp-server/tools#output-schema), которую должен предоставлять каждый MCP-сервер.

При вызове [`list_tools()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.list_tools) вы получаете метаданные каждого инструмента, включая схемы входных и выходных данных.

```rust
#[json_schema(de, debug)]
struct Weather {
    conditions: String,
    temperature: f32,
    humidity: f32,
}

// Получаем список доступных инструментов
let tools = client.list_tools(None).await?;

// Находим конкретный инструмент
let tool = tools.get("weather-forecast")
    .expect("No weather-forecast tool found");

// Вызываем инструмент
let args = ("location", "London");
let result = client.call_tool(&tool.name, args).await?;

// Валидируем и десериализуем результат
let weather: Weather = tool
    .validate(&result)
    .and_then(|res| res.as_json())?;
```

Макрос [`json_schema`](https://docs.rs/neva/latest/neva/attr.json_schema.html) автоматически выводит метаданные JSON-схемы из ваших Rust-структур, обеспечивая совместимость с [`serde`](https://serde.rs/).
Его поведение можно настроить с помощью атрибутов:

* `de` — только десериализация
* `ser` — только сериализация
* `serde` — и сериализация, и десериализация
* `debug` — включение отладочных метаданных в сгенерированную схему


## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/client) доступен здесь.
