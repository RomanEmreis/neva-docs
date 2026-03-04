---
sidebar_position: 15
---

# Error Handling

The way errors behave in Neva depends on which kind of handler returns them.

## Tool Handlers: All Errors Become Tool Errors

For `#[tool]` handlers, **any error returned from the handler always becomes a tool error** — a successful JSON-RPC response with `is_error: true` in the content. The AI model receives it as readable content and can reason about it (retry, rephrase, fallback).

This applies whether you return `Err(...)` from a `Result`, propagate with `?`, or call `CallToolResponse::error()` explicitly:

```rust
use neva::prelude::*;

#[tool(descr = "Reads a record by ID")]
async fn get_record(id: String) -> Result<String, Error> {
    if id.is_empty() {
        // This becomes a tool error visible to the model
        return Err(Error::new(ErrorCode::InvalidParams, "id must not be empty"));
    }
    let record = load(&id)
        .await
        .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))?;
    Ok(record)
}
```

The `?` operator works naturally — any type that implements `Into<Error>` can be propagated.

You can also signal a tool error explicitly when you want to stay on the `CallToolResponse` return path:

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

## Resource and Prompt Handlers: Errors Become JSON-RPC Errors

For `#[resource]` and `#[prompt]` handlers, returning `Err(e)` propagates as a **JSON-RPC error response** — the request itself fails and the error is returned to the client at the protocol level, not as readable content.

```rust
#[resource(uri = "file://{path}", title = "Read file")]
async fn read_file(uri: Uri, path: String) -> Result<ResourceContents, Error> {
    let content = tokio::fs::read_to_string(&path).await?; // JSON-RPC error on failure
    Ok(ResourceContents::new(uri).with_text(content))
}
```

## Infrastructure-Level JSON-RPC Errors

Some errors are produced automatically by the framework, before any handler runs:

| Situation | Error code |
|-----------|------------|
| Tool name not registered | `MethodNotFound` (-32601) |
| Resource URI not matched | `ResourceNotFound` (-32002) |
| Malformed JSON-RPC message | `ParseError` (-32700) |
| Invalid request structure | `InvalidRequest` (-32600) |

## The `Error` Type

[`Error`](https://docs.rs/neva/latest/neva/error/struct.Error.html) wraps a JSON-RPC error code and a message:

```rust
use neva::prelude::*;

let err = Error::new(ErrorCode::InvalidParams, "Missing required field: name");
```

### Error Codes

| `ErrorCode` variant | JSON-RPC code | Description |
|---------------------|---------------|-------------|
| `ParseError` | -32700 | Malformed JSON received |
| `InvalidRequest` | -32600 | Not a valid JSON-RPC object |
| `MethodNotFound` | -32601 | Method does not exist |
| `InvalidParams` | -32602 | Parameters are missing or wrong type |
| `InternalError` | -32603 | Unexpected server-side failure |
| `ResourceNotFound` | -32002 | Requested resource URI does not exist |

## Automatic Conversions

Neva implements `From` for common error types so they can be propagated with `?`:

```rust
use neva::prelude::*;

#[tool(descr = "Parses a JSON payload")]
async fn parse_data(raw: String) -> Result<String, Error> {
    // serde_json::Error → Error, result becomes a tool error
    let value: serde_json::Value = serde_json::from_str(&raw)?;
    Ok(value.to_string())
}

#[resource(uri = "file://{path}", title = "Read file")]
async fn read_file(uri: Uri, path: String) -> Result<ResourceContents, Error> {
    // std::io::Error → Error, result becomes a JSON-RPC error
    let content = tokio::fs::read_to_string(&path).await?;
    Ok(ResourceContents::new(uri).with_text(content))
}
```

## Errors in Middleware

Middleware receives a `MwContext` and returns a `Response`. To short-circuit with an error, construct an error response directly:

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
