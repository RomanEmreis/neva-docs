---
sidebar_position: 7
---

# Получение данных

В этом руководстве описывается, как клиент обрабатывает запросы на [получение данных (elicitation)](https://modelcontextprotocol.io/specification/draft/client/elicitation), отправляемые MCP-сервером.

## Раунды прогоняет клиент

В [MCP 2026-07-28](../spec-2026-07-28.md#multi-round-trip-requests-mrtr)
получение данных — это не push-запрос, приходящий клиенту вне общего потока.
Сервер отвечает на вызов инструмента статусом `input_required`; обработчик
клиента формирует ответ и **повторяет вызов**, возвращая запечатанный
`requestState`.

Этот цикл neva выполняет за вас, внутри `call_tool`:

* ваш обработчик вызывается один раз на каждый раунд `input_required`;
* `Client::call_tool` возвращает только финальный результат — вызывающий код
  видит один вызов;
* именно регистрация обработчика заставляет клиента объявить
  `clientCapabilities.elicitation`, а сервер может запросить только тот вид,
  который клиент объявил;
* число повторов на слот ограничивается через
  [`McpOptions::with_max_mrtr_rounds`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html).

## Включение поддержки получения данных
```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_elicitation(|e| e
            .with_form()
            .with_url()));
```
Это включает:
* Получение данных через формы
* Получение данных через URL

## Обработка запросов на получение данных

Определите обработчик получения данных с помощью атрибутного макроса [#[elicitation]](https://docs.rs/neva/latest/neva/attr.elicitation.html).
```rust
#[json_schema(ser)]
struct Contact {
    name: String,
    email: String,
    age: u32,
}

#[elicitation]
async fn elicitation_handler(params: ElicitRequestParams) -> ElicitResult {
    match params {
        ElicitRequestParams::Url(url) => {
            // Переходим по URL для выполнения внешнего действия.

            ElicitResult::accept()
        }
        ElicitRequestParams::Form(form) => {
            // Показываем форму пользователю для заполнения данных

            let contact = Contact {
                name: "John".to_string(),
                email: "john@email.com".to_string(),
                age: 30,
            };

            elicitation::Validator::new(form)
                .validate(contact)
                .into()
        }
    }
}
```

### Что здесь происходит?

* Получение данных через URL
  * Клиент принимает и выполняет действие внешним образом
* Получение данных через форму
  * Клиент формирует данные
  * Данные проходят валидацию по серверной схеме
  * Валидированные данные возвращаются как [ElicitResult](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitResult.html)

:::info
Если пропустить [with_elicitation()](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_elicitation), [with_form()](https://docs.rs/neva/latest/neva/types/struct.ElicitationCapability.html#method.with_form) или [with_url()](https://docs.rs/neva/latest/neva/types/struct.ElicitationCapability.html#method.with_url), но объявить обработчик получения данных, это по умолчанию включит получение данных через форму.
:::

## Завершение получения данных

:::warning Удалено в MCP 2026-07-28
Уведомления `notifications/elicitation/complete` больше нет — **сигналом
завершения является сам ответ на input-запрос**, поэтому
`Client::on_elicitation_completed` и `ElicitationCompleteParams` не
существуют. URL-elicitation также лишился `elicitationId`: без серверного
сигнала о завершении нечего сопоставлять.

Если вы использовали это уведомление для обновления интерфейса или аудита,
привязывайтесь к самому обработчику — он выполняется ровно в момент, когда
клиент отвечает.

Под флагом [`legacy-spec`](../legacy-spec.md) эти API возвращаются.
:::

## Обучение на примерах
Полный рабочий пример доступен [здесь](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/client/src/main.rs).
