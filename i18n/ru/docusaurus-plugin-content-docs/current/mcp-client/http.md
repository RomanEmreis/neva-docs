---
sidebar_position: 8
---

# HTTP-транспорт

Помимо `stdio`, клиенты Neva поддерживают подключение к MCP-серверам по **потоковому HTTP** — двунаправленному транспортному уровню, подходящему для удалённых серверов.

## Подключение через HTTP

Используйте [`with_http()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_http) для настройки клиента на HTTP-транспорт:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")));

    client.connect().await?;

    // Вызов инструментов, чтение ресурсов и т.д.

    client.disconnect().await
}
```

## Конфигурация HTTP по умолчанию

Для быстрого старта используйте [`with_default_http()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_default_http), который подключается к `127.0.0.1:3000` с конечной точкой `/mcp` по умолчанию:

```rust
let mut client = Client::new()
    .with_options(|opt| opt.with_default_http());
```

## TLS / HTTPS

Для подключения к HTTPS-серверу настройте TLS на клиенте:

```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("localhost:7878")
            .with_tls(|tls| tls
                .with_certs_verification(false)))); // Отключить для самоподписанных сертификатов
```

:::warning
Отключение проверки сертификатов (`with_certs_verification(false)`) предназначено только для локальной разработки.
В продакшене всегда используйте корректно подписанный сертификат и не отключайте проверку.
:::

## Аутентификация по токену Bearer

Если MCP-сервер требует JWT-аутентификацию, прикрепите токен Bearer с помощью [`with_auth()`](https://docs.rs/neva/latest/neva/client/options/http/struct.HttpClient.html#method.with_auth):

```rust
const ACCESS_TOKEN: &str = "eyJhbGci..."; // Ваш JWT Bearer токен

let mut client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("localhost:7878")
            .with_auth(ACCESS_TOKEN)));

client.connect().await?;
```

Токен отправляется в заголовке `Authorization: Bearer <token>` при каждом запросе.

## Полный пример: HTTPS + Auth

```rust
use neva::prelude::*;

const ACCESS_TOKEN: &str = "eyJhbGci...";

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("localhost:7878")
                .with_tls(|tls| tls
                    .with_certs_verification(false))
                .with_auth(ACCESS_TOKEN)));

    client.connect().await?;

    let result = client.call_tool("my_tool", ("input", "value")).await?;
    println!("{:?}", result.content);

    client.disconnect().await
}
```

## Обучение на примерах

* [HTTP-клиент (корневые каталоги)](https://github.com/RomanEmreis/neva/tree/main/examples/roots/client)
* [Клиент сэмплирования с HTTPS + JWT](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/client)
