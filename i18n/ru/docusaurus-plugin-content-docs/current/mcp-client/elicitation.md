---
sidebar_position: 7
---

# Получение данных

В этом руководстве описывается, как клиент обрабатывает запросы на [получение данных (elicitation)](https://modelcontextprotocol.io/specification/draft/client/elicitation), отправляемые MCP-сервером.

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

## Отслеживание завершения получения данных
```rust
client.on_elicitation_completed(async |n| {
    let Some(params) = n.params::<ElicitationCompleteParams>() else {
        println!("Unable to read params");
        return;
    };

    println!("Elicitation {} has been completed.", params.id);
});
```
Это полезно для:
* Обновления пользовательского интерфейса
* Логирования
* Отслеживания внешних процессов (платежи, аутентификация)

## Обучение на примерах
Полный рабочий пример доступен [здесь](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/client/src/main.rs).
