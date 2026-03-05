---
sidebar_position: 7
---

# HTTP-транспорт

Помимо `stdio`, Neva поддерживает **потоковый HTTP**-транспорт — двунаправленный транспортный уровень поверх HTTP, обеспечивающий удалённые подключения к MCP-серверу.

## Базовая настройка

Для запуска сервера на потоковом HTTP используйте [`with_http()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_http) в параметрах:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")))
        .run()
        .await;
}
```

Это запустит HTTP-сервер на `127.0.0.1:3000` с конечной точкой `/mcp` по умолчанию.

## Кастомная конечная точка

Путь конечной точки MCP можно изменить с помощью [`with_endpoint()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_endpoint):

```rust
App::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("127.0.0.1:3000")
            .with_endpoint("/my-mcp")))
    .run()
    .await;
```

## Конфигурация HTTP по умолчанию

Для быстрого старта используйте [`with_default_http()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_default_http), который привязывается к `127.0.0.1:3000` с конечной точкой по умолчанию:

```rust
App::new()
    .with_options(|opt| opt.with_default_http())
    .run()
    .await;
```

## TLS

Для включения HTTPS настройте TLS с помощью метода [`with_tls()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_tls):

```rust
let http = HttpServer::new("localhost:7878")
    .with_tls(|tls| tls
        .with_dev_cert(DevCertMode::Auto));

App::new()
    .with_options(|opt| opt.set_http(http))
    .run()
    .await;
```

[`DevCertMode::Auto`](https://docs.rs/neva/latest/neva/transport/http/enum.DevCertMode.html) автоматически генерирует самоподписанный сертификат для локальной разработки.
В продакшене используйте собственный сертификат и файл ключа.

## JWT-аутентификация

Neva поддерживает **аутентификацию по токену Bearer** через JWT для HTTP-транспорта.

Для включения используйте [`with_auth()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_auth) внутри `with_http()`:

```rust
let secret = std::env::var("JWT_SECRET")
    .expect("JWT_SECRET must be set");

App::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .with_auth(|auth| auth
                .validate_exp(false)
                .with_aud(["my-service"])
                .with_iss(["my-issuer"])
                .set_decoding_key(secret.as_bytes()))))
    .run()
    .await;
```

### Параметры конфигурации аутентификации

| Метод | Описание |
|-------|----------|
| `set_decoding_key()` | Секретный или публичный ключ для проверки подписи JWT |
| `with_aud()` | Принимаемые значения audience токена |
| `with_iss()` | Принимаемые значения issuer токена |
| `validate_exp()` | Проверять ли срок действия токена (по умолчанию `true`) |

## Управление доступом на основе ролей

После настройки аутентификации можно ограничить доступ к отдельным инструментам, запросам и ресурсам с помощью атрибутов `roles` и `permissions`:

```rust
/// Доступно всем
#[tool]
async fn public_tool(name: String) {
    tracing::info!("Running public tool for {name}");
}

/// Только для пользователей с ролью "admin"
#[tool(roles = ["admin"])]
async fn admin_tool(name: String) {
    tracing::info!("Running admin tool for {name}");
}

/// Только для пользователей с ролью "admin" и правом "read"
#[prompt(roles = ["admin"], permissions = ["read"])]
async fn restricted_prompt(topic: String) -> PromptMessage {
    PromptMessage::user()
        .with(format!("Restricted topic: {topic}"))
}

/// Только для пользователей с правом "read"
#[resource(uri = "res://restricted/{name}", permissions = ["read"])]
async fn restricted_resource(uri: Uri, name: String) -> (String, String) {
    (uri.to_string(), name)
}
```

Роли и права извлекаются из claims JWT-токена. При несоответствии требованиям доступ отклоняется с ошибкой `403 Forbidden`.

## Блокирующий запуск

Для сценариев, где необходима синхронная точка входа (например, встраивание в неасинхронный контекст), вместо `.run().await` можно использовать [`run_blocking()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.run_blocking):

```rust
fn main() {
    App::new()
        .with_options(|opt| opt.with_default_http())
        .run_blocking();
}
```

## Тестирование с MCP Inspector

Для тестирования потокового HTTP-сервера через [MCP Inspector](https://github.com/modelcontextprotocol/inspector) сначала запустите сервер:

```bash
cargo run
```

Затем откройте Inspector и подключитесь к `http://127.0.0.1:3000/mcp`.

## Обучение на примерах

* [HTTP-сервер](https://github.com/RomanEmreis/neva/tree/main/examples/http)
* [Защищённый сервер с JWT-аутентификацией](https://github.com/RomanEmreis/neva/tree/main/examples/protected-server)
* [Сервер сэмплирования с TLS](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/server)
