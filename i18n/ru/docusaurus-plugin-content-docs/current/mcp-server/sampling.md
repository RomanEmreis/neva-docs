---
sidebar_position: 5
---

# Сэмплирование

Model Context Protocol (MCP) предоставляет стандартизированный способ для серверов запрашивать у клиентов [сэмплирование LLM](https://modelcontextprotocol.io/specification/draft/client/sampling) («завершения» или «генерации»). Такая схема позволяет клиентам сохранять контроль над доступом к моделям, их выбором и разрешениями, одновременно давая серверам возможность использовать возможности ИИ — без необходимости хранить ключи API на стороне сервера. Серверы могут запрашивать текстовые, аудио и графические взаимодействия, а также опционально включать контекст из MCP-серверов в свои запросы.

> **Важная концептуальная модель**
>
> * Сервер **запрашивает** сэмплирование
> * Клиент **принимает решение**:
>   * какую модель использовать
>   * разрешено ли сэмплирование
>   * как выполнять инструменты
> * Сервер **никогда** не владеет ключами API и **никогда** не обращается к LLM напрямую

## Базовое использование

Для использования сэмплирования внедрите [`Context`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) в обработчик инструмента и вызовите метод [`sample()`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.sample) с запросом.
```rust
use neva::prelude::*;

#[tool]
async fn generate_weather_report(mut ctx: Context, city: String) -> Result<String, Error> {
    let params = CreateMessageRequestParams::new()
        .with_message(format!("What's the weather in {city}?"))
        .with_sys_prompt("You are a helpful assistant.");

    let result = ctx.sample(params).await?;

    Ok(format!("{:?}", result.content))
}
```

:::tip
Если в вашем MCP-сервере уже объявлен подходящий шаблон промпта, можно использовать метод [prompt()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.prompt) объекта `Context` вместо передачи форматированной строки.
:::

### Настройка запроса на создание сообщения

Структура [CreateMessageRequestParams](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html) предоставляет методы для настройки:
* Температуры
* Системного запроса
* Лимитов токенов
* Предпочтений модели
```rust
use neva::prelude::*;

let model_pref = ModelPreferences::new()
    .with_hints(["claude-4.5-sonnet", "gpt-5"])
    .with_cost_priority(0.3)
    .with_speed_priority(0.8)
    .with_intel_priority(0.5);

let params = CreateMessageRequestParams::new()
    .with_message(format!("What's the weather in {city}?"))
    .with_sys_prompt("You are a helpful assistant.")
    .with_max_tokens(1000)
    .with_temp(0.2)
    .with_pref(model_pref);
```
Предпочтения модели являются **подсказками**, а не гарантиями.

Клиент может:
* Проигнорировать их
* Сопоставить с другой моделью
* Применить дополнительные политики

## Использование инструментов

Если клиент поддерживает возможность `sampling.tools`, сервер может передать список инструментов для использования LLM в процессе сэмплирования. Для этого служит метод [with_tools()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html#method.with_tools):

Инструменты всегда выполняются **сервером**, а не клиентом или моделью.
```rust
use neva::prelude::*;

let Some(tool) = ctx.find_tool("get_weather").await else {
    return Err(ErrorCode::MethodNotFound.into());
};

let params = CreateMessageRequestParams::new()
    .with_message(format!("What's the weather in {city}?"))
    .with_sys_prompt("You are a helpful assistant.")
    .with_tools([tool]);
```

У `Context` также есть методы [tools()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.tools), [find_tool()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.find_tool) и [find_tools()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.find_tools), которые могут быть полезны для получения метаданных инструментов для клиента.

### Настройка выбора инструмента

По умолчанию метод [with_tools()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html#method.with_tools) устанавливает `toolChoice` для LLM как `auto`. Это значение можно изменить с помощью метода [with_tool_choice()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html#method.with_tool_choice).
```rust
use neva::prelude::*;

let Some(tool) = ctx.find_tool("get_weather").await else {
    return Err(ErrorCode::MethodNotFound.into());
};

let params = CreateMessageRequestParams::new()
    .with_message(format!("What's the weather in {city}?"))
    .with_sys_prompt("You are a helpful assistant.")
    .with_tools([tool])
    .with_tool_choice(ToolChoiceMode::Required);
```

Значения [ToolChoiceMode](https://docs.rs/neva/latest/neva/types/sampling/enum.ToolChoiceMode.html):
* `Auto` — модель сама решает, вызывать ли инструменты (по умолчанию).
* `Required` — модель обязана вызвать хотя бы один инструмент.
* `None` — модель не должна вызывать инструменты.

## Цикл сэмплирования

Ниже приведена эталонная реализация цикла сэмплирования с выполнением инструментов.
Большинство реальных MCP-серверов следуют этому паттерну.

Метод `sample()` возвращает [CreateMessageResult](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html). Необходимо проверять поле [stop_reason](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html#structfield.stop_reason) и продолжать сэмплирование до достижения конечного состояния.
```rust
use neva::prelude::*;

#[tool]
async fn generate_weather_report(mut ctx: Context, city: String) -> Result<String, Error> {
    let Some(tool) = ctx.find_tool("get_weather").await else {
        return Err(ErrorCode::MethodNotFound.into());
    };

    let mut params = CreateMessageRequestParams::new()
        .with_message(format!("What's the weather in {city}?"))
        .with_sys_prompt("You are a helpful assistant.")
        .with_tools([tool]);

    loop {
        let result = ctx.sample(params.clone()).await?;

        if result.stop_reason == Some(StopReason::ToolUse) {
            // Получаем запросы на вызов инструментов из ответа сэмплирования
            let tools: Vec<ToolUse> = result.tools()
                .cloned()
                .collect();

            // Записываем их как сообщения ассистента в «контекст»
            let assistant_msg = tools
                .iter()
                .fold(SamplingMessage::assistant(), |msg, tool| msg.with(tool.clone()));

            // Вызываем инструменты, запрошенные LLM
            let tool_results = ctx.use_tools(tools).await;

            // Записываем результаты инструментов как сообщения пользователя
            let user_msg = tool_results
                .into_iter()
                .fold(SamplingMessage::user(), |msg, result| msg.with(result));

            // Формируем параметры для следующего шага с предыдущим контекстом и результатами инструментов
            params = params
                .with_message(assistant_msg)
                .with_message(user_msg)
                .with_tool_choice(ToolChoiceMode::None);
        } else {
            // Останавливаемся при получении причины, отличной от вызова инструмента
            return Ok(format!("{:?}", result.content));
        };
    }
}
```

:::note
Каждый шаг сэмплирования **должен** включать:
* Сообщения ассистента с вызовами инструментов
* Сообщения пользователя с результатами инструментов

Это соответствует обучающим данным LLM и позволяет клиенту восстановить полный контекст.
:::

:::warning
В продакшен-коде **всегда** следует:
* Ограничивать количество итераций сэмплирования
* Обрабатывать неожиданные причины остановки
:::

## Когда не использовать сэмплирование

Избегайте сэмплирования, если:
- Задача детерминирована
- Рассуждение на естественном языке не требуется
- Достаточно обычного вызова инструмента или функции

## Обучение на примерах
Полный рабочий пример доступен [здесь](https://github.com/RomanEmreis/neva/blob/main/examples/sampling/server/src/main.rs).
