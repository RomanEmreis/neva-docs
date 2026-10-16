---
sidebar_position: 19
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
Эта страница — про OAuth. Если ваше развёртывание само выпускает JWT или держит
у себя публичный ключ issuer'а, и нужна только проверка подписи и claims, то
[JWT-аутентификация](./http#jwt-аутентификация) короче — ключ проверки и больше
ничего. Проверки ролей, прав и scope'ов ниже, как и
[`ctx.claims()`](#who-is-calling), одинаковы в обоих случаях.
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
| `with_jwks_uri()` | Забирать набор ключей issuer'а с этого URL, а не через обнаружение — см. [ниже](#an-issuer-the-server-cannot-reach) |
| `with_refresh_cooldown()` | Минимальный интервал между двумя попытками обновить JWKS (по умолчанию 60 с) |
| `with_max_key_age()` | Возраст, после которого набор ключей перезапрашивается даже для известных `kid`, чтобы отозванный ключ не оставался доверенным бесконечно (по умолчанию 15 минут) |
| `with_config()` | Выход на нижележащий [`volga::auth::OAuthConfig`](https://docs.rs/volga) для настроек без аналога на уровне neva — в том числе политики HTTP-клиента для обнаружения и загрузки ключей |

Проверки `aud`, `iss` и срока действия приходят из
[`AuthConfig`](./http#параметры-конфигурации-аутентификации) и там же
переопределяются; режим OAuth только задаёт значения по умолчанию.

### Issuer, до которого сервер не дотягивается {#an-issuer-the-server-cannot-reach}

Обнаружение забирает метаданные issuer'а с самого URL issuer'а, и этот документ
называет URL дважды: как свой `issuer`, который должен совпадать с адресом,
откуда документ получен, и внутри `jwks_uri`. Сервер, который видит issuer под
другим именем, обнаружить его не может: issuer запущен на хосте как
`http://localhost:8787`, а сервер в контейнере достаёт его как
`http://host.docker.internal:8787`; или сервис Kubernetes стоит за публичным
ingress-хостом. Укажите набор ключей напрямую, и обнаружение пропускается:

```rust
.with_auth(|auth| auth
    .with_oauth(|oauth| oauth
        .with_issuer("http://localhost:8787")
        .with_jwks_uri("http://host.docker.internal:8787/jwks")
        .with_config(|cfg| cfg
            .with_client_config(|c| c.require_https(false)))))
```

`with_issuer` сохраняет смысл: токены должны нести его в `iss`, и документ
метаданных отправляет клиентов к нему. Меняется только то, откуда берутся
ключи, — ротация, интервал обновления и возраст ключей работают так же, как при
обнаружении. Транспортная политика из `with_config` действует и на URL ключей,
поэтому голому `http` выше нужен `require_https(false)`.

Если ключи не отдаёт вообще никакой URL, поставляйте публичный ключ issuer'а
вместе с развёртыванием и проверяйте им напрямую —
[`with_decoding_key`](./http#a-public-key) вместо `with_oauth`. Такой ключ не
следует за ротациями issuer'а. Два режима исключают друг друга: сервер, у
которого настроены и статический ключ, и `with_oauth`, не стартует.

## Публикация документа метаданных {#publishing-the-metadata-document}

Выведенный документ обычно верен. Опишите его явно, если нужно объявить другие
scope'ы, чем выведенные, назвать больше одного сервера авторизации или поправить
идентификатор ресурса за обратным прокси:

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
| `with_scopes()` | Значения scope, которые клиенту следует запрашивать. По умолчанию — все scope'ы, которые [требуют](#scopes) элементы сервера |
| `with_resource()` | Канонический URI ресурса, когда публичный URL отличается от адреса привязки |
| `with_metadata()` | Полный доступ к билдеру RFC 9728 — `resource_name`, ссылки на документацию и всё остальное |

### `scopes_supported` {#scopes_supported}

Если его не трогать, `scopes_supported` перечисляет каждый scope, который
[требует](#scopes) инструмент, промпт или ресурс, поэтому документ и проверки не
могут разойтись. Задайте `with_scopes`, когда клиенту следует начинать не со
всех scope'ов и [добирать](#scopes) остальные по ходу, или чтобы объявить
scope'ы, которые сервер проверяет как-то иначе; пустой список не объявляет
ничего. Непустой `scopes_supported`, заданный через `with_metadata`, тоже
заменяет выведенный список — пустой там считается незаданным.

Выведенный список строится один раз, при старте: элемент, добавленный во время
работы сервера, в него не попадает.

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

Прокси, терминирующий TLS, к тому же пересылает запросы по голому HTTP с
адреса, который не является loopback, а конечная точка MCP по умолчанию такое
отклоняет. Добавьте `require_https(false)` в конфигурацию аутентификации — см.
[Голый HTTP за прокси](./http#plain-http-behind-a-proxy):

```rust
.with_auth(|auth| auth
    .require_https(false)
    .with_oauth(|oauth| oauth
        .with_issuer("https://auth.example.com")))
```

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

Валидный, но слишком узкий для вызова токен получает вместо этого `403` —
[step-up](#scopes)-вызов:

```
--> POST /mcp                      Authorization: Bearer <токен со scope mcp:tools>
    { "method": "tools/call", "params": { "name": "purge_cache", … } }
<-- 403 Forbidden
    WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:tools mcp:admin", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"
    { "error": { "code": -31403,
                 "data": { "requiredScopes": ["mcp:tools", "mcp:admin"],
                           "missingScopes": ["mcp:admin"] }, … } }
```

## Роли, права и scope'ы {#roles-permissions-and-scopes}

Claims токена ограничивают доступ к отдельным примитивам ровно так же, как при
JWT-аутентификации:

```rust compile
use neva::prelude::*;

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

/// Требует токен, выдающий оба scope'а
#[tool(scopes = ["mcp:tools", "mcp:admin"])]
async fn purge_cache() -> &'static str {
    "cache purged"
}
```

Три проверки читают разные claims и отказывают по-разному:

| Проверка | Чем удовлетворяется | Что получает вызывающий, которому не хватает |
|---|---|---|
| `roles` | **любой одной** из ролей, в `role` или `roles` токена | `InvalidParams` (-32602) в ответе `200` |
| `permissions` | **любым одним** из прав, в `permissions` | `InvalidParams` (-32602) в ответе `200` |
| `scopes` | **всеми** scope'ами, в `scope` токена | `403` с вызовом `insufficient_scope` и `InsufficientScope` (-31403) |

Объявленные вместе, проходить должны все проверки. В форме билдера это
`with_roles([..])`, `with_permissions([..])` и `with_scopes([..])` на `Tool`,
`Prompt`, `ResourceTemplate` или [`UiResource`](./apps#авторизация).

### Scope'ы {#scopes}

Роль или право — решение о вызывающем, и новый токен его не меняет. Scope —
выдача, которую вызывающий может запросить, поэтому именно на отказ по scope
клиент может что-то сделать. Он приходит до того, как запрос отправлен в
обработку: `403`, чей вызов `WWW-Authenticate` называет **все** scope'ы,
которых требует элемент (RFC 6750 §3.1), а JSON-RPC-ошибка несёт тот же список
как `requiredScopes` и недостающие токену — как `missingScopes`. Клиент заново
авторизуется под эти scope'ы и повторяет вызов;
[клиент neva](../mcp-client/oauth#stepping-up) делает это сам.

* **Закрытый элемент остаётся в списке.** `tools/list` по-прежнему показывает
  `purge_cache`: клиент должен увидеть инструмент, прежде чем добирать под него
  права.
* **Недостающая роль важнее недостающего scope.** Если элемент требует и того,
  и другого, а у вызывающего нет ни того, ни другого, отказ — это `InvalidParams`
  по роли: ни один клиент не отправится переавторизовываться ради вызова,
  которому всё равно откажут.
* **Потоки и пакеты тоже получают step-up.** Проверка идёт до отправки в
  обработку, поэтому запрос, который открыл бы поток событий, сначала получает
  свой `403`. Пакет, в котором хоть одному запросу не хватает scope, отклоняется
  целиком — по объединению scope'ов, а остальные его запросы получают ответ «не
  обработан»: клиент отправит весь пакет заново с более широким токеном.
* **`ErrorCode::InsufficientScope` — собственный код neva.** MCP не выделяет для
  этого кода, поэтому neva берёт `-31403` — вне диапазона, зарезервированного
  JSON-RPC, куда не попадёт ни один будущий код MCP.

По умолчанию документ метаданных объявляет все заявленные scope'ы как
[`scopes_supported`](#scopes_supported).

## Кто вызывает {#who-is-calling}

Обработчик получает claims токена вызывающей стороны через
[`ctx.claims()`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.claims):

```rust compile
use neva::prelude::*;

#[tool]
async fn whoami(ctx: Context) -> Result<String, Error> {
    let Some(caller) = ctx.claims() else {
        return Err(Error::new(ErrorCode::InvalidRequest, "no authenticated caller"));
    };
    // Subject уникален только в пределах своего issuer'а: данные пользователя
    // храните по обоим.
    Ok(format!(
        "{} from {}",
        caller.subject().unwrap_or("nobody"),
        caller.issuer().unwrap_or("no issuer")
    ))
}
```

| Метод | Claim |
|---|---|
| `subject()` | `sub` — для кого выпущен токен |
| `issuer()` | `iss` — кто его выпустил |
| `audience()` | `aud` — все аудитории, которые он называет, одну или несколько |
| `client_id()` | `client_id` ([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068)) — OAuth-клиент, действующий от имени subject'а, например агент, сделавший вызов |
| `scopes()` | `scope`, разбитый по одному scope на элемент |
| `role()` / `roles()` / `permissions()` | То, что проверяют проверки ролей и прав |

Без аутентифицированного вызывающего это `None`: сервер без bearer-аутентификации
или сборка без HTTP-транспорта, где вызов всё равно компилируется и всегда
отвечает `None`. [Промежуточный обработчик](./middlewares#who-is-calling) читает
те же claims через `MwContext::claims()`.

`claims()` возвращает `&dyn Claims`. За ним стоит конкретный тип —
[`DefaultClaims`](https://docs.rs/neva/latest/neva/auth/struct.DefaultClaims.html)
у встроенного движка Volga, то, что декодировал
[свой движок](./custom-http#аутентификация), у вашего, — и `downcast_ref` его
возвращает, для claims, которых трейт не показывает:

```rust compile-fragment
use neva::prelude::*; // DefaultClaims есть в prelude

let expires = ctx
    .claims()
    .and_then(|c| c.downcast_ref::<DefaultClaims>())
    .and_then(|c| c.exp);
```

## Локальный issuer для разработки {#a-local-development-issuer}

Обнаружение по умолчанию отклоняет issuer'ы на голом `http`. Для локального
Keycloak и подобных это требование можно снять — и только там:

```rust
.with_auth(|auth| auth
    .with_oauth(|oauth| oauth
        .with_issuer("http://localhost:8080/realms/neva")
        .with_config(|cfg| cfg
            .with_client_config(|c| c.require_https(false)))))
```

Этот `require_https` управляет URL, к которым обращается сам сервер, —
обнаружением и набором ключей. Принимает ли сервер запрос клиента по голому
HTTP — другой переключатель, в самой конфигурации аутентификации:
[Голый HTTP за прокси](./http#plain-http-behind-a-proxy).

## На своём HTTP-стеке

Документ метаданных, его well-known-путь и вызовы `WWW-Authenticate` — `401` и
step-up по `403` — **не зависят от движка**: они живут в ядре транспорта,
поэтому любой [`HttpEngine`](./custom-http) отдаёт побайтно одинаковые данные.
Проверка *токенов* — задача движка: встроенный адаптер Volga использует её
bearer/JWKS-конвейер, а свой движок приносит собственную middleware. Ровно для
этого протокольные типы (`ProtectedResourceMetadata`, `BearerChallenge`,
`OAuthError`, `canonicalize_resource_uri`, …) реэкспортированы из
`neva::auth::oauth`.

## Обучение на примерах

* [`examples/oauth-server`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-server)
  — защищённый сервер-ресурс против любого issuer'а OAuth 2.1 / OIDC, с
  инструментом под scope и `OAUTH_JWKS_URI` для issuer'а, до которого сервер не
  дотягивается
* [`examples/oauth-with-keycloak`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-with-keycloak)
  — сервер + клиент + готовый realm
* [`examples/oauth-hyper-engine`](https://github.com/RomanEmreis/neva/tree/main/examples/oauth-hyper-engine)
  — тот же контракт на своём движке
* [Клиент → OAuth 2.1](../mcp-client/oauth) — вторая половина
