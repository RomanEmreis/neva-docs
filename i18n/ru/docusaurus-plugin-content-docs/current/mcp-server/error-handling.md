---
sidebar_position: 15
---

# Обработка ошибок

Поведение ошибок в Neva зависит от того, какой тип обработчика их возвращает.

## Обработчики инструментов: все ошибки становятся ошибками инструмента

Для обработчиков `#[tool]` **любая ошибка, возвращённая из обработчика, всегда становится ошибкой инструмента** — успешным JSON-RPC ответом с `is_error: true` в содержимом. Модель ИИ получает её как читаемое содержимое и может анализировать его (повторить попытку, перефразировать, использовать запасной вариант).

Это применяется независимо от того, возвращаете ли вы `Err(...)` из `Result`, распространяете с помощью `?`, или явно вызываете `CallToolResponse::error()`:

```rust
use neva::prelude::*;

#[tool(descr = "Reads a record by ID")]
async fn get_record(id: String) -> Result<String, Error> {
    if id.is_empty() {
        // Это становится ошибкой инструмента, видимой модели
        return Err(Error::new(ErrorCode::InvalidParams, "id must not be empty"));
    }
    let record = load(&id)
        .await
        .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))?;
    Ok(record)
}
```

Оператор `?` работает естественным образом — любой тип, реализующий `Into<Error>`, может быть распространён.

Также можно явно сигнализировать об ошибке инструмента, когда хотите остаться на пути возврата `CallToolResponse`:

```rust
#[tool(descr = "Searches the catalog")]
async fn search(query: String) -> CallToolResponse {
    match catalog_search(&query).await {
        Ok(results) if results.is_empty() => {
            CallToolResponse::error(format!("No results found for '{query}'"))
        }
        Ok(results) => CallToolResponse::json(results),
        Err(e) => CallToolResponse::error(format!("Search failed: {e}")),
    }
}
```

## Обработчики ресурсов и запросов: ошибки становятся JSON-RPC ошибками

Для обработчиков `#[resource]` и `#[prompt]` возврат `Err(e)` распространяется как **JSON-RPC ответ с ошибкой** — сам запрос завершается с ошибкой, которая возвращается клиенту на уровне протокола, а не как читаемое содержимое.

```rust
#[resource(uri = "file://{path}", title = "Read file")]
async fn read_file(uri: Uri, path: String) -> Result<ResourceContents, Error> {
    let content = tokio::fs::read_to_string(&path).await?; // JSON-RPC ошибка при сбое
    Ok(ResourceContents::new(uri).with_text(content))
}
```

## JSON-RPC ошибки инфраструктурного уровня

Некоторые ошибки автоматически генерируются фреймворком до запуска каких-либо обработчиков:

| Ситуация | Код ошибки |
|----------|------------|
| Имя инструмента не зарегистрировано | `MethodNotFound` (-32601) |
| URI ресурса не совпал | `ResourceNotFound` (-32002) |
| Некорректное JSON-RPC сообщение | `ParseError` (-32700) |
| Неверная структура запроса | `InvalidRequest` (-32600) |

## Тип `Error`

[`Error`](https://docs.rs/neva/latest/neva/error/struct.Error.html) оборачивает код ошибки JSON-RPC и сообщение:

```rust
use neva::prelude::*;

let err = Error::new(ErrorCode::InvalidParams, "Missing required field: name");
```

### Коды ошибок

| Вариант `ErrorCode` | Код JSON-RPC | Описание |
|---------------------|--------------|----------|
| `ParseError` | -32700 | Получен некорректный JSON |
| `InvalidRequest` | -32600 | Не является допустимым объектом JSON-RPC |
| `MethodNotFound` | -32601 | Метод не существует |
| `InvalidParams` | -32602 | Параметры отсутствуют или имеют неверный тип |
| `InternalError` | -32603 | Непредвиденный сбой на стороне сервера |
| `ResourceNotFound` | -32002 | Запрошенный URI ресурса не существует |

## Автоматические преобразования

Neva реализует `From` для распространённых типов ошибок, чтобы их можно было распространять с помощью `?`:

```rust
use neva::prelude::*;

#[tool(descr = "Parses a JSON payload")]
async fn parse_data(raw: String) -> Result<String, Error> {
    // serde_json::Error → Error, результат становится ошибкой инструмента
    let value: serde_json::Value = serde_json::from_str(&raw)?;
    Ok(value.to_string())
}

#[resource(uri = "file://{path}", title = "Read file")]
async fn read_file(uri: Uri, path: String) -> Result<ResourceContents, Error> {
    // std::io::Error → Error, результат становится JSON-RPC ошибкой
    let content = tokio::fs::read_to_string(&path).await?;
    Ok(ResourceContents::new(uri).with_text(content))
}
```

## Ошибки в промежуточных обработчиках

Промежуточный обработчик получает `MwContext` и возвращает `Response`. Для прерывания с ошибкой сконструируйте ответ с ошибкой напрямую:

```rust
use neva::prelude::*;

async fn auth_check(ctx: MwContext, next: Next) -> Response {
    if !is_authorized(&ctx) {
        let err = Error::new(ErrorCode::InvalidParams, "Unauthorized");
        return Response::error(ctx.id(), err);
    }
    next(ctx).await
}
```
