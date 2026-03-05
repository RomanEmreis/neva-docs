---
sidebar_position: 9
---

# Промежуточные обработчики

Neva поддерживает конвейер промежуточных обработчиков, позволяющий перехватывать, изучать или изменять запросы до и после их обработки. Промежуточные обработчики — это асинхронные функции, принимающие [`MwContext`](https://docs.rs/neva/latest/neva/middleware/struct.MwContext.html) и обратный вызов [`Next`](https://docs.rs/neva/latest/neva/middleware/type.Next.html).

## Написание промежуточного обработчика

Промежуточный обработчик имеет следующую сигнатуру:

```rust
async fn my_middleware(ctx: MwContext, next: Next) -> Response {
    // Логика до выполнения обработчика
    let resp = next(ctx).await;
    // Логика после выполнения обработчика
    resp
}
```

Вызов `next(ctx).await` передаёт управление следующему промежуточному обработчику или конечному обработчику.

## Глобальный промежуточный обработчик

Используйте [`wrap()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.wrap) для регистрации промежуточного обработчика, который оборачивает **все входящие запросы**:

```rust
async fn logging_middleware(ctx: MwContext, next: Next) -> Response {
    let id = ctx.id();
    tracing::info!("Request start: {id:?}");
    let resp = next(ctx).await;
    tracing::info!("Request end: {id:?}");
    resp
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .wrap(logging_middleware)
        .run()
        .await;
}
```

## Промежуточный обработчик для инструментов

Используйте [`wrap_tools()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.wrap_tools) для применения промежуточного обработчика ко **всем запросам `tools/call`**:

```rust
async fn global_tool_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("Tool called");
    next(ctx).await
}

App::new()
    .with_options(|opt| opt.with_stdio())
    .wrap_tools(global_tool_middleware)
    .run()
    .await;
```

## Промежуточный обработчик для конкретного обработчика

Промежуточный обработчик можно привязать к конкретному инструменту, запросу или обработчику, используя параметр `middleware` в атрибутном макросе:

```rust
async fn specific_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("Hello from specific middleware");
    next(ctx).await
}

#[tool(middleware = [specific_middleware])]
async fn greeter(name: String) -> String {
    format!("Hello, {name}!")
}

#[prompt(middleware = [specific_middleware])]
async fn my_prompt(topic: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Topic: {topic}"))
}

#[handler(command = "ping", middleware = [specific_middleware])]
async fn ping_handler() {
    eprintln!("pong");
}
```

## Комбинирование промежуточных обработчиков

Глобальные, инструментальные и поэлементные промежуточные обработчики можно комбинировать в одном приложении. Для запроса `tools/call` они выполняются в следующем порядке:

1. Глобальный промежуточный обработчик (`wrap`)
2. Промежуточный обработчик инструментов (`wrap_tools`)
3. Поэлементный промежуточный обработчик (`middleware = [...]`)
4. Обработчик инструмента

```rust
async fn logging_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("1. Global");
    next(ctx).await
}

async fn tool_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("2. Tool-scoped");
    next(ctx).await
}

async fn specific_middleware(ctx: MwContext, next: Next) -> Response {
    tracing::info!("3. Per-handler");
    next(ctx).await
}

#[tool(middleware = [specific_middleware])]
async fn greeter(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .wrap(logging_middleware)
        .wrap_tools(tool_middleware)
        .run()
        .await;
}
```

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/middlewares) доступен здесь.
