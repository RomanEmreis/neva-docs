---
sidebar_position: 18
---

# OAuth 2.1

[MCP 2026-07-28](../spec-2026-07-28) делает Streamable HTTP-сервер **защищённым
ресурсом OAuth 2.1**: он проверяет полученные bearer-токены по ключам сервера
авторизации, публикует документ *Protected Resource Metadata*
([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) и отвечает на
неавторизованный запрос заголовком `WWW-Authenticate`, который на этот документ
указывает. Этот вызов и есть вся история обнаружения на стороне клиента: клиент,
знающий только URL конечной точки, находит сервер авторизации по `401`.

Включается фичей `server-oauth` (входит в `server-full`).

:::info Два способа аутентификации
Эта страница — про OAuth. Если ваше развёртывание само выпускает JWT и нужна
только проверка подписи и claims, то [JWT-аутентификация](./http#jwt-аутентификация)
короче — `set_decoding_key` и больше ничего. Проверки ролей и прав ниже
одинаковы в обоих случаях.
:::

## Минимальный защищённый сервер

Достаточно назвать issuer:

```rust
use neva::prelude::*;

#[tool]
async fn whoami() -> &'static str {
    "an authenticated caller"
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_http(|http| http
                .bind("127.0.0.1:3000")
                .with_auth(|auth| auth
                    .with_oauth(|oauth| oauth
                        .with_issuer("https://auth.example.com")))))
        .run()
        .await;
}
```

Один `with_issuer` делает четыре вещи:

* обнаруживает метаданные issuer'а и его JWKS и проверяет по найденным ключам
  каждый bearer-токен;
* требует, чтобы `aud` токена содержал канонический URI ресурса этого сервера
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)) — токен, выпущенный для
  другого ресурса, отклоняется, а не принимается только потому, что он валиден;
* требует, чтобы `iss` совпадал с настроенным issuer'ом;
* выводит из issuer'а документ Protected Resource Metadata и отдаёт его по
  well-known-пути, так что `with_oauth_metadata` ниже необязателен.

Issuer в режиме OAuth **обязателен**: сборка с `with_oauth` без него падает
при старте сервера, а не принимает непроверенные токены.

### Параметры проверки токенов

