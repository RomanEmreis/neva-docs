---
sidebar_position: 8
---

# HTTP-транспорт

Помимо `stdio`, клиенты Neva поддерживают подключение к MCP-серверам по **потоковому HTTP**.

## Что делает `connect()`

`connect()` открывает соединение единственным запросом **`server/discover`** —
рукопожатия `initialize` / `initialized` больше нет. `Client::discover()` —
явный вызов; `Client::init()` остаётся псевдонимом для обратной
совместимости.

Каждый последующий `POST` несёт:

* заголовок `MCP-Protocol-Version`, зафиксированный на `2026-07-28`;
* `_meta` с `io.modelcontextprotocol/protocolVersion` и
  `io.modelcontextprotocol/clientCapabilities`;
* заголовки маршрутизации `Mcp-Method`, `Mcp-Name` и все `Mcp-Param-{name}`,
  которых требует схема вызываемого инструмента.

Всё это neva формирует за вас. Сервер отклоняет запрос, у которого заголовки
расходятся с телом, — поэтому, если вы находитесь за прокси, переписывающим
заголовки, при внезапных `400` начинайте искать именно там.

`Client::server_info` читается из
`_meta["io.modelcontextprotocol/serverInfo"]`, который несёт каждый
результат, — в результате discovery этого поля больше нет.

Отдельный SSE-поток `GET` открывать не нужно: серверные уведомления приходят
на запросе [`subscriptions/listen`](./subscriptions), который клиент открывает
специально для них, — ответ на этот `POST` и есть поток.

### Работа с легаси-сервером

Клиент работает в **двойном режиме**. Если `server/discover` отклонён на
уровне протокола — `MethodNotFound`, `InvalidRequest` либо ответ не в формате
JSON-RPC или с неизвестным кодом, — он откатывается к легаси-рукопожатию
`initialize` и до конца соединения говорит с этим узлом на старом протоколе:
`Mcp-Session-Id`, отдельный SSE-поток `GET`, серверный push для
сэмплирования, корневых каталогов и логов, без MRTR и без заголовков
маршрутизации.

Сетевые ошибки отката **не** вызывают. Переключение происходит один раз на
соединение, необратимо и до любого другого трафика — то есть сборка с
`legacy-spec` не нужна только ради подключения к старому серверу.

`with_mcp_version(...)` на клиенте по-прежнему существует, но выбирает лишь
**версию, о которой договаривается откат**; он никогда не заставит
`server/discover` отклонить корректный сервер MCP 2026-07-28.

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

* [MRTR-клиент](https://github.com/RomanEmreis/neva/tree/main/examples/mrtr/client) — цикл раундов от начала до конца
* [HTTP-клиент (корневые каталоги)](https://github.com/RomanEmreis/neva/tree/main/examples/roots/client)
* [Клиент сэмплирования](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/client)
