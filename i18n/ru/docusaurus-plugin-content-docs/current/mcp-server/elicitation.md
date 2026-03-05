---
sidebar_position: 6
---

# Получение данных

В этом руководстве описывается, как использовать [получение данных (elicitation)](https://modelcontextprotocol.io/specification/draft/client/elicitation) на стороне сервера для запроса дополнительного ввода от пользователя или выполнения внешних действий в процессе работы инструмента.

## Что такое получение данных?

Получение данных позволяет серверному инструменту:
* Запрашивать структурированный ввод от пользователя (формы с валидацией по схеме)
* Просить клиент выполнить внешнее действие (например, открыть URL для оплаты)
* Приостанавливать выполнение до тех пор, пока запрос не будет принят, отклонён или выполнен

Типичные сценарии применения:
* Сбор контактных данных или параметров конфигурации
* Шаги подтверждения от пользователя
* Платежи или OAuth-перенаправления

Для использования получения данных внедрите [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) в обработчик инструмента и вызовите метод [elicit()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.elicit) с нужными параметрами запроса.

## Определение формы для получения данных

Формы используют JSON-схему для определения и валидации структурированного ввода.
```rust
#[json_schema(de)]
struct Contact {
    name: String,
    email: String,
    age: u32,
}
```
С помощью атрибутного макроса [#[json_schema]](https://docs.rs/neva/latest/neva/attr.json_schema.html) можно управлять сериализацией/десериализацией через [serde](https://serde.rs/):
* `all` — добавляет `derive(serde::Serialize, serde::Deserialize)`.
* `serde` — добавляет `derive(serde::Serialize, serde::Deserialize)`.
* `ser` — добавляет `derive(serde::Serialize)`.
* `de` — добавляет `derive(serde::Deserialize)`.

### Создание и отправка запроса формы
Для создания параметров запроса формы используйте метод [ElicitRequestParams::form()](https://docs.rs/neva/latest/neva/types/elicitation/enum.ElicitRequestParams.html#method.form) с последующим вызовом [with_contract()](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestFormParams.html#method.with_schema), который задаёт ожидаемую JSON-схему.
```rust
#[tool]
async fn generate_business_card(mut ctx: Context) -> Result<String, Error> {
    let params = ElicitRequestParams::form(
        "Please provide your contact information"
    )
    .with_schema::<Contact>();

    ctx.elicit(params.into())
        .await?
        .map(format_contact)
}

fn format_contact(c: Contact) -> String {
    format!("Name: {}, Age: {}, email: {}", c.name, c.age, c.email)
}
```

### Порядок выполнения:
1. Сервер отправляет запрос формы
2. Клиент получает данные и проводит их валидацию
3. Инструмент возобновляет выполнение с валидированными данными
4. Результат преобразуется в выходные данные инструмента

## Определение URL-запроса

URL-запросы используются, когда пользователь должен выполнить внешнее действие. Для создания [ElicitRequestUrlParams](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestUrlParams.html) используйте метод [ElicitRequestParams::url()](https://docs.rs/neva/latest/neva/types/elicitation/enum.ElicitRequestParams.html#method.url).
```rust
#[tool]
async fn pay_a_bill(mut ctx: Context) -> Result<&'static str, Error> {
    let params = ElicitRequestParams::url(
        "https://www.paypal.com/us/webapps/mpp/paypal-payment",
        "Please pay your bill using PayPal"
    );

    let elicitation_id = params.id.clone();

    ctx.elicit(params.into()).await?;

    // Отправляем `notifications/elicitation/complete`
    ctx.complete_elicitation(elicitation_id).await?;

    Ok("Payment successful")
}
```

После завершения внеполосного взаимодействия можно отправить уведомление `notifications/elicitation/complete`. Это позволяет клиентам программно реагировать при необходимости.

:::note
* Сервер контролирует момент завершения запроса
* Клиент только подтверждает принятие
* Полезно для платежей, SSO, внешних подтверждений
:::

## Обучение на примерах
Полный рабочий пример доступен [здесь](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/server/src/main.rs).
