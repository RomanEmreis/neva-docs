---
sidebar_position: 12
---

# OAuth 2.1

Клиент neva авторизуется сам. Направьте его на защищённый сервер, вызовите
`connect()` — и первый `401` запустит всю последовательность: прочитать вызов
`WWW-Authenticate`, получить
[Protected Resource Metadata](../mcp-server/oauth#публикация-документа-метаданных),
найти сервер авторизации, получить `client_id`, выполнить grant, приложить
токен — и дальше прозрачно его обновлять.

Включается фичей `client-oauth` (входит в `client-full`).

## Минимальная конфигурация

Всё необязательно. `with_oauth(|oauth| oauth)` — законченная конфигурация:

```rust
use neva::prelude::*;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")
                .with_oauth(|oauth| oauth))
            // Первый запрос может ждать, пока пользователь закончит в
            // браузере — дайте больше стандартных 10 секунд.
            .with_timeout(Duration::from_secs(300)));

    client.connect().await?;

    let result = client.call_tool("whoami", ()).await?;
    println!("{:?}", result.content);

    client.disconnect().await
}
```

Без настроек: клиент регистрируется динамически, запрашивает объявленные
ресурсом `scopes_supported`, открывает системный браузер для раунда
authorization code + PKCE, ловит редирект на эфемерном loopback-порту и держит
токен в хранилище внутри процесса.

## Как получить `client_id`

MCP определяет три механизма регистрации и порядок приоритета между ними,
которому конфигурация и следует:

| Приоритет | Механизм | Настраивается |
|---|---|---|
| 1 | **Предварительная регистрация** — учётные данные выданы вне протокола | `with_client_id(..)`, привязка к своему серверу через `with_issuer(..)` |
| 2 | **Client ID Metadata Document (CIMD)** — https-URL, который сервер авторизации разыменовывает | `with_client_id_document(url)` |
| 3 | **Dynamic Client Registration** (RFC 7591) — запасной путь, **устаревший** в спецификации 2026-07-28 | ничего; это то, что происходит, если ни один из вариантов выше не настроен |

Сервер, не предлагающий ни одного из трёх, получает отказ **до открытия
браузера**, с указанием на `with_client_id` как на выход, — вместо того чтобы
тратить взаимодействие с пользователем на идентификатор, который получить
нельзя.

### Предварительно зарегистрированные учётные данные

```rust
.with_oauth(|oauth| oauth
    .with_client_id("mcp-cli")
    .with_issuer("https://auth.example.com")
    .with_handler(LoopbackHandler::new().with_port(8919)))
```

`with_issuer` — не украшение. `client_id` выпускает один сервер авторизации, и у
другого он ничего не значит; refresh-токен тоже. Указание issuer'а — это то, что
позволяет клиенту отличить *тот же сервер, что и раньше* от *ресурс теперь
указывает куда-то ещё*:

* предварительно зарегистрированные учётные данные, встретившие другой issuer,
  вызывают ошибку с указанием обоих, вместо того чтобы быть предъявленными
  серверу, который их не выпускал;
* сохранённый refresh-токен предлагается только тому серверу, который его выпустил.

:::warning Сохранённому refresh-токену нужен `with_issuer`
Refresh-токен — это bearer-credential для своей token endpoint, а за сервер
авторизации, который находит поток, ручается только сам ресурс — ровно то, что
переписывает атакующий, контролирующий ресурс. Поэтому начиная с **0.5.3**
обновление после перезапуска требует `with_issuer` и читает токен по нему. Без
него сессия авторизуется интерактивно заново; перенаправление `with_issuer` на
новый сервер не переносит туда токен старого, а динамически зарегистрированные
клиенты токен не переиспользуют никогда.
:::

### Client ID Metadata Documents

CIMD — это путь вперёд для клиента и сервера без предварительных отношений:
`client_id` **и есть** https-URL, который сервер авторизации разыменовывает,
чтобы получить метаданные клиента. Никакого запроса на регистрацию.

```rust
.with_oauth(|oauth| oauth
    .with_client_id_document("https://app.example.com/mcp-client.json")
    .with_handler(LoopbackHandler::new().with_port(8919)))
```

URL должен использовать `https` и содержать путь; это проверяется при
подключении клиента, поэтому некорректный URL падает там, а не посреди потока.
Документ описывает *публичного* клиента, поэтому сочетание с
`with_client_secret` отклоняется: документ разыменовывает тот сервер авторизации,
который встретит URL, и делить секрет попросту не с кем.

Хостинг документа — ваша задача, это статический файл. Сгенерируйте его
содержимое из той же конфигурации, чтобы они не разошлись:

```rust
use neva::auth::oauth::OAuthClientConfig;

let config = OAuthClientConfig::default()
    .with_client_id_document("https://app.example.com/mcp-client.json");

let document = config.client_metadata_document([
    "http://127.0.0.1:8919/callback",
    "http://localhost:8919/callback",
])?;

println!("{}", serde_json::to_string_pretty(&document)?);
```

Перечислить нужно каждый redirect URI, который может выдать обработчик, — сервер
авторизации сверяет присланный ему URI с этим списком. Поэтому `LoopbackHandler`
на *эфемерном* порту не описывается никаким документом: зафиксируйте порт через
`with_port` и перечислите оба написания — `127.0.0.1` и `localhost`. Grant без
редиректа (client credentials, JWT bearer) передаёт пустой список.

## Grants

Поток authorization code + PKCE используется по умолчанию и требует
пользователя перед браузером. Три профиля аутентифицируют **сам клиент**, для
развёртываний, где спрашивать некого:

```rust
// RFC 6749 §4.4 — клиент аутентифицируется как он сам
.with_oauth(|oauth| oauth
    .with_client_id("mcp-service")
    .with_client_secret("s3cret")
    .with_client_credentials())
```

```rust
// RFC 7523 §2.1 — федерация workload identity
.with_oauth(|oauth| oauth
    .with_client_id("customer-router-agent")
    .with_jwt_bearer(workload_jwt))
```

```rust
// Корпоративный профиль — RFC 8693 у поставщика идентичности,
// затем полученный grant у сервера авторизации ресурса
use neva::auth::oauth::IdentityAssertion;

.with_oauth(|oauth| oauth
    .with_client_id("mcp-app")
    .with_client_secret("s3cret")
    .with_identity_assertion(IdentityAssertion::new(
        "https://acme.idp.example", "idp-app", id_token)))
```

| Grant | Когда | Примечания |
|---|---|---|
| Authorization code + PKCE | По умолчанию. Пользователь присутствует | Раунд с браузером идёт через [`AuthorizationHandler`](#интерактивный-шаг) |
| `with_client_credentials()` | Сервис без пользователя | Расширение `io.modelcontextprotocol/oauth-client-credentials`. Требует настроенного `client_id` — динамическая регистрация здесь не используется |
| `with_jwt_bearer(provider)` | Workload, у которого уже есть выпущенный платформой credential (projected service-account token, SPIFFE SVID) | `provider` спрашивают заново на каждый запрос токена, так что ротируемый credential читается свежим. `String` сам по себе является `AssertionProvider` |
| `with_identity_assertion(..)` | Корпоративный SSO | Сахар над `with_jwt_bearer` — `IdentityAssertion` и есть провайдер, выполняющий обмен по RFC 8693 |

Про неинтерактивные grants стоит знать две вещи:

* **Всё до запроса токена не меняется** — `401`, обнаружение, resource indicator
  по RFC 8707. Раунда с браузером просто нет, поэтому `AuthorizationHandler` не
  вызывается и слушатель редиректа не поднимается.
* **Отказ завершает вызов.** Клиент предъявил единственный имеющийся у него
  credential; он ни повторяет его, ни берётся за другой grant. Для client
  credentials обновление — это повторный запуск grant'а, проактивный, потому что
  RFC 6749 §4.4.3 refresh-токен не выдаёт.

:::note Две регистрации на двух серверах
Для `with_identity_assertion` учётные данные в `OAuthClientConfig` принадлежат
серверу авторизации *MCP-сервера*, где предъявляется grant. Данные в
`IdentityAssertion` принадлежат поставщику идентичности, где grant получают. Они
не взаимозаменяемы.
:::

## Аутентификация на token endpoint

### Клиентский секрет

```rust
.with_oauth(|oauth| oauth
    .with_client_id("mcp-cli")
    .with_client_secret("s3cret"))
```

Отправляется как HTTP Basic (RFC 6749 §2.3.1) — это предпочтительный вариант и
запасной для сервера, который ничего не объявляет, — если только в
`token_endpoint_auth_methods_supported` сервера авторизации не указан один лишь
`client_secret_post`: тогда секрет едет в теле запроса. Сервер, не принимающий ни
того ни другого, роняет поток, а не отправляет секрет способом, о котором сказано,
что он будет отвергнут.

### `private_key_jwt`

Клиент подписывает короткоживущее утверждение собственным ключом, и ничего из
того, чем он владеет, процесс не покидает. Именно это расширение client
credentials РЕКОМЕНДУЕТ вместо секрета. За фичей **`client-oauth-jwt`** — это
единственная часть OAuth-клиента, которой нужен JWS-бэкенд, — и она входит в
`client-full`.

```rust
use neva::auth::oauth::{JwsAlgorithm, PrivateKeyJwt};

let key = PrivateKeyJwt::from_pem(pem, JwsAlgorithm::ES256)?;

let client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .with_oauth(|oauth| oauth
                .with_client_id("mcp-service")
                .with_private_key_jwt(key)
                .with_client_credentials())));
```

Утверждение *и есть* credential, поэтому сочетание с `with_client_secret`
отклоняется, а не разрешается молча в пользу утверждения.

**В паре с CIMD** ключ — это то, что вообще позволяет незарегистрированному
клиенту аутентифицироваться: сервер разыменовывает один URL и узнаёт и кто такой
клиент, и каким ключом проверять. `client_metadata_document` тогда публикует и
проверяющий ключ — встроенным через `PrivateKeyJwt::with_public_jwk` или по
ссылке через `with_jwks_uri`:

```rust
let config = OAuthClientConfig::default()
    .with_client_id_document("https://app.example.com/mcp-client.json")
    .with_jwks_uri("https://app.example.com/jwks.json")
    .with_private_key_jwt(key);
```

Ровно один из двух вариантов, по RFC 7591 §2: отсутствие обоих отклоняется при
генерации документа, а не оборачивается `invalid_client` на каждом запросе токена
потом, а наличие обоих нарушает спецификацию напрямую.

## DPoP: токены, привязанные к отправителю

Bearer-токен — это пароль: кто украл, тот и потратит. Привязанный по DPoP
([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)) без ключа ничего не стоит,
потому что каждый запрос несёт доказательство, подписанное над собственным
методом и URL и над самим токеном. За фичей **`client-oauth-dpop`**, входит в
`client-full`.

```rust
use neva::auth::oauth::Dpop;

let key = Dpop::generate()?;

let client = Client::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .with_oauth(|oauth| oauth.with_dpop(key))));
```

| Настройка | Поведение |
|---|---|
| *(по умолчанию)* | Bearer-токены. DPoP — необязательное расширение и сам по себе не включается |
| `with_dpop(key)` | Привязывает каждый токен к `key` и **отклоняет** сервер авторизации, ответивший непривязанным токеном. `Dpop::generate()` создаёт одноразовый ключ на сессию; `Dpop::from_pem` загружает постоянный, чей thumbprint серверу сообщили вне протокола |
| `with_dpop_auto()` | Создаёт ключ `ES256`, когда сервер об этом просит — вызовом со схемой `DPoP` (§7.1) или объявлением `dpop_signing_alg_values_supported` (§5.1), — и использует bearer в остальных случаях |

`with_dpop_auto()` — настройка для клиента, работающего с серверами, которыми он
не управляет: она никогда не превращает рабочий bearer-поток в отказ. Но выбор
при этом остаётся за сервером, так что клиенту, которому нельзя держать
непривязанный credential, нужен `with_dpop`.

Оба раунда с nonce отрабатываются — у token endpoint (§8) и у ресурса (§9),
причём второй стоит одного повтора запроса, а не повторной авторизации: ни токен,
ни ключ под сомнение не ставились.

:::warning DPoP-соединение не следует за редиректами
Доказательство покрывает один метод и один URL, переподписать его по дороге
нечем, и ни один повтор не спасает от перехода, унёсшего неверное, — поэтому
`3xx` отдаётся как есть. Bearer-соединений это не касается.
:::

:::note Расширение, и оценивается как расширение
SEP-1932 не смержен, а в тексте 2026-07-28 DPoP не встречается, поэтому пакет
проверок соответствия neva относит `auth/dpop` и `auth/dpop-nonce` к
расширениям. Оба зелёные на обоих профилях.
:::

## Интерактивный шаг

`AuthorizationHandler` — это шов для раунда с браузером; `LoopbackHandler`
используется по умолчанию: открывает системный браузер и ловит редирект на
эфемерном loopback-порту.

```rust
use neva::auth::oauth::LoopbackHandler;

.with_oauth(|oauth| oauth
    .with_handler(LoopbackHandler::new().with_port(8919)))
```

Фиксируйте порт всегда, когда сервер авторизации сверяет redirect URI со списком
зарегистрированных, — а это и предварительно зарегистрированный клиент, и
опубликованный через CIMD. Редирект в любую точку `127.0.0.0/8` регистрирует
**нативного** клиента (RFC 8252 §7.3), так что обработчик на `127.0.0.2` не будет
принят за `web`-клиента и отвергнут за plain-http redirect URI.

Замените обработчик целиком для headless-потока или потока внутри GUI —
реализуйте `redirect_uri` и `authorize` и ведите пользователя так, как это
принято в вашем приложении.

## Хранение токенов

Хранилище по умолчанию живёт внутри процесса: токены живут столько же, сколько
клиент. Дайте ему зашифрованный файл или системный keychain, чтобы пережить
перезапуск:

```rust
.with_oauth(|oauth| oauth
    .with_issuer("https://auth.example.com")
    .with_token_store(my_keychain_store))
```

:::warning Ключ хранилища изменился в 0.5.3
Запись хранится под `{issuer}|{client}|{resource}` — под всей идентичностью, к
которой относится credential, — а не под одним ресурсом, так что два сервера
(или два клиента, делящие одно постоянное хранилище) никогда не занимают один
слот. Записи, сделанные более ранней версией, по новому ключу не находятся и
остаются на месте; затронутые сессии один раз авторизуются заново.
:::

## Справочник по конфигурации

| Метод | Описание |
|---|---|
| `with_client_id(..)` | Предварительно зарегистрированный идентификатор клиента |
| `with_client_id_document(url)` | Идентификация через CIMD; `url` — и идентификатор, и место хостинга метаданных |
| `with_issuer(..)` | Сервер авторизации, которому принадлежат настроенные учётные данные |
| `with_client_secret(..)` | Конфиденциальный клиент с общим секретом |
| `with_private_key_jwt(key)` | Аутентификация клиента через `private_key_jwt` (`client-oauth-jwt`) |
| `with_jwks_uri(url)` | Публиковать проверяющий ключ по ссылке в генерируемом документе |
| `with_client_credentials()` | Grant client credentials |
| `with_jwt_bearer(provider)` | Grant-утверждение по RFC 7523 §2.1 |
| `with_identity_assertion(..)` | Корпоративный профиль |
| `with_scopes([..])` | Запрашиваемые scope'ы; по умолчанию — `scopes_supported` ресурса |
| `with_dpop(key)` / `with_dpop_auto()` | Токены, привязанные к отправителю (`client-oauth-dpop`) |
| `require_https(bool)` | Отклонять ли discovery/token endpoint'ы на голом `http`. Включено по умолчанию; выключайте только для локального issuer'а разработки |
| `with_token_store(..)` | Заменить хранилище токенов внутри процесса |
| `with_handler(..)` | Заменить интерактивный шаг |
| `client_metadata_document([..])` | Собрать JSON для хостинга по CIMD-URL |

## Обучение на примерах

* [`examples/oauth-client`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-client)
  — весь поток внутри `connect()`
* [`examples/oauth-with-keycloak`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-with-keycloak)
  — предварительно зарегистрированный клиент против реального issuer'а
* [Сервер → OAuth 2.1](../mcp-server/oauth) — сторона сервера-ресурса
