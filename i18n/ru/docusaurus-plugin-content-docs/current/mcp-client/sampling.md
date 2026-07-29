---
sidebar_position: 6
---

# Сэмплирование

:::warning Устарело с момента появления
MCP 2026-07-28 убрал сэмплирование как *push*-запрос, управляемый
возможностями. Теперь клиент обрабатывает
[input-запросы](../spec-2026-07-28.md#виды-input-запросов-elicitation-sampling-roots)
`sampling/createMessage` внутри собственного цикла раундов MRTR, поэтому
вызывающий `call_tool` по-прежнему видит один вызов.

Весь этот вид устарел с момента появления: `Client::map_sampling` помечен
`#[deprecated]` и требует `#[allow(deprecated)]`. Кроме того, **атрибутный
макрос `#[sampling]` недоступен в сборке по умолчанию** — он относится к
легаси-модели с серверным push. Регистрируйте обработчик явным вызовом
`map_sampling`.
:::


В MCP именно **клиент** отвечает за выполнение запросов на сэмплирование LLM, инициируемых серверами.
В отличие от традиционных архитектур, клиент:
* Владеет доступом к модели и ключами API
* Применяет локальные политики (стоимость, конфиденциальность, ограничения скорости)
* Является посредником во всём взаимодействии с языковыми моделями

Серверы никогда не общаются с LLM напрямую — они только **запрашивают сэмплирование**.

> **Важная концептуальная модель**
>
> * Сервер **запрашивает** сэмплирование
> * Клиент **выполняет** сэмплирование
> * Клиент принимает решение:
>   * какую модель использовать
>   * поддерживаются ли инструменты
>   * как обрабатываются запросы
> * Клиент возвращает структурированные результаты серверу

## Конфигурация клиента

Поддержка сэмплирования должна быть явно включена на клиенте:
```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_sampling(|s| s.with_tools()));
```
* [with_sampling()](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_sampling) включает поддержку сэмплирования
* [with_tools()](https://docs.rs/neva/latest/neva/types/struct.SamplingCapability.html#method.with_tools) разрешает вызовы инструментов в процессе сэмплирования

Именно регистрация обработчика заставляет клиента объявлять
`clientCapabilities.sampling` в каждом запросе; сервер может запросить только
тот вид, который клиент объявил, а запрос к необъявившему клиенту приводит к
ошибке, а не к подвисанию раунда.

## Обработчик сэмплирования

Зарегистрируйте обработчик через
[`Client::map_sampling`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.map_sampling).
Он получает [CreateMessageRequestParams](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html) и возвращает
[CreateMessageResult](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html).

```rust
use neva::prelude::*;
use neva::types::sampling::{CreateMessageRequestParams, CreateMessageResult};

async fn complete(params: CreateMessageRequestParams) -> CreateMessageResult {
    // Здесь логика сэмплирования на стороне клиента
    CreateMessageResult::assistant()
        .with_model("o3-mini")
        .with_content("...")
        .end_turn()
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_default_http());

    // Устарело с момента появления, как и весь вид sampling.
    #[allow(deprecated)]
    client.map_sampling(complete);

    client.connect().await?;

    // Раунды MRTR происходят внутри этого единственного вызова.
    let result = client.call_tool("summarize_report", [("topic", "EMEA")]).await?;

    client.disconnect().await
}
```

Обработчик вызывается один раз на каждый раунд, в котором сервер вызывает [Context::sample()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.sample).

:::note Под флагом `legacy-spec`
Сэмплирование работает как серверный push-запрос, а атрибутный макрос
[`#[sampling]`](https://docs.rs/neva/latest/neva/attr.sampling.html)
регистрирует обработчик за вас. См.
[Легаси-спецификация](../legacy-spec.md).
:::

## Анализ запросов на сэмплирование

Входящий [CreateMessageRequestParams](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageRequestParams.html) содержит:
* Сообщения запроса
* Системный запрос
* Предпочтения модели
* Метаданные инструментов
* Предыдущие результаты инструментов (для многошагового сэмплирования)

### Доступ к текстовым запросам
```rust
let prompts: Vec<&TextContent> = params.text().collect();
```
Включает все накопленные текстовые сообщения пользователя и ассистента.

### Определение запросов на использование инструментов
Клиент может проверить, разрешает ли или ожидает ли сервер использование инструментов через
`tool_choice`:
```rust
if params.tool_choice.is_some_and(|c| !c.is_none()) {
    // Модели разрешено или требуется вызвать инструменты
}
```
Это позволяет клиенту решить, производить ли вызовы инструментов или конечный текст.

## Использование инструментов

Если инструменты включены, клиент может ответить запросом на вызов инструмента вместо
обычного текста.

```rust
CreateMessageResult::assistant()
    .with_model("gpt-5")
    .use_tools([
        ("get_weather", ("city", "London"))
    ])
```
:::note
* Выполнение инструментов всегда осуществляется сервером
* Клиент только возвращает намерение вызвать инструменты
* Аргументы инструментов должны соответствовать схеме инструмента
:::

## Обработка результатов инструментов

После выполнения инструментов сервером он отправит повторный запрос на сэмплирование,
содержащий результаты инструментов.

Эти результаты доступны через:
```rust
let results: Vec<&ToolResult> = params.results().collect();
```

На этом этапе клиент обычно должен:
* Интерпретировать выходные данные инструментов
* Сформировать финальный ответ ассистента
* Завершить шаг сэмплирования

## Формирование финальных ответов

Для возврата обычного сообщения ассистента и завершения цикла сэмплирования:
```rust
CreateMessageResult::assistant()
    .with_model("gpt-5")
    .with_content("Final response text")
    .end_turn()
```
Вызов [end_turn()](https://docs.rs/neva/latest/neva/types/sampling/struct.CreateMessageResult.html#method.end_turn) сигнализирует серверу о завершении сэмплирования.

## Когда настраивать сэмплирование клиента

Рассмотрите пользовательскую логику сэмплирования, когда:
* Нужно интегрировать проприетарные или локальные модели
* Требуется точный контроль стоимости или задержки
* Нужна фильтрация или аудит запросов
* Требуются детерминированные или политически-управляемые ответы

## Обучение на примерах
Полный рабочий пример доступен [здесь](https://github.com/RomanEmreis/neva/blob/main/examples/sampling/client/src/main.rs).
