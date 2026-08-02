---
sidebar_position: 9
---

# Логирование

Neva интегрируется с экосистемой [`tracing`](https://docs.rs/tracing) для Rust, обеспечивая структурированные журнальные сообщения. Когда клиент их запрашивает, эти сообщения пересылаются ему в виде **MCP-уведомлений журнала** (`notifications/message`).

## Логирование действует в области запроса

MCP 2026-07-28 удалил рукопожатие `logging/setLevel`. Договариваться о
глобальном уровне логирования больше не нужно — вместо этого **каждый запрос
подписывается сам**, передавая желаемую минимальную серьёзность в
`_meta["io.modelcontextprotocol/logLevel"]`.

Пока сервер обрабатывает этот запрос, он отправляет `notifications/message`
с указанной серьёзностью и выше, а остальные подавляет. **Запрос, не
указавший уровень, не порождает уведомлений журнала вообще.**

Само уведомление `notifications/message` спецификация сохраняет, но помечает
как **устаревшее** — оно существует для миграции. Для эксплуатационных задач
лучше использовать собственный телеметрический конвейер хоста.

:::note Под флагом `legacy-spec`
Возвращается глобальная модель: `logging/setLevel`, а также
`with_logging(handle)` и `set_log_level()`. В сборке по умолчанию этих API
нет. См. [Легаси-спецификация](../legacy-spec.md).
:::

## Настройка

Добавьте слой уведомлений neva в реестр `tracing_subscriber`. Ни ручка
перезагрузки, ни регистрация через `with_logging()` не нужны — слой сам
определяет уровень, запрошенный для каждого события:

```rust
use neva::prelude::*;
use neva::types::notification;
use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(notification::fmt::layer()) // Направляем логи запросившему клиенту
        .init();

    App::new()
        .with_options(|opt| opt.with_default_http())
        .run()
        .await;
}
```

Для **stdio** используйте форматтер
[`NotificationFormatter`](https://docs.rs/neva/latest/neva/types/notification/struct.NotificationFormatter.html)
из neva — любая поддерживаемая конфигурация stdio продолжает работать без
изменений, включая подписчика только с форматтером:

```rust
tracing_subscriber::registry()
    .with(tracing_subscriber::fmt::layer()
        .event_format(notification::NotificationFormatter))
    .init();
```

Если уровень нужно определять из типизированного расширения span, а не самим
форматтером, добавьте рядом слой `notification::fmt::span_context()`.

## Доставка {#delivery}

Уведомления в области запроса идут по **потоку ответа того самого запроса**,
как того требует спецификация:

| Транспорт | Как приходят |
|---|---|
| `stdio` | Перемежаются с обычным выводом в stdout |
| Streamable HTTP | `POST`, подписавшийся на поток, получает ответ `text/event-stream` со своими `notifications/message` и `notifications/progress`, а следом — сам ответ |

Все остальные `POST` остаются одним JSON-объектом — кроме запроса
[`subscriptions/listen`](./subscriptions), который становится потоком по своим
причинам. Логи **не** подписочные: они принадлежат тому запросу, который их
запросил, поэтому поток listen несёт только собственные логи в области своего
запроса и ничьи больше.

Правило подавления — нет `logLevel`, нет `notifications/message` — действует
на любом транспорте.

## Отправка журнальных сообщений из инструментов

Используйте стандартные макросы `tracing` внутри обработчиков:

```rust
#[tool]
async fn my_tool() {
    tracing::info!(logger = "my_tool", "Processing started");
    tracing::warn!(logger = "my_tool", "Something looks off");
    tracing::debug!(logger = "my_tool", "Debug details here");
}
```

Необязательное поле `logger` пересылается клиенту как часть полезной нагрузки уведомления, позволяя клиентам определять источник каждой записи журнала.

### Уровни логирования

Neva сопоставляет уровни серьёзности `tracing` с уровнями журнала MCP следующим образом:

| Уровень tracing | Уровень журнала MCP |
|-----------------|---------------------|
| `ERROR` | `error` |
| `WARN` | `warning` |
| `INFO` | `info` |
| `DEBUG` | `debug` |
| `TRACE` | `debug` |

## Запрос логов со стороны клиента

Клиент neva запрашивает логи через
[`McpOptions::with_log_level`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_log_level),
который проставляет уровень в `_meta` каждого запроса:

```rust
use neva::prelude::*;
use neva::types::notification::LoggingLevel;

#[allow(deprecated)]
let mut client = Client::new()
    .with_options(|opt| opt
        .with_log_level(LoggingLevel::Info)
        .with_default_http());
```

Метод помечен `#[deprecated]` с момента появления — так же, как и сама схема.

## Уведомления о прогрессе через Tracing

Для долгосрочных инструментов Neva также использует `tracing` для отправки **уведомлений о прогрессе** (`notifications/progress`).
Подробнее см. в руководстве [Прогресс](./progress).

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/logging) доступен здесь.
