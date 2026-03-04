---
sidebar_position: 15
---

# Error Handling

Neva distinguishes between two kinds of errors: **request errors** and **tool errors**. Understanding the difference is key to building well-behaved MCP servers.

## Request Errors vs Tool Errors

| Kind | Type | Effect |
|------|------|--------|
| **Request error** | `Err(Error)` from `Result<T, Error>` | Aborts the request, returns a JSON-RPC error response |
| **Tool error** | `CallToolResponse::error(msg)` | Returns a successful response with `is_error: true` — the model sees it as content |

Use **request errors** for protocol violations and internal failures that the caller cannot recover from. Use **tool errors** for domain-level failures that the AI model should be able to reason about (e.g. "record not found", "invalid input").

## The `Error` Type

[`Error`](https://docs.rs/neva/latest/neva/error/struct.Error.html) wraps a JSON-RPC error code and a message:

```rust
use neva::error::{Error, ErrorCode};

let err = Error::new(ErrorCode::InvalidParams, "Missing required field: name");
```

### Error Codes

| `ErrorCode` variant | JSON-RPC code | When to use |
|---------------------|---------------|-------------|
| `ParseError` | -32700 | Malformed JSON received |
| `InvalidRequest` | -32600 | Request is not a valid JSON-RPC object |
| `MethodNotFound` | -32601 | Called method does not exist |
| `InvalidParams` | -32602 | Parameters are missing or wrong type |
| `InternalError` | -32603 | Unexpected server-side failure |
| `ResourceNotFound` | -32002 | Requested resource URI does not exist |

## Returning Errors from Handlers

Any handler can return `Result<T, Error>` to signal a request-level error:

```rust
use neva::prelude::*;
use neva::error::{Error, ErrorCode};

#[tool(descr = "Reads a record by ID")]
async fn get_record(id: String) -> Result<String, Error> {
    if id.is_empty() {
        return Err(Error::new(ErrorCode::InvalidParams, "id must not be empty"));
    }
    let record = load(&id)
        .await
        .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))?;
    Ok(record)
}
```

The `?` operator works naturally — any type that implements `Into<Error>` can be propagated.

## Tool-Level Errors

For errors that the AI model should see and reason about, return `CallToolResponse::error()` instead of `Err(...)`:

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

This produces a response with `is_error: true` in the MCP content — the model receives it as a message it can act on (retry, rephrase, fallback).

## Automatic Conversions

Neva implements `From` for common error types so they can be propagated with `?`:

```rust
use neva::prelude::*;

#[tool(descr = "Parses a JSON payload")]
async fn parse_data(raw: String) -> Result<String, Error> {
    let value: serde_json::Value = serde_json::from_str(&raw)?; // From<serde_json::Error>
    Ok(value.to_string())
}

#[resource(uri = "file://{path}", title = "Read file")]
async fn read_file(uri: Uri, path: String) -> Result<ResourceContents, Error> {
    let content = tokio::fs::read_to_string(&path).await?; // From<std::io::Error>
    Ok(ResourceContents::new(uri).with_text(content))
}
```

## Errors in Middleware

Middleware receives a `MwContext` and returns a `Response`. To short-circuit with an error, construct an error response directly:

```rust
use neva::prelude::*;
use neva::app::middleware::{MwContext, Next};
use neva::error::{Error, ErrorCode};

async fn auth_check(ctx: MwContext, next: Next) -> Response {
    if !is_authorized(&ctx) {
        let err = Error::new(ErrorCode::InvalidParams, "Unauthorized");
        return Response::error(ctx.id(), err);
    }
    next(ctx).await
}
```

## Error Propagation Pattern

For handlers that call multiple fallible operations, a typical pattern is:

```rust
use neva::prelude::*;
use neva::error::{Error, ErrorCode};

fn not_found(msg: impl ToString) -> Error {
    Error::new(ErrorCode::ResourceNotFound, msg)
}

fn internal(msg: impl ToString) -> Error {
    Error::new(ErrorCode::InternalError, msg)
}

#[tool(descr = "Processes an order")]
async fn process_order(order_id: String) -> Result<String, Error> {
    let order = fetch_order(&order_id)
        .await
        .map_err(|_| not_found(format!("Order {order_id} not found")))?;

    let result = submit_order(order)
        .await
        .map_err(|e| internal(e.to_string()))?;

    Ok(result)
}
```
