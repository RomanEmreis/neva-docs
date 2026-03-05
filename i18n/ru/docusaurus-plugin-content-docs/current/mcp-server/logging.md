---
sidebar_position: 8
---

# Логирование

Neva интегрируется с экосистемой [`tracing`](https://docs.rs/tracing) для Rust, обеспечивая структурированные журнальные сообщения. При правильной настройке эти сообщения автоматически пересылаются подключённым клиентам в виде **MCP-уведомлений журнала** (`notifications/message`).

## Настройка

Для включения MCP-уведомлений журнала настройте `tracing_subscriber` с форматтером Neva [`NotificationFormatter`](https://docs.rs/neva/latest/neva/types/notification/struct.NotificationFormatter.html) и зарегистрируйте дескриптор с помощью [`with_logging()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_logging):

```rust
use neva::prelude::*;
use tracing_subscriber::{filter, reload, prelude::*};

#[tokio::main]
async fn main() {
    // Создаём перезагружаемый фильтр логов с начальным уровнем
    let (filter, handle) = reload::Layer::new(filter::LevelFilter::DEBUG);

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer()
            .event_format(notification::NotificationFormatter)) // Направляем логи MCP-клиентам
        .init();

    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_logging(handle)) // Регистрируем дескриптор перезагрузки
        .run()
        .await;
}
```

`reload::Layer` позволяет MCP-серверу динамически изменять уровень логирования во время выполнения — по запросу MCP-клиентов через метод `logging/setLevel`.

## Отправка журнальных сообщений из инструментов

После настройки логирования используйте стандартные макросы `tracing` внутри обработчиков для отправки журнальных сообщений:

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

## Уведомления о прогрессе через Tracing

Для долгосрочных инструментов Neva также использует `tracing` для отправки **уведомлений о прогрессе** (`notifications/progress`).
Подробнее см. в руководстве [Прогресс](./progress).

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/logging) доступен здесь.
