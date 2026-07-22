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
* **Multi Round-Trip Requests (MRTR).** Хендлер может приостановиться
  посреди выполнения, чтобы запросить ввод у клиента: он вызывает
  `ctx.elicit(key, params)`, `ctx.sample(key, params)` или
  `ctx.list_roots(key)` и ждёт ответа. Прогресс живёт в
  AEAD-запечатанном `requestState`, который клиент эхает на ретрае,
  поэтому запрос может попасть на любой инстанс. Побочные эффекты
  оборачивай в `ctx.once` / `ctx.memo` / `ctx.on_commit` — хендлер
  перезапускается с начала на каждом раунде. Как sampling и roots едут
  на том же субстрате — см.
  [Виды input-запросов](#виды-input-запросов-elicitation-sampling-roots)
  ниже.
* **JSON Schema 2020-12 для тулов.** `Tool.input_schema` /
  `output_schema` хранят `InputSchema` поверх `serde_json::Value`;
  макрос `#[tool]` генерирует полноценные 2020-12 документы.
* **Фреймворк расширений.** Новый трейт `Extension`; **Tasks** —
  первый встроенный потребитель (id `io.modelcontextprotocol/tasks`).
* **Серверный логгинг вырезан на этапе компиляции.** RC-сборка neva
  убирает и `logging/setLevel`, и серверный путь отправки
  `notifications/message` (они под `#[cfg(not(proto-2026-07-28-rc))]`) —
  вместо них используй собственную телеметрию host'а. Обрати внимание:
  сама спека уже: черновик 2026-07-28 *удаляет* только `logging/setLevel`,
  а `notifications/message` сохраняет как request-scoped, **deprecated**
  уведомление, гейтящееся на `_meta["io.modelcontextprotocol/logLevel"]`.
  Этот request-scoped путь neva пока не реализует.

## Виды input-запросов: elicitation, sampling, roots

Спека 2026-07-28 не удалила sampling и roots — она убрала их как
**capability-driven server→client запросы** и перенесла эту способность
на MRTR как **виды input-запросов**, рядом с elicitation. На проводе
input-запрос — это по-прежнему конверт `{ method, params }`, где `method`
— дискриминатор (`elicitation/create`, `sampling/createMessage`,
`roots/list`).

* **Elicitation** — first-class.
* **Sampling** и **roots** возвращаются под RC-флагом, но — в соответствии
  с 12-месячным жизненным циклом самой спеки — **уже помечены
  deprecated**. API несут `#[deprecated]` и существуют ради миграции;
  местам вызова нужен `#[allow(deprecated)]`.

Механика идентична для всех видов, поэтому `once` / `memo` / `on_commit`
покрывают их бесплатно:

* **Сервер** — `ctx.sample(key, params)` одалживает модель клиента, а
  `ctx.list_roots(key)` читает его roots; оба реплеятся из
  зашифрованного `requestState` на следующем раунде — ровно как
  `ctx.elicit`.
* **Клиент** — sampling исполняется хендлером `map_sampling` клиента, а
  roots берутся из его сконфигурированного списка, и то и другое внутри
  round-trip-петли клиента (вызывающий `call_tool` видит один вызов).
  Легаси server-push канал `SamplingHandler` по-прежнему удалён; макрос
  `#[sampling]` относится к той push-модели и **недоступен** под
  RC-флагом — регистрируй хендлер через `map_sampling`.
* **Capabilities** — `ClientMrtrCapabilities` несёт флаги `elicitation`,
  `sampling` и `roots`. Непустой список roots или зарегистрированный
  хендлер `map_sampling` заставляют клиента объявить соответствующий
  флаг; сервер гейтит каждый вид по его флагу и вместо зависания
  round-trip'а сообщает о запросе незаявленного вида. Флаги аддитивны,
  так что пир, отправляющий только `elicitation`, всё равно
  десериализуется.

:::note Форма API (breaking внутри RC-поверхности)
Обобщённый input-запрос заменил `mrtr::ElicitationInputRequest` на
union `mrtr::InputRequest`
(`InputRequest::Elicitation(params)` / `Sampling` / `Roots`), а
`mrtr::InputResponses` теперь — `HashMap<String, serde_json::Value>`:
тип результата зависит от запрошенного вида, так что десериализуй свой
тип из значения. Wire-формат не изменился; переехал только (не-semver)
Rust API под RC.
:::

## Куда смотреть сейчас

* **[Release notes (v0.4.0)](https://github.com/RomanEmreis/neva/releases/tag/0.4.0)** — нарратив, миграция, деплой.
* **[`examples/mrtr`](https://github.com/RomanEmreis/neva/tree/main/examples/mrtr)** — end-to-end MRTR-сервер и клиент.
* **[`examples/sampling/rc`](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/rc)** / **[`examples/roots/rc`](https://github.com/RomanEmreis/neva/tree/main/examples/roots/rc)** — виды sampling и roots на MRTR-субстрате. Каждая директория `rc/` — свой Cargo-воркспейс, чтобы RC-флаг не включался для легаси-крейтов.
* **`cargo doc --features proto-2026-07-28-rc --open`** — сгенерирует
  API-референс RC-поверхности в твоём чекауте.

## Обязательно для multi-instance HTTP-деплоя

Два общих ресурса, оба нужны:

1. `App::with_request_state_secret(<общий секрет>)` — без него
   cross-instance ретраи не расшифруют `requestState`. neva ругается
   `warn`'ом при старте, если забыл. neva **запечатывает** `requestState`
   через ChaCha20-Poly1305, а не просто подписывает: AEAD-тег
   аутентифицирует блоб ровно как HMAC, но подписанный state всё ещё был
   бы *читаемым*, а `ctx.memo` пишет туда server-computed значения (ответ
   вышестоящего API, зафиксированную цену, downstream-токен), чтобы
   следующий раунд их реплеил. Конфиденциальность тут ничего не стоит,
   поэтому секрет обеспечивает именно её, а не только целостность —
   относись к нему как к секрету и ротируй через
   `App::with_request_state_keys`.
2. `App::with_request_state_store(<общий стор>)` — без него
   lost-response ретраи перезапустят хендлер и продублируют
   `on_commit`. Дефолтный `InMemoryStateStore` — per-process; для
   прода реализуй `RequestStateStore` поверх Redis или подобного.
