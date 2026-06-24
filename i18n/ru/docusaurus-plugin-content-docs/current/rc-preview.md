---
sidebar_position: 99
---

# Превью MCP 2026-07-28 RC

neva 0.4 приносит **опциональную** поддержку MCP 2026-07-28 Release
Candidate за compile-time флагом `proto-2026-07-28-rc`. Дефолт —
по-прежнему легаси-спека, и остальная документация описывает её.

:::caution Статус RC
Wire-формат и API под флагом `proto-2026-07-28-rc` **не покрываются
semver** и могут поменяться до финала спеки (запланирован на
2026-07-28). Когда RC станет финальным, флаги инвертируются: RC станет
дефолтом, а текущий дефолт переедет под флаг `legacy-spec`.
:::

## Что меняется под флагом

* **Stateless HTTP-транспорт.** Хэндшейк `initialize`/`initialized`
  заменён одним запросом `server/discover`. `Mcp-Session-Id` на
  проводе нет; каждый POST несёт обязательный заголовок
  `MCP-Protocol-Version`. Server-initiated уведомления неактивны —
  клиенты поллят.
* **Multi Round-Trip Requests (MRTR) для elicitation.** Хендлеры
  вызывают `ctx.elicit(key, params).await?`; прогресс живёт в
  AEAD-запечатанном `requestState`, который клиент эхает на ретрае,
  поэтому запрос может попасть на любой инстанс. Побочные эффекты
  оборачивай в `ctx.once` / `ctx.memo` / `ctx.on_commit` — хендлер
  перезапускается на каждом раунде.
* **JSON Schema 2020-12 для тулов.** `Tool.input_schema` /
  `output_schema` хранят `InputSchema` поверх `serde_json::Value`;
  макрос `#[tool]` генерирует полноценные 2020-12 документы.
* **Фреймворк расширений.** Новый трейт `Extension`; **Tasks** —
  первый встроенный потребитель (id `io.modelcontextprotocol/tasks`).
* **Удалено:** `roots/list`, `sampling/createMessage`,
  `logging/setLevel`. Host-side замены: roots — out-of-band; sampling
  — tool от host'а; logging — собственная телеметрия host'а.

## Куда смотреть сейчас

* **[Release notes (v0.4.0)](https://github.com/RomanEmreis/neva/releases/tag/0.4.0)** — нарратив, миграция, деплой.
* **[`examples/mrtr`](https://github.com/RomanEmreis/neva/tree/main/examples/mrtr)** — end-to-end MRTR-сервер и клиент.
* **`cargo doc --features proto-2026-07-28-rc --open`** — сгенерирует
  API-референс RC-поверхности в твоём чекауте.

## Обязательно для multi-instance HTTP-деплоя

Два общих ресурса, оба нужны:

1. `App::with_request_state_secret(<общий секрет>)` — без него
   cross-instance ретраи не расшифруют `requestState`. neva ругается
   `warn`'ом при старте, если забыл.
2. `App::with_request_state_store(<общий стор>)` — без него
   lost-response ретраи перезапустят хендлер и продублируют
   `on_commit`. Дефолтный `InMemoryStateStore` — per-process; для
   прода реализуй `RequestStateStore` поверх Redis или подобного.
