---
sidebar_position: 8
---

# Свой HTTP-стек

Потоковый HTTP-транспорт в Neva — **подключаемый**. По умолчанию сервер построен на [Volga](https://docs.rs/volga) и включается через `server-full` / `http-server-volga`, но начиная с **v0.3.3** MCP-эндпоинт можно разместить на любом HTTP-стеке — `axum`, `hyper`, `actix-web` или собственном адаптере, — реализовав один трейт.

Всё, что касается JSON-RPC, повторов и дедупликации SSE, быстрого пути для батчей и маршрутизации pending-oneshot-запросов, остаётся внутри neva. Ваш адаптер — это максимально тонкая прослойка, отображающая нативные типы фреймворка (request/response/SSE) на нейтральные типы neva.

В этой статье контракт показан на примере **axum** как канонического адаптера. Для других фреймворков шаблон тот же — стек-специфичные тонкости можно увидеть в примерах для [hyper](https://github.com/RomanEmreis/neva/tree/main/examples/hyper) и [actix-web](https://github.com/RomanEmreis/neva/tree/main/examples/actix).

## Когда это нужно

Свой HTTP-стек имеет смысл, когда нужно:

* Поднять MCP в том же процессе и на том же роутере, что и существующее HTTP-приложение.
* Переиспользовать middleware фреймворка (CORS, логирование запросов, rate limiting, observability, нестандартные схемы аутентификации).
* Заменить Volga на стек, который вы уже эксплуатируете.
* Полностью убрать накладные расходы фреймворка и работать на сыром `hyper`.

Если ничего из этого не требуется — оставайтесь на [HTTP-транспорте по умолчанию](./http): он сразу даёт JWT-аутентификацию, TLS и dev-сертификаты.

## Настройка Cargo

Используйте флаг `http-server`, не привязанный к фреймворку: он поставляет только абстракции и **не** тянет за собой HTTP-стек.

```toml
[dependencies]
neva = { version = "0.3", features = ["http-server", "server-macros", "tracing", "di"] }

axum = "0.8"
http = "1.4"
http-body-util = "0.1"
tokio = { version = "1", features = ["full"] }
tokio-util = "0.7"
```

:::note
Не комбинируйте `http-server` с `http-server-volga` или `server-full` — они включают встроенный адаптер на Volga. Выбирайте один путь HTTP на сборку.
:::

## Контракт `HttpEngine`

Адаптер реализует трейт [`HttpEngine`](https://docs.rs/neva/latest/neva/transport/http/core/engine/trait.HttpEngine.html):

```rust
pub trait HttpEngine: Send + Sync + 'static {
    type Request:  'static;            // нативный запрос фреймворка
    type Response: 'static;            // нативный ответ фреймворка
    type SseEvent: Send + 'static;     // нативное SSE-событие фреймворка

    async fn adapt_request(req: Self::Request) -> HttpRequest;
    fn adapt_response(resp: HttpResponse) -> Self::Response;

    fn tracked_event(seq: u64, msg: &Message) -> Self::SseEvent;
    fn ephemeral_event(msg: &Message) -> Self::SseEvent;

    async fn run(self, ctx: HttpContext, token: CancellationToken) -> Result<(), Error>;
}
```

Пять обязанностей:

1. **`adapt_request`** — забуферизовать тело входящего запроса и преобразовать его в нейтральный `http::Request<Bytes>`.
2. **`adapt_response`** — преобразовать нейтральный `http::Response<Bytes>` обратно в нативный ответ фреймворка.
3. **`tracked_event`** — построить SSE-событие **с** полем `id:` (попадает под повтор по `Last-Event-ID`).
4. **`ephemeral_event`** — построить SSE-событие **без** поля `id:` (лог/уведомление, не повторяется).
5. **`run`** — запустить HTTP-сервер с переданным `HttpContext` и остановиться, когда сработает `token`.

Внутри обработчиков маршрутов всё остальное делают три свободные функции:

* [`handlers::dispatch_post`](https://docs.rs/neva/latest/neva/transport/http/core/handlers/fn.dispatch_post.html) — обработка JSON-RPC POST (одиночный запрос, батч или 202-нотификация).
* [`handlers::dispatch_delete`](https://docs.rs/neva/latest/neva/transport/http/core/handlers/fn.dispatch_delete.html) — обработка удаления сессии.
* [`handlers::dispatch_get_sse`](https://docs.rs/neva/latest/neva/transport/http/core/handlers/fn.dispatch_get_sse.html) — обработка SSE GET-потока, включая повтор по `Last-Event-ID`.

`dispatch_get_sse` возвращает [`SseResponse`](https://docs.rs/neva/latest/neva/transport/http/core/types/enum.SseResponse.html):

```rust
enum SseResponse<S> {
    Stream { headers: http::HeaderMap, stream: S },
    Status(HttpResponse),
}
```

`Stream` — живой SSE-поток; `Status` — ошибка/редирект уровня HTTP (просто прогоните через `adapt_response`).

## Полный пример: адаптер на axum

Ниже — рабочий MCP-сервер на axum. Он экспонирует один инструмент `hello` на `POST /mcp`.

```rust
use axum::{
    Router,
    body::Body,
    extract::State,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::post,
};
use http_body_util::BodyExt;
use neva::prelude::*;
use std::convert::Infallible;
use tokio_util::sync::CancellationToken;

#[derive(Default, Debug)]
struct AxumEngine;

impl HttpEngine for AxumEngine {
    type Request  = http::Request<Body>;
    type Response = Response;
    type SseEvent = Result<Event, Infallible>;

    async fn adapt_request(req: Self::Request) -> HttpRequest {
        let (parts, body) = req.into_parts();
        let bytes = body.collect().await.map(|c| c.to_bytes()).unwrap_or_default();

        let mut builder = http::Request::builder()
            .method(parts.method)
            .uri(parts.uri)
            .version(parts.version);
        if let Some(headers) = builder.headers_mut() {
            for (name, value) in parts.headers.iter() {
                headers.append(name, value.clone());
            }
        }
        builder.body(bytes).expect("valid request")
    }

    fn adapt_response(resp: HttpResponse) -> Self::Response {
        let (parts, body) = resp.into_parts();
        let mut builder = http::Response::builder()
            .status(parts.status)
            .version(parts.version);
        if let Some(headers) = builder.headers_mut() {
            for (name, value) in parts.headers.iter() {
                headers.append(name, value.clone());
            }
        }
        builder.body(Body::from(body)).expect("valid response")
    }

    fn tracked_event(seq: u64, msg: &Message) -> Self::SseEvent {
        Ok(Event::default()
            .id(seq.to_string())
            .json_data(msg)
            .unwrap_or_default())
    }

    fn ephemeral_event(msg: &Message) -> Self::SseEvent {
        Ok(Event::default().json_data(msg).unwrap_or_default())
    }

    async fn run(self, ctx: HttpContext, token: CancellationToken) -> Result<(), Error> {
        let addr = ctx.addr().to_owned();
        let endpoint = ctx.endpoint().to_owned();

        let app = Router::new()
            .route(
                &endpoint,
                post(post_handler).get(get_handler).delete(delete_handler),
            )
            .with_state(ctx);

        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))?;

        axum::serve(listener, app)
            .with_graceful_shutdown(async move { token.cancelled().await })
            .await
            .map_err(|e| Error::new(ErrorCode::InternalError, e.to_string()))
    }
}

async fn post_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    handlers::dispatch_post::<AxumEngine>(req, &ctx).await
}

async fn delete_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    handlers::dispatch_delete::<AxumEngine>(req, &ctx).await
}

async fn get_handler(State(ctx): State<HttpContext>, req: http::Request<Body>) -> Response {
    match handlers::dispatch_get_sse::<AxumEngine>(req, &ctx).await {
        SseResponse::Stream { headers, stream } => {
            let sse = Sse::new(stream).keep_alive(KeepAlive::default());
            let mut response: Response = sse.into_response();
            for (name, value) in headers.iter() {
                response.headers_mut().insert(name, value.clone());
            }
            response
        }
        SseResponse::Status(resp) => AxumEngine::adapt_response(resp),
    }
}

#[tool]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let http = HttpServer::from_engine("127.0.0.1:3000", AxumEngine)
        .with_endpoint("/mcp");

    App::new()
        .with_options(|opt| opt
            .with_name("Axum Example Server")
            .set_http(http)
            .with_mcp_version("2025-06-18"))
        .run()
        .await;
}
```

## Из чего состоит адаптер

**Адаптация запроса.** `Body::collect()` полностью буферизует входящее тело — нейтральный тип запроса в neva это `http::Request<Bytes>`, потоковые тела на пути запроса не поддерживаются. Работа с заголовками и URI — обычные операции крейта `http`.

**Адаптация ответа.** Зеркально: neva возвращает `http::Response<Bytes>`, вы пересобираете `Response` axum и возвращаете его.

**Tracked- и ephemeral-события SSE.** Tracked-события несут поле `id:` и сдвигают курсор `Last-Event-ID` на стороне клиента — при переподключении они повторяются. Ephemeral-события без `id:` и теряются, если клиент их пропустил. neva решает, какое событие сформировать; ваше дело — выдать байты в формате, ожидаемом фреймворком.

**`run`.** Здесь живёт обвязка фреймворка:

* `ctx.addr()` и `ctx.endpoint()` приходят из той же конфигурации `with_http(...)` / `from_engine(...)`, что и у сервера по умолчанию, — поведение не меняется между движками.
* Прокиньте `ctx` в состояние роутера (`with_state` в axum, `app_data` в actix и т.д.), чтобы обработчики имели к нему доступ.
* Свяжите выключение с переданным `CancellationToken` — neva срабатывает его при завершении `App`.

**Обработчики маршрутов — одной строкой.** Вся логика конкретных методов (диспатчер протокола, быстрый путь батчей, инициализация SSE, маршрутизация oneshot-запросов) спрятана в `dispatch_post` / `dispatch_delete` / `dispatch_get_sse`. Обработчики просто пробрасывают запрос и контекст.

## Подключение движка

Когда адаптер компилируется, подключите его через [`HttpServer::from_engine`](https://docs.rs/neva/latest/neva/transport/struct.HttpServer.html#method.from_engine) вместо привычного `with_http(...)`:

```rust
let http = HttpServer::from_engine("127.0.0.1:3000", AxumEngine)
    .with_endpoint("/mcp");

App::new()
    .with_options(|opt| opt.set_http(http))
    .run()
    .await;
```

`bind()`, `with_endpoint()` и методы тюнинга SSE-буферов доступны и на engine-обобщённом `HttpServer` — поверхность та же, что и у сервера по умолчанию.

## Аутентификация

Per-tool / per-prompt / per-resource [гейты на роли и права](./http#управление-доступом-на-основе-ролей) работают с любым движком, но **декодирование** входящего credential (bearer-токен, cookie сессии, нестандартный заголовок — что угодно) и вставку результирующих claims в `request.extensions_mut()` **до** того, как запрос попадёт в `dispatch_post`, выполняет именно движок.

Контракт:

1. Реализуйте [`neva::auth::Claims`](https://docs.rs/neva/latest/neva/auth/trait.Claims.html) для своего типа claims (или используйте `DefaultClaims`).
2. Заверните в `Arc<dyn Claims>`.
3. Вставьте в `req.extensions_mut()` из middleware на стороне фреймворка до вызова диспетчера.

Если claims отсутствуют, neva считает запрос неаутентифицированным, и любой инструмент / промпт / ресурс, требующий ролей или прав, отклонит его с `403 Forbidden`. Публичные инструменты от этого не страдают.

`VolgaEngine` по умолчанию делает это автоматически через `BearerTokenService` из Volga. В своём адаптере вы реализуете тот же шаг в собственной цепочке POST-middleware.

## Какой стек выбрать

| Движок | Когда подходит | Замечания |
|---|---|---|
| **axum** | Вы уже на axum или хотите Send-дружественный, совместимый с tower стек. | Канонический шаблон выше. |
| **hyper** | Нужен сырой HTTP без роутера и накладных расходов фреймворка. | `run` сам владеет accept-циклом и диспатчером по `(method, path)`. |
| **actix-web** | Вы уже на actix или нужна его акторная модель. | Типы запроса/ответа actix — `!Send`; обработчики остаются на рантайме actix и не используют `tokio::spawn`. |
| **Volga (по умолчанию)** | Перечисленное выше не нужно. | Включите `server-full` или `http-server-volga` и пользуйтесь [`with_http(...)`](./http) — реализация `HttpEngine` не нужна. |

## Обучение на примерах

* [Адаптер на axum](https://github.com/RomanEmreis/neva/tree/main/examples/axum) — канонический шаблон.
* [Адаптер на hyper](https://github.com/RomanEmreis/neva/tree/main/examples/hyper) — голый протокольный уровень без роутера.
* [Адаптер на actix-web](https://github.com/RomanEmreis/neva/tree/main/examples/actix) — работа с `!Send` request/response и выделенным рантаймом.
