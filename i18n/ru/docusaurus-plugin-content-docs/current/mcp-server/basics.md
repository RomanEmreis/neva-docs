---
sidebar_position: 1
---

# Основы

Давайте создадим простой MCP-сервер с Neva и добавим обработчики инструментов, промптов и ресурсов.

## Создание приложения

Создайте новое бинарное приложение:
```bash
cargo new neva-mcp-server
cd neva-mcp-server
```

Добавьте следующие зависимости в ваш `Cargo.toml`:

```toml
[dependencies]
neva = { version = "0.2.5", features = "server-full" }
tokio = { version = "1", features = ["full"] }
```

## Настройка инструмента {#setup-a-tool}
Начнём с добавления простого инструмента — функции, которая приветствует пользователя по имени.

Создайте основной файл приложения `main.rs`:

```rust
use neva::prelude::*;

#[tool(descr = "A say hello tool")]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP server")
            .with_version("1.0.0"))
        .run()
        .await;
}
```

В приведённом коде настроен MCP-сервер, работающий на транспорте `stdio`, и объявлен асинхронный обработчик инструмента с помощью атрибутного макроса [tool](https://docs.rs/neva/latest/neva/attr.tool.html). Макрос извлекает параметр `name` как `String` и ожидает возврата строки `String`. Он также регистрирует инструмент `hello` с указанным описанием.

Помимо `descr`, инструмент можно настроить с помощью следующих параметров:
- `title` — заголовок инструмента.
- `input_schema` — схема входных данных инструмента.
- `output_schema` — схема выходных данных инструмента.
- `annotations` — произвольные [метаданные](https://docs.rs/neva/latest/neva/types/tool/struct.ToolAnnotations.html).
- `roles` и `permissions` — определяют, кто может запускать инструмент при использовании потокового HTTP-транспорта с OAuth.

## Тестирование MCP-сервера

Для тестирования можно воспользоваться [MCP Inspector](https://github.com/modelcontextprotocol/inspector), запустив следующую команду:
```bash
npx @modelcontextprotocol/inspector cargo run
```
Это запустит пользовательский интерфейс MCP Inspector, позволяющий интерактивно исследовать инструменты, промпты и ресурсы сервера.

## Добавление обработчика промпта {#adding-a-prompt-handler}

Далее аналогичным образом добавим обработчик промпта с помощью атрибутного макроса [prompt](https://docs.rs/neva/latest/neva/attr.prompt.html):
```rust
#[prompt(descr = "Generates a user message requesting a hello world code generation.")]
async fn hello_world_code(lang: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Write a hello-world function on {lang}"))
}
```

## Добавление обработчика шаблона ресурса {#adding-a-resource-tempate-handler}

По той же схеме с помощью специального атрибутного макроса [resource](https://docs.rs/neva/latest/neva/attr.resource.html) можно определить обработчик ресурса с минимальным количеством шаблонного кода:
```rust
#[resource(
    uri = "res://{name}",
    title = "Read resource",
    descr = "Some details about resource",
    mime = "application/octet-stream",
    annotations = r#"{
        "audience": ["user"],
        "priority": 1.0
    }"#
)]
async fn get_res(uri: Uri, name: String) -> ResourceContents {
    let data = "some file contents"; // Читаем ресурс из источника

    ResourceContents::new(uri)
        .with_title(name)
        .with_blob(data)
}
```

## Произвольные обработчики

Используйте [`#[handler]`](https://docs.rs/neva/latest/neva/attr.handler.html) для обработки любого сырого JSON-RPC метода — в том числе нестандартных методов, выходящих за рамки спецификации MCP. Это полезно для реализации собственных расширений протокола или сообщений координации между серверами.

Параметр `command` задаёт имя обрабатываемого JSON-RPC метода:

```rust
use neva::prelude::*;

#[handler(command = "ping")]
async fn ping_handler() {
    eprintln!("pong");
}
```

Функции-обработчики могут принимать любые параметры, реализующие [`FromHandlerParams`](https://docs.rs/neva/latest/neva/app/handler/trait.FromHandlerParams.html):

```rust
use neva::prelude::*;

/// Получает полный запрос и текущий MCP-контекст
#[handler(command = "custom/status")]
async fn status_handler(ctx: Context, req: Request) -> String {
    let session = ctx.session_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "none".into());
    format!("session={session} method={}", req.method)
}
```

Доступные встроенные типы параметров:

| Тип | Предоставляет |
|-----|---------------|
| `Context` | Текущий контекст сессии (отправка запросов на сэмплирование, подписка на ресурсы и т.д.) |
| `Request` | Сырой JSON-RPC запрос (метод, параметры, заголовки, claims) |
| `RequestId` | Идентификатор запроса |
| `RuntimeMcpOptions` | Конфигурация сервера во время выполнения |

Обработчики также поддерживают параметр `middleware`, как и `#[tool]` и `#[prompt]`:

```rust
async fn audit(ctx: MwContext, next: Next) -> Response {
    tracing::info!("custom command called");
    next(ctx).await
}

#[handler(command = "custom/action", middleware = [audit])]
async fn action_handler(req: Request) {
    tracing::info!("handling {}", req.method);
}
```

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/server) доступен здесь.