| Метод | Описание |
|---|---|
| `with_issuer()` | URL идентификатора issuer'а, чьи ключи проверяют токены. Обязателен |
| `with_refresh_cooldown()` | Минимальный интервал между двумя попытками обновить JWKS (по умолчанию 60 с) |
| `with_max_key_age()` | Возраст, после которого набор ключей перезапрашивается даже для известных `kid`, чтобы отозванный ключ не оставался доверенным бесконечно (по умолчанию 15 минут) |
| `with_config()` | Выход на нижележащий [`volga::auth::OAuthConfig`](https://docs.rs/volga) для настроек без аналога на уровне neva |

Проверки `aud`, `iss` и срока действия приходят из
[`AuthConfig`](./http#параметры-конфигурации-аутентификации) и там же
переопределяются; режим OAuth только задаёт значения по умолчанию.

## Публикация документа метаданных

Выведенный документ обычно верен. Опишите его явно, если нужно объявить scope'ы,
назвать больше одного сервера авторизации или поправить идентификатор ресурса за
обратным прокси:

```rust
App::new()
    .with_options(|opt| opt
        .with_http(|http| http
            .bind("127.0.0.1:3000")
            .with_oauth_metadata(|oauth| oauth
                .with_authorization_servers(["https://auth.example.com"])
                .with_scopes(["mcp:tools", "mcp:resources"]))
            .with_auth(|auth| auth
                .with_oauth(|oauth| oauth
                    .with_issuer("https://auth.example.com")))))
    .run()
    .await;
```

| Метод | Описание |
|---|---|
| `with_authorization_servers()` | Идентификаторы issuer'ов, которые могут авторизовать доступ к этому серверу |
| `with_scopes()` | Значения scope, которые клиенту следует запрашивать |
| `with_resource()` | Канонический URI ресурса, когда публичный URL отличается от адреса привязки |
| `with_metadata()` | Полный доступ к билдеру RFC 9728 — `resource_name`, ссылки на документацию и всё остальное |

### За обратным прокси

Идентификатор ресурса по умолчанию — собственный URL сервера
(`proto://addr/endpoint`), то есть адрес привязки, а не то, что набирают
клиенты. Терминация TLS перед сервером или другой путь конечной точки разводят
эти два значения, и токен, чей `aud` называет публичный URL, отклоняется
сервером, ожидающим приватный. Укажите публичный URL:

```rust
.with_oauth_metadata(|oauth| oauth
    .with_resource("https://api.example.com/mcp"))
```

Значение канонизируется по RFC 8707 — схема и хост в нижний регистр, порты по
умолчанию отбрасываются, — так что записанная вами строка и строка, которую
выведет клиент, совпадут.

## Что видит клиент

```
--> POST /mcp                      (без заголовка Authorization)
<-- 401 Unauthorized
    WWW-Authenticate: Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"

--> GET  /.well-known/oauth-protected-resource/mcp
<-- 200 { "resource": "https://api.example.com/mcp",
          "authorization_servers": ["https://auth.example.com"],
          "scopes_supported": ["mcp:tools", "mcp:resources"] }
```

Дальше клиент находит сервер авторизации, получает токен и повторяет запрос.
[Клиент → OAuth 2.1](../mcp-client/oauth) — это вторая половина; клиент neva
проходит всю последовательность внутри `connect()`.

## Роли и права

Claims токена ограничивают доступ к отдельным примитивам ровно так же, как при
JWT-аутентификации — при несоответствии доступ отклоняется с `403 Forbidden`:

```rust
/// Любой аутентифицированный вызывающий
#[tool]
async fn whoami() -> &'static str {
    "an authenticated caller"
}

/// Только админы
#[tool(roles = ["admin"])]
async fn admin_report(name: String) -> String {
    format!("confidential report: {name}")
}

/// Требует право "read"
#[resource(uri = "res://restricted/{name}", permissions = ["read"])]
async fn restricted_resource(uri: Uri, name: String) -> (String, String) {
    (uri.to_string(), name)
}
```

См. [Управление доступом на основе ролей](./http#управление-доступом-на-основе-ролей).

## Локальный issuer для разработки

Обнаружение по умолчанию отклоняет issuer'ы на голом `http`. Для локального
Keycloak и подобных это требование можно снять — и только там:

```rust
.with_auth(|auth| auth
    .with_oauth(|oauth| oauth
        .with_issuer("http://localhost:8080/realms/neva")
        .with_config(|cfg| cfg
            .with_client_config(|c| c.require_https(false)))))
```

## На своём HTTP-стеке

Документ метаданных, его well-known-путь и вызов `WWW-Authenticate` **не зависят
от движка**: они живут в ядре транспорта, поэтому любой
[`HttpEngine`](./custom-http) отдаёт побайтно одинаковые данные. Проверка
*токенов* — задача движка: встроенный адаптер Volga использует её
bearer/JWKS-конвейер, а свой движок приносит собственную middleware. Ровно для
этого протокольные типы (`ProtectedResourceMetadata`, `BearerChallenge`,
`OAuthError`, `canonicalize_resource_uri`, …) реэкспортированы из
`neva::auth::oauth`.

## Обучение на примерах

* [`examples/oauth-server`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-server)
  — защищённый сервер-ресурс против любого issuer'а OAuth 2.1 / OIDC
* [`examples/oauth-with-keycloak`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-with-keycloak)
  — сервер + клиент + готовый realm
* [`examples/oauth-hyper-engine`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-hyper-engine)
  — тот же контракт на своём движке
* [Клиент → OAuth 2.1](../mcp-client/oauth) — вторая половина
