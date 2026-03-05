---
sidebar_position: 10
---

# Прогресс

Для долгосрочных инструментов Neva может отправлять **уведомления о прогрессе** (`notifications/progress`), информируя клиентов о ходе выполнения задачи.

## Включение уведомлений о прогрессе

Уведомления о прогрессе отправляются через [`tracing`](https://docs.rs/tracing). Настройте слой уведомлений с помощью [`notification::fmt::layer()`](https://docs.rs/neva/latest/neva/types/notification/fmt/fn.layer.html):

```rust
use neva::prelude::*;
use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(notification::fmt::layer())
        .init();

    App::new()
        .with_options(|opt| opt
            .with_tasks(|tasks| tasks.with_all())
            .with_default_http())
        .run()
        .await;
}
```

:::tip
[`with_tasks()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_tasks) включает функциональность [Задач](./tasks), необходимую для того, чтобы клиенты могли передавать `progressToken` вместе с вызовом инструмента. Подробнее см. в руководстве [Задачи](./tasks).
:::

## Отчёт о прогрессе из инструмента

Внедрите [`Meta<ProgressToken>`](https://docs.rs/neva/latest/neva/types/struct.Meta.html) в обработчик инструмента для доступа к токену прогресса, предоставленному клиентом. Затем отправляйте события прогресса с помощью макроса `tracing::info!` с целью `target: "progress"`:

```rust
use neva::prelude::*;

#[tool]
async fn long_running_task(token: Meta<ProgressToken>, command: String) {
    tracing::info!("Starting {command}");

    let mut progress = 0;
    loop {
        if progress == 100 {
            break;
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        progress += 5;

        tracing::info!(
            target: "progress",
            token = %token,   // Токен прогресса от клиента
            value = progress, // Текущее значение прогресса
            total = 100       // Итого (необязательно)
        );
    }

    tracing::info!("{command} has been successfully completed!");
}
```

### Обязательные поля tracing

| Поле | Описание |
|------|----------|
| `target: "progress"` | Направляет событие в обработчик уведомлений прогресса MCP |
| `token = %token` | [`ProgressToken`](https://docs.rs/neva/latest/neva/types/enum.ProgressToken.html) из запроса клиента |
| `value = <число>` | Текущее значение прогресса |
| `total = <число>` | *(Необязательно)* Общее количество шагов; помогает клиентам отображать процент |

Если клиент не включил `progressToken` в запрос, `Meta<ProgressToken>` всё равно будет присутствовать, но пустым — события прогресса, отправленные с ним, будут просто отброшены.

## Обучение на примерах

Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/progress) доступен здесь.
