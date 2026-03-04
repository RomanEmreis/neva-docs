---
sidebar_position: 13
---

# Argument Completion

MCP allows servers to suggest completions for prompt and tool arguments — similar to tab-complete in a terminal. When a client types a partial value, it can request a list of matching options, and the server responds with suggestions.

## Registering a Completion Handler

Use the [`#[completion]`](https://docs.rs/neva/latest/neva/attr.completion.html) macro to register a completion handler:

```rust
use neva::prelude::*;

#[completion]
async fn complete_language(params: CompleteRequestParams) -> Completion {
    let filter = &params.arg.value;
    let languages = ["Rust", "Go", "Python", "TypeScript", "Kotlin"];

    let matched: Vec<String> = languages
        .iter()
        .filter(|l| l.to_lowercase().starts_with(&filter.to_lowercase()))
        .map(|l| l.to_string())
        .collect();

    let total = matched.len();
    Completion::new(matched, total)
}
```

`CompleteRequestParams` provides two fields:
- `params.arg.name` — the name of the argument being completed
- `params.arg.value` — the partial value typed so far

## The `Completion` Type

[`Completion::new(values, total)`](https://docs.rs/neva/latest/neva/types/struct.Completion.html) takes:
- `values` — the suggestions to return (up to a page limit)
- `total` — the total number of matching items, which allows clients to show a count even when results are paginated

```rust
Completion::new(vec!["Rust".into(), "Ruby".into()], 2)
```

For simple cases, `Completion` also converts from a plain `Vec<String>`:

```rust
async fn complete_language(params: CompleteRequestParams) -> Completion {
    vec!["Rust".to_string(), "Ruby".to_string()].into()
}
```

## Pagination

When the total number of matches exceeds what you want to return at once, use `has_more` to signal that more results exist. Build the response using the builder API:

```rust
use neva::prelude::*;

#[completion]
async fn complete_resource(params: CompleteRequestParams) -> Completion {
    let filter = &params.arg.value;
    let all_items: Vec<String> = fetch_all_items().await; // your data source

    let matched: Vec<String> = all_items
        .iter()
        .filter(|s| s.contains(filter.as_str()))
        .cloned()
        .collect();

    let total = matched.len();
    let page: Vec<String> = matched.into_iter().take(10).collect();

    Completion::new(page, total)
}
```

## Filtering by Argument Name

If your server has multiple prompts or tools with different argument names, you can dispatch on `params.arg.name`:

```rust
#[completion]
async fn complete_args(params: CompleteRequestParams) -> Completion {
    match params.arg.name.as_str() {
        "language" => complete_languages(&params.arg.value),
        "framework" => complete_frameworks(&params.arg.value),
        _ => Completion::default(),
    }
}
```

## Using DI in Completion Handlers

Completion handlers support `Dc<T>` extraction just like tool and resource handlers:

```rust
use neva::prelude::*;

#[derive(Default, Clone)]
struct CatalogService {
    items: Vec<String>,
}

#[completion]
async fn complete_items(
    params: CompleteRequestParams,
    catalog: Dc<CatalogService>
) -> Completion {
    let filter = &params.arg.value;
    let matched: Vec<String> = catalog.items
        .iter()
        .filter(|s| s.contains(filter.as_str()))
        .cloned()
        .collect();

    let total = matched.len();
    Completion::new(matched, total)
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .add_singleton(CatalogService { items: vec!["alpha".into(), "beta".into()] })
        .run()
        .await;
}
```

## Learn By Example

Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/pagination).
