---
sidebar_position: 13
---

# Автодополнение аргументов

MCP позволяет серверам предлагать варианты автодополнения для аргументов запросов и инструментов — аналогично автодополнению по Tab в терминале. Когда клиент вводит частичное значение, он может запросить список подходящих вариантов, и сервер отвечает предложениями.

## Регистрация обработчика автодополнения

Используйте макрос [`#[completion]`](https://docs.rs/neva/latest/neva/attr.completion.html) для регистрации обработчика автодополнения:

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

`CompleteRequestParams` содержит два поля:
- `params.arg.name` — имя дополняемого аргумента
- `params.arg.value` — частичное значение, введённое на данный момент

## Тип `Completion`

[`Completion::new(values, total)`](https://docs.rs/neva/latest/neva/types/struct.Completion.html) принимает:
- `values` — предложения для возврата (до лимита страницы)
- `total` — общее количество совпадающих элементов, что позволяет клиентам отображать счётчик даже при постраничной выдаче

```rust
Completion::new(vec!["Rust".into(), "Ruby".into()], 2)
```

Для простых случаев `Completion` также преобразуется из обычного `Vec<String>`:

```rust
async fn complete_language(params: CompleteRequestParams) -> Completion {
    vec!["Rust".to_string(), "Ruby".to_string()].into()
}
```

## Пагинация

Когда общее количество совпадений превышает желаемое количество возвращаемых элементов, используйте `has_more` для сигнализации о наличии дополнительных результатов. Ответ формируется с помощью builder API:

```rust
use neva::prelude::*;

#[completion]
async fn complete_resource(params: CompleteRequestParams) -> Completion {
    let filter = &params.arg.value;
    let all_items: Vec<String> = fetch_all_items().await; // ваш источник данных

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

## Фильтрация по имени аргумента

Если сервер содержит несколько запросов или инструментов с разными именами аргументов, можно диспетчеризировать по `params.arg.name`:

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

## Использование внедрения зависимостей в обработчиках автодополнения

Обработчики автодополнения поддерживают извлечение `Dc<T>` так же, как обработчики инструментов и ресурсов:

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

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/pagination) доступен здесь.
