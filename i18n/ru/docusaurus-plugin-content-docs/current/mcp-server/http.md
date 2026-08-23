---
sidebar_position: 7
---

# HTTP-транспорт

Помимо `stdio`, Neva поддерживает **потоковый HTTP**-транспорт для удалённых подключений к MCP-серверу.

Эта страница описывает **HTTP-сервер по умолчанию**, построенный на фреймворке [Volga](https://docs.rs/volga). Он включается флагами `server-full` или `http-server-volga` и не требует дополнительной настройки с вашей стороны.

Если вам нужно разместить MCP-эндпоинт на другом HTTP-стеке — `axum`, `hyper`, `actix-web` или произвольном адаптере, — см. раздел [Свой HTTP-стек](./custom-http). Оба варианта используют одну и ту же конфигурацию `with_http(...)`, JWT-аутентификацию и проверки ролей/прав, описанные ниже.

## Транспорт не хранит состояние

В [MCP 2026-07-28](../spec-2026-07-28.md#http-транспорт-без-состояния)
транспорт работает только по схеме «запрос — ответ»:

* Нет `Mcp-Session-Id` в протоколе и нет `DELETE` сессии.
* Нет отдельного SSE-потока `GET` — серверные уведомления едут на запросе
  [`subscriptions/listen`](./subscriptions), который клиент открывает сам.
* Каждый запрос несёт заголовок `MCP-Protocol-Version`, а также обязательные
  ключи `_meta` с версией протокола и возможностями клиента.
* Заголовки маршрутизации (`Mcp-Method`, `Mcp-Name`, `Mcp-Param-{name}`)
  обязаны совпадать с телом запроса, иначе запрос отклоняется с
  `HeaderMismatch` (`-32020`) и HTTP `400`.

`POST` получает ответ `text/event-stream` в трёх случаях:

| Какой `POST` | Что несёт поток |
|---|---|
| В его `_meta` есть `io.modelcontextprotocol/logLevel` | уведомления [журнала](./logging) этого запроса, а следом — его ответ |
| В его `_meta` есть `progressToken` | уведомления [прогресса](./progress) этого запроса, а следом — его ответ |
| Это запрос [`subscriptions/listen`](./subscriptions) | подтверждение, затем каждое уведомление, допускаемое фильтром, пока поток не завершится |

Все остальные `POST` получают один JSON-объект.

:::note Под флагом `legacy-spec`
Возвращается транспорт с сессиями: `Mcp-Session-Id`, `DELETE` сессии и
отдельный SSE-поток `GET` с воспроизведением по `Last-Event-ID`. См.
[Легаси-спецификация](../legacy-spec.md).
:::

## Запуск нескольких экземпляров

Поскольку транспорт не хранит состояние, multi round-trip запрос может
попасть на любой экземпляр — поэтому, как только экземпляров больше одного,
общие ресурсы становятся обязательными:

```rust
App::new()
    // Без этого повторы, попавшие на другой экземпляр, не расшифруют
    // `requestState`. neva предупреждает об этом при старте.
    .with_request_state_secret(std::env::var("MCP_STATE_SECRET").unwrap().as_bytes())
    // Без этого повтор из-за потерянного ответа заново выполнит обработчик
    // и продублирует `on_commit`. Хранилище по умолчанию — на процесс.
    .with_request_state_store(my_redis_store)
    // Без этого подписчик на одном экземпляре никогда не узнает об
    // изменении, случившемся на другом. Появилось в 0.5.3.
    .with_notification_bus(my_redis_bus)
    .with_options(|opt| opt.with_default_http())
    .run()
    .await;
```

| Настройка | От чего защищает |
|---|---|
| [`with_request_state_secret`](../spec-2026-07-28.md#обязательный-минимум-для-развёртывания-на-нескольких-экземплярах) | Повтор MRTR на другом экземпляре не может расшифровать свой `requestState` |
| `with_request_state_store` | Повтор из-за потерянного ответа заново выполняет обработчик и дублирует `on_commit` |
| [`with_notification_bus`](./subscriptions#запуск-нескольких-экземпляров) | Поток [подписки](./subscriptions), живущий на одном экземпляре, пропускает то, что произвёл другой |

Если один и тот же `with_request_state_secret` делят несколько сервисов,
добавьте
[`with_request_state_audience`](../spec-2026-07-28.md#привязка-состояния-к-сервису),
чтобы состояние, выпущенное одним, не принималось остальными.

Что именно защищает секрет и как его ротировать — см.
[Обязательный минимум для развёртывания на нескольких экземплярах](../spec-2026-07-28.md#обязательный-минимум-для-развёртывания-на-нескольких-экземплярах).

:::warning Ломающее изменение в v0.3.3
Флаг компонента `http-server` теперь **не привязан к конкретному фреймворку** и больше не тянет за собой Volga. Чтобы оставить HTTP-сервер по умолчанию на Volga, используйте `http-server-volga` (или пресет `server-full`, который по-прежнему сам его подключает). Если у вас было `features = ["http-server"]` и нужно прежнее поведение из версий до v0.3.3, переименуйте флаг в `http-server-volga`.
:::

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

## Защита от DNS-rebinding {#dns-rebinding-protection}

Сервер на loopback доступен любой странице, которую откроет браузер:
достаточно направить `evil.example.com` на `127.0.0.1` — и браузер
подключится. Запрос при этом действительно локальный; выдаёт атаку *имя*, по
которому к серверу обратились. Поэтому neva проверяет `Origin` и `Host` и
отвечает `403 Forbidden` ещё до чтения тела запроса.

**По умолчанию ничего вызывать не нужно.** При привязке к loopback сервер
принимает только loopback-имена — `localhost`, что угодно из `127.0.0.0/8`,
`[::1]` — на любом порту. При привязке к чему-то другому он принимает всё,
потому что имена, по которым развёртывание правомерно доступно, отсюда
неизвестны: за прокси `Host` — это то, что перешлёт прокси.

:::warning `bind("::1:3000")` — исправлено в 0.5.4
`std` считает последнее двоеточие *незаключённой в скобки* IPv6-строки
разделителем порта, так что этот адрес действительно слушает `[::1]:3000` — но
политика читала строку целиком, где она разбирается как *другой*,
не-loopback-адрес `::1:3000`. Сервер на loopback из-за этого по умолчанию
получал `allow_any_origin`, то есть проверки, которые спецификация делает MUST
для локальных серверов, были выключены. Теперь строки привязки читаются так же,
как их читает `std`. `[::1]:3000`, `127.0.0.1:3000` и `localhost:3000` это
никогда не затрагивало.

В том же релизе: `Origin` с userinfo больше не сопоставляется по имени перед
`@` — у `https://app.example.com:8443@evil.com` хост `evil.com`. Это
превентивное укрепление, а не достижимый обход: `Origin` выставляет браузер.
:::

Развёртывание, которое свои имена *знает*, объявляет их через
[`with_allowed_origins()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.with_allowed_origins):

```rust
let http = HttpServer::new("0.0.0.0:3000")
    .with_allowed_origins(["https://mcp.example.com", "https://app.example.com"]);

App::new()
    .with_options(|opt| opt.set_http(http))
    .run()
    .await;
```

### Что означает запись в списке {#allowed-origin-entry}

| Запись | Чему соответствует `Origin` |
|---|---|
| `https://app.example.com` | этой схеме, хосту **и** порту (отсутствующий порт означает порт по умолчанию для схемы) |
| `app.example.com` | этому хосту на любой схеме и любом порту |
| `app.example.com:8443` | этому хосту на любой схеме, но только на этом порту |

Предпочитайте полный origin. Голый хост доверяет всему, что отдаётся под
этим именем, включая то, что висит на другом порту, — доверие к приложению
не должно означать доверия ко всему остальному на его хосте.

`Host` в любом случае сверяется по имени хоста со всеми записями: он
говорит, куда запрос пришёл, а не кто его отправил, схемы не несёт, а за
прокси его порт — дело прокси. Сравнение везде регистронезависимое, loopback
принимается всегда, а запрос без обоих заголовков не трогают — он не от
браузера, а без имени никакого rebinding не бывает.

### Как отключить проверку {#turning-the-gate-off}

```rust
// Туннель терминирует обращённое к браузеру имя и пересылает запрос сюда.
let http = HttpServer::new("127.0.0.1:3000").allow_any_origin();
```

[`allow_any_origin()`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.allow_any_origin)
имеет смысл только при привязке к loopback, где проверка включена по
умолчанию. Прибегайте к нему, когда имя уже проверяет что-то перед сервером,
а не чтобы заглушить `403`, причину которого не прочитали: этот `403` —
и есть работающая защита.

:::note Работает с любым HTTP-движком
Проверка живёт в ядре транспорта, а не в адаптере Volga, поэтому
[свой HTTP-стек](./custom-http) получает её же — и политика переживает
`with_engine(...)`, поскольку это свойство развёртывания, а не фреймворка,
который его обслуживает.
:::

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

:::tip Токены от сервера авторизации
`set_decoding_key` — для развёртывания, которое само выпускает JWT. Чтобы
проверять токены, выпущенные провайдером OAuth 2.1 / OIDC — по его JWKS, с
документом метаданных RFC 9728 и вызовом `401`, по которому клиенты его
находят, — см. [OAuth 2.1](./oauth). Проверки ролей и прав выше работают
одинаково в обоих случаях.
:::

## Блокирующий запуск

Для сценариев, где необходима синхронная точка входа (например, встраивание в неасинхронный контекст), вместо `.run().await` можно использовать [`run_blocking()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.run_blocking):

```rust
fn main() {
    App::new()
        .with_options(|opt| opt.with_default_http())
        .run_blocking();
}
```

## Остановка сервера

Оба варианта запуска останавливаются по `SIGINT` / `SIGTERM` без всякой
настройки. Чтобы остановить сервер из собственного кода — из теста или из
сервиса, который сам управляет своим жизненным циклом, — см.
[Корректная остановка](./shutdown).

## Тестирование с MCP Inspector

Для тестирования потокового HTTP-сервера через [MCP Inspector](https://github.com/modelcontextprotocol/inspector) сначала запустите сервер:

```bash
cargo run
```

Затем откройте Inspector и подключитесь к `http://127.0.0.1:3000/mcp`.

## Обучение на примерах

* [HTTP-сервер](https://github.com/RomanEmreis/neva/tree/main/examples/http)
* [Защищённый сервер с JWT-аутентификацией](https://github.com/RomanEmreis/neva/tree/main/examples/protected-server)
* [Сервер-ресурс OAuth 2.1](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-server)
* [Сервер сэмплирования с TLS](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/server)
* [Свой HTTP-стек (axum)](https://github.com/RomanEmreis/neva/tree/main/examples/axum)
* [Свой HTTP-стек (hyper)](https://github.com/RomanEmreis/neva/tree/main/examples/hyper)
* [Свой HTTP-стек (actix-web)](https://github.com/RomanEmreis/neva/tree/main/examples/actix)
