---
sidebar_position: 14
---

# Типы содержимого

Обработчики инструментов и ресурсов MCP могут возвращать различные виды содержимого — не только обычный текст. На этой странице описаны все доступные типы содержимого и случаи их применения.

## Типы ответов инструментов

Обработчики инструментов могут возвращать любой тип, конвертируемый в [`CallToolResponse`](https://docs.rs/neva/latest/neva/types/tool/struct.CallToolResponse.html). Наиболее распространённые:

### Текст

Возврат `String` или `&str` из обработчика `#[tool]` автоматически создаёт текстовый ответ:

```rust
#[tool(descr = "Greets a user")]
async fn greet(name: String) -> String {
    format!("Hello, {name}!")
}
```

### Структурированный JSON

Для возврата сериализуемого типа в виде структурированного вывода оберните его в [`Json<T>`](https://docs.rs/neva/latest/neva/types/struct.Json.html) и используйте как возвращаемый тип:

```rust
use neva::prelude::*;
use serde::Serialize;

#[derive(Serialize)]
struct WeatherReport {
    city: String,
    temperature_c: f64,
    condition: String,
}

#[tool(descr = "Returns weather for a city")]
async fn get_weather(city: String) -> Json<WeatherReport> {
    WeatherReport {
        city,
        temperature_c: 22.5,
        condition: "Sunny".into(),
    }
    .into()
}
```

`Json<T>` автоматически преобразуется в `CallToolResponse` со структурированным содержимым. Также можно явно сконструировать с помощью `Json(value)` или вызвать `CallToolResponse::json(value)` при ручном формировании ответа.

### Изображения

Возвращайте бинарные данные изображения с помощью [`Content::image()`](https://docs.rs/neva/latest/neva/types/struct.Content.html#method.image). Данные должны быть в формате base64:

```rust
use neva::prelude::*;

#[tool(descr = "Returns a chart image")]
async fn generate_chart(data: String) -> CallToolResponse {
    let png_bytes = render_chart(&data); // ваша логика рендеринга

    let image = Content::image(png_bytes)
        .with_mime("image/png");

    CallToolResponse::from(image)
}
```

MIME-тип по умолчанию — `image/jpg`. Используйте `.with_mime()` для указания другого типа.

### Аудио

Возвращайте аудиоданные аналогичным образом, используя [`Content::audio()`](https://docs.rs/neva/latest/neva/types/struct.Content.html#method.audio):

```rust
#[tool(descr = "Returns synthesized speech")]
async fn synthesize(text: String) -> CallToolResponse {
    let wav_bytes = text_to_speech(&text); // ваша TTS-логика

    let audio = Content::audio(wav_bytes)
        .with_mime("audio/wav");

    CallToolResponse::from(audio)
}
```

MIME-тип по умолчанию — `audio/wav`.

### Несколько элементов содержимого

Используйте `CallToolResponse::array()` для возврата нескольких элементов содержимого в одном ответе:

```rust
use neva::prelude::*;

#[tool(descr = "Returns analysis with a chart")]
async fn analyze(data: String) -> CallToolResponse {
    let summary = Content::text(format!("Analysis of: {data}"));
    let chart = Content::image(render_chart(&data)).with_mime("image/png");

    CallToolResponse::array([summary, chart])
}
```

### Ссылки на ресурсы

Ссылка на внешний ресурс без его встраивания:

```rust
use neva::prelude::*;

#[tool(descr = "Returns a link to the report")]
async fn get_report_link(id: String) -> CallToolResponse {
    let link = Content::from(
        ResourceLink::from(format!("res://reports/{id}"))
    );
    CallToolResponse::from(link)
}
```

### Встроенные ресурсы

Встраивание ресурса непосредственно в ответ инструмента:

```rust
use neva::prelude::*;

#[tool(descr = "Returns report contents inline")]
async fn get_report_inline(id: String) -> CallToolResponse {
    let uri: Uri = format!("res://reports/{id}").parse().unwrap();
    let contents = ResourceContents::new(uri.clone())
        .with_text("Report contents here...");

    let embedded = Content::from(EmbeddedResource::from(contents));
    CallToolResponse::from(embedded)
}
```

### Ответы с ошибками

Сигнализируйте об ошибке на уровне инструмента, которую модель может прочитать и проанализировать. В отличие от ошибок Rust (прерывающих запрос), ошибки инструментов возвращаются как структурированное содержимое:

```rust
#[tool(descr = "Fetches a record")]
async fn fetch_record(id: String) -> CallToolResponse {
    match load_from_db(&id).await {
        Ok(record) => CallToolResponse::json(record),
        Err(e) => CallToolResponse::error(e.to_string()),
    }
}
```

Различие между ошибками инструментов и ошибками уровня запроса описано в разделе [Обработка ошибок](./error-handling).

---

## Типы содержимого ресурсов

Обработчики ресурсов возвращают [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/enum.ResourceContents.html), которое может быть текстом, JSON или бинарными данными.

### Текст

```rust
#[resource(uri = "note://{id}", title = "Read note")]
async fn get_note(uri: Uri, id: String) -> ResourceContents {
    let text = load_note(&id).await;
    ResourceContents::new(uri).with_text(text)
}
```

### JSON

```rust
use serde_json::json;

#[resource(uri = "config://{key}", title = "Read config")]
async fn get_config(uri: Uri, key: String) -> ResourceContents {
    let value = json!({ "key": key, "enabled": true });
    ResourceContents::new(uri).with_json(value)
}
```

### Бинарные данные (Blob)

```rust
#[resource(uri = "file://{path}", title = "Read file", mime = "application/octet-stream")]
async fn get_file(uri: Uri, path: String) -> ResourceContents {
    let bytes = std::fs::read(&path).unwrap_or_default();
    ResourceContents::new(uri).with_blob(bytes)
}
```

---

## Сокращённые возвращаемые типы

Neva реализует `Into<CallToolResponse>` для многих распространённых типов, поэтому зачастую не нужно явно конструировать `CallToolResponse`:

| Возвращаемый тип | Эквивалентно |
|------------------|--------------|
| `String` | `CallToolResponse::new(text)` |
| `&str` | `CallToolResponse::new(text)` |
| `Json<T>` | `CallToolResponse::json(value)` |
| `(String, String)` | Текстовый кортеж из двух полей (uri, body) |
| `Vec<Content>` | `CallToolResponse::array(items)` |
| `Content` | Ответ с одним элементом |

Аналогично для `ResourceContents`:

| Возвращаемый тип | Эквивалентно |
|------------------|--------------|
| `String` | `ResourceContents::new(uri).with_text(s)` |
| `(String, String)` | URI + текстовое тело |
| `serde_json::Value` | `ResourceContents::new(uri).with_json(v)` |
