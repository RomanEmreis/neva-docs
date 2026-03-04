---
sidebar_position: 14
---

# Content Types

MCP tool and resource handlers can return several different kinds of content — not just plain text. This page covers all available content types and when to use each.

## Tool Response Types

Tool handlers can return any type that converts into [`CallToolResponse`](https://docs.rs/neva/latest/neva/types/tool/struct.CallToolResponse.html). The most common ones:

### Text

Returning a `String` or `&str` from a `#[tool]` handler produces a text response automatically:

```rust
#[tool(descr = "Greets a user")]
async fn greet(name: String) -> String {
    format!("Hello, {name}!")
}
```

### Structured JSON

To return a serializable type as structured output, wrap it in [`Json<T>`](https://docs.rs/neva/latest/neva/types/struct.Json.html) and use it as the return type:

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

`Json<T>` automatically converts into a `CallToolResponse` with structured content. You can also construct it explicitly with `Json(value)` or call `CallToolResponse::json(value)` when building the response manually.

### Images

Return binary image data using [`Content::image()`](https://docs.rs/neva/latest/neva/types/struct.Content.html#method.image). The data must be base64-encoded bytes:

```rust
use neva::prelude::*;

#[tool(descr = "Returns a chart image")]
async fn generate_chart(data: String) -> CallToolResponse {
    let png_bytes = render_chart(&data); // your rendering logic

    let image = Content::image(png_bytes)
        .with_mime("image/png");

    CallToolResponse::from(image)
}
```

Default MIME type is `image/jpg`. Use `.with_mime()` to set a different type.

### Audio

Return audio data the same way using [`Content::audio()`](https://docs.rs/neva/latest/neva/types/struct.Content.html#method.audio):

```rust
#[tool(descr = "Returns synthesized speech")]
async fn synthesize(text: String) -> CallToolResponse {
    let wav_bytes = text_to_speech(&text); // your TTS logic

    let audio = Content::audio(wav_bytes)
        .with_mime("audio/wav");

    CallToolResponse::from(audio)
}
```

Default MIME type is `audio/wav`.

### Multiple Content Items

Use `CallToolResponse::array()` to return several content items in a single response:

```rust
use neva::prelude::*;

#[tool(descr = "Returns analysis with a chart")]
async fn analyze(data: String) -> CallToolResponse {
    let summary = Content::text(format!("Analysis of: {data}"));
    let chart = Content::image(render_chart(&data)).with_mime("image/png");

    CallToolResponse::array([summary, chart])
}
```

### Resource Links

Reference an external resource without embedding it:

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

### Embedded Resources

Embed a resource inline in the tool response:

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

### Error Responses

Signal a tool-level error that the model can read and reason about. Unlike Rust errors (which abort the request), tool errors are returned as structured content:

```rust
#[tool(descr = "Fetches a record")]
async fn fetch_record(id: String) -> CallToolResponse {
    match load_from_db(&id).await {
        Ok(record) => CallToolResponse::json(record),
        Err(e) => CallToolResponse::error(e.to_string()),
    }
}
```

See [Error Handling](./error-handling) for the difference between tool errors and request-level errors.

---

## Resource Content Types

Resource handlers return [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/enum.ResourceContents.html), which can be text, JSON, or binary.

### Text

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

### Binary (Blob)

```rust
#[resource(uri = "file://{path}", title = "Read file", mime = "application/octet-stream")]
async fn get_file(uri: Uri, path: String) -> ResourceContents {
    let bytes = std::fs::read(&path).unwrap_or_default();
    ResourceContents::new(uri).with_blob(bytes)
}
```

---

## Shorthand Return Types

Neva implements `Into<CallToolResponse>` for many common types, so you often don't need to construct `CallToolResponse` manually:

| Return type | Equivalent to |
|-------------|---------------|
| `String` | `CallToolResponse::new(text)` |
| `&str` | `CallToolResponse::new(text)` |
| `Json<T>` | `CallToolResponse::json(value)` |
| `(String, String)` | Two-field text tuple (uri, body) |
| `Vec<Content>` | `CallToolResponse::array(items)` |
| `Content` | Single-item response |

Similarly for `ResourceContents`:

| Return type | Equivalent to |
|-------------|---------------|
| `String` | `ResourceContents::new(uri).with_text(s)` |
| `(String, String)` | URI + text body |
| `serde_json::Value` | `ResourceContents::new(uri).with_json(v)` |
