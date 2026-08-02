---
sidebar_position: 99
---

# Легаси-спецификация

`legacy-spec` — это опциональный флаг Cargo, возвращающий поколение
протокола **до 2026-07-28**, то есть MCP 2024-11-05 … 2025-11-25.

```toml
[dependencies]
neva = { version = "0.5", features = ["server-full", "legacy-spec"] }
```

Это **переключатель поколения, а не добавка**: его включение компилирует
поверхность [MCP 2026-07-28](./spec-2026-07-28) *прочь*. Два поколения
никогда не сосуществуют в одной сборке.

:::warning `--all-features` выбирает легаси-профиль
Флаги Cargo аддитивны, поэтому `--all-features` включает `legacy-spec` и,
следовательно, проверяет именно *легаси*-профиль. Профилю по умолчанию нужен
явный список флагов — например, `--features "server-full client-full"` или
`--features full`. По той же причине `docs.rs` публикует neva с
`features = ["full"]`, а не со всеми флагами.
:::

## Переход на 0.5.0

| Что было в 0.4.x | Что делать |
|---|---|
| `features = ["proto-2026-07-28-rc"]` | **Убрать флаг.** Его больше не существует — то, что он включал, теперь работает по умолчанию. |
| Поведение по умолчанию (без флага протокола) | Добавить `legacy-spec`, чтобы сохранить прежний протокол, либо перейти на [MCP 2026-07-28](./spec-2026-07-28). |

Помимо флага стоит проверить следующие изменения в коде:

* **Задачи** — `opt.with_tasks()` не принимает замыкание; `list_tasks()`
  удалён (вместо него опрашивайте `tasks/get`); `Task::ttl` сериализуется как
  `ttlMs` и теперь имеет тип `Option<usize>`. См. [Задачи](./mcp-server/tasks).
* **Результаты** — каждый успешный результат теперь несёт `resultType`. Если
  вы разбираете сырые ответы, читайте его через `Response::result_type()`.
* **Адаптеры HTTP-движков** — `SseResponse` переименован в `StreamResponse`
  (вариант `Status` — в `Complete`), а `handlers::dispatch_post` возвращает
  `StreamResponse<…>` вместо обычного ответа. См.
  [Собственный HTTP-стек](./mcp-server/custom-http). Устаревший псевдоним
  `SseResponse` сохраняется на один релиз.
* **Удалённые вызовы** — `ping`, `complete_elicitation`,
  `on_elicitation_completed`, `with_logging` / `set_log_level`.
* **Подписки на ресурсы** — `resources/subscribe` / `resources/unsubscribe`
  свёрнуты в фильтр
  [`subscriptions/listen`](./spec-2026-07-28#подписки). Замените
  `client.subscribe_to_resource(uri)` на
  `client.listen(SubscriptionFilter::new().with_resource(uri))`, а из
  серверных обработчиков уберите `ctx.subscribe_to_resource(..)` — подпиской
  теперь владеет клиент. См. [Подписки](./mcp-client/subscriptions).
* **Сэмплирование и корневые каталоги** — по-прежнему доступны, но как
  [виды input-запросов MRTR](./spec-2026-07-28#виды-input-запросов-elicitation-sampling-roots)
  и с пометкой `#[deprecated]`. Атрибутный макрос `#[sampling]` относится к
  легаси-модели с серверным пушем и в сборке по умолчанию недоступен —
  регистрируйте обработчик через `map_sampling`.

## Что возвращает `legacy-spec`

| Область | Легаси-поведение |
|---|---|
| Рукопожатие | `initialize` / `initialized`, с `serverInfo` в `InitializeResult` |
| Транспорт | Streamable HTTP с сессиями: `Mcp-Session-Id`, `DELETE` сессии, отдельный SSE-поток `GET` с воспроизведением по `Last-Event-ID` |
| Выбор версии | `with_mcp_version(...)` на **сервере** |
| Запросы сервер→клиент | Пуш, управляемый возможностями, для `sampling/createMessage`, `roots/list`, `elicitation/create` — без MRTR |
| Макросы | Атрибутный макрос `#[sampling]` |
| Логирование | `logging/setLevel`, а также `with_logging(handle)` и глобальный путь отправки `notifications/message` |
| Инструменты | Легаси-тип `ToolSchema` (не JSON Schema 2020-12) |
| Задачи | Поверхность 2025-11-25: `tasks/list`, `tasks/result`, поддерево возможностей `cancel`/`list`/`requests`, `with_tasks(\|t\| …)`, задачи на стороне клиента |
| Уведомления | `ping`, `notifications/roots/list_changed`, `notifications/elicitation/complete` |
| Подписки | Пара RPC-методов `resources/subscribe` / `resources/unsubscribe`, `Context::subscribe_to_resource` / `unsubscribe_from_resource` и `resource::commands::{SUBSCRIBE, UNSUBSCRIBE}` — состояние подписки на сервере вместо потока `subscriptions/listen` |
| Запросы | Нет обязательных ключей `_meta`, нет проверки заголовков маршрутизации, нет `resultType` |

Всё остальное — DI, промежуточные обработчики, типы содержимого,
JWT-аутентификация, TLS, собственные HTTP-движки, батч-запросы — общее для
обоих поколений и ведёт себя одинаково.

## Работа с легаси-узлом *без* `legacy-spec`

На стороне клиента флаг обычно не нужен. Клиент в сборке по умолчанию
работает в **двойном режиме**: он открывает соединение через
`server/discover` и, если узел явно не понимает MCP 2026-07-28, откатывается
к рукопожатию `initialize` и до конца соединения говорит с ним на старом
протоколе. См.
[Discovery вместо рукопожатия](./spec-2026-07-28#discovery-вместо-рукопожатия).

На **сервере** такого отката нет — он определяется на этапе компиляции.
Серверу, который должен обслуживать легаси-клиентов, нужна сборка с
`legacy-spec`.

## Примеры

Легаси-варианты примеров с корневыми каталогами и сэмплированием лежат в
подкаталоге `legacy/`, каждый — отдельное рабочее пространство Cargo (Cargo
объединяет флаги для участников, собираемых вместе, поэтому общее рабочее
пространство переключило бы поколение для всех крейтов в нём):

* [`examples/roots/legacy/{server,client}`](https://github.com/RomanEmreis/neva/tree/main/examples/roots/legacy)
* [`examples/sampling/legacy/{server,client}`](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/legacy)
