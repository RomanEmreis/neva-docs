---
sidebar_position: 2
---

# Инструменты

В главе [Основы](/docs/mcp-client/basics#call-a-tool) мы научились вызывать простой инструмент.
В этом разделе подробнее рассмотрим, как **вызывать инструменты**, **передавать аргументы**, **обрабатывать структурированные результаты** и **валидировать выходные данные** по схемам инструментов, предоставляемым MCP-сервером.

## Вызов инструмента

Для вызова инструмента используйте [`client.tools().call()`](https://docs.rs/neva/latest/neva/client/api/struct.Tools.html#method.call).
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
    let result = client.tools().call("hello", args).await?;

    println!("{:?}", result.content);

    client.disconnect().await
}
```

## Передача аргументов

Если инструмент принимает один параметр, передайте кортеж с именем параметра и его значением:

```rust
let args = ("name", "John");
let result = client.tools().call("hello", args).await?;
```

Если инструмент принимает **несколько параметров**, передайте их в виде массива, [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) или [`HashMap`](https://doc.rust-lang.org/std/collections/struct.HashMap.html):

```rust
let args = [
    ("name", "John"),
    ("say", "Hi"),
];
let result = client.tools().call("hello", args).await?;
```

Если инструмент **не принимает параметров**, передайте [тип-единицу `()`](https://doc.rust-lang.org/std/primitive.unit.html):

```rust
let result = client.tools().call("hello", ()).await?;
```

## Структурированное содержимое

Некоторые инструменты возвращают структурированные JSON-данные (см. [спецификацию MCP Structured Content](https://modelcontextprotocol.io/specification/draft/server/tools#structured-content)).

Доступ к ним можно получить напрямую через поле [`struct_content`](https://docs.rs/neva/latest/neva/types/tool/call_tool_response/struct.CallToolResponse.html#structfield.struct_content):

```rust
let result = client.tools().call("weather-forecast", args).await?;
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
let result = client.tools().call("weather-forecast", args).await?;
let weather: Weather = result.as_json()?;
```

## Валидация структурированных результатов

Хорошей практикой является валидация структурированных ответов по [**схеме выходных данных**](/docs/mcp-server/tools#output-schema), которую должен предоставлять каждый MCP-сервер.

Получая список инструментов через [`client.tools().list()`](https://docs.rs/neva/latest/neva/client/api/struct.Tools.html#method.list), вы получаете метаданные каждого инструмента, включая схемы входных и выходных данных.

```rust
#[json_schema(de, debug)]
struct Weather {
    conditions: String,
    temperature: f32,
    humidity: f32,
}

// Получаем список доступных инструментов
let tools = client.tools().list(None).await?;

// Находим конкретный инструмент
let tool = tools.get("weather-forecast")
    .expect("No weather-forecast tool found");

// Вызываем инструмент
let args = ("location", "London");
let result = client.tools().call(&tool.name, args).await?;

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


## Сырые вызовы {#raw-calls}

[`call_raw()`](https://docs.rs/neva/latest/neva/client/api/struct.Tools.html#method.call_raw) принимает полностью
сформированные [`CallToolRequestParams`](https://docs.rs/neva/latest/neva/types/tool/struct.CallToolRequestParams.html)
и отвечает сырым JSON-RPC `Response`, включая ответ-ошибку. `_meta`, который
несут параметры, уходит как есть — например, `traceparent`, — кроме токена
прогресса: он принадлежит клиенту, потому что уведомления о прогрессе находят
свой вызов именно по нему:

```rust
let params = CallToolRequestParams::new("add").with_args([("a", 1), ("b", 2)]);
let response = client.tools().call_raw(params).await?;
```

## Инструменты с UI {#tools-with-a-ui}

Инструмент может нести метаданные [MCP Apps](./apps), называющие HTML-документ,
который хост для него рендерит. `tool.ui()` читает блок обратно, а
`tool.is_model_visible()` отвечает, может ли агент вообще видеть этот инструмент:
сервер перечисляет инструменты только для приложения как любые другие, так что
отфильтровать их — задача хоста:

```rust
for tool in tools.tools.iter() {
    if !tool.is_model_visible() {
        continue; // iframe его вызвать может, модель видеть не должна
    }
}
```

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/client) доступен здесь.
