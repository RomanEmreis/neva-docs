---
sidebar_position: 6
---

# Получение данных

В этом руководстве описывается, как использовать [получение данных (elicitation)](https://modelcontextprotocol.io/specification/draft/client/elicitation) на стороне сервера для запроса дополнительного ввода от пользователя или выполнения внешних действий в процессе работы инструмента.

## Что такое получение данных?

Получение данных позволяет серверному инструменту:
* Запрашивать структурированный ввод от пользователя (формы с валидацией по схеме)
* Просить клиент выполнить внешнее действие (например, открыть URL для оплаты)
* Приостанавливать выполнение до тех пор, пока запрос не будет принят или отклонён

Типичные сценарии применения:
* Сбор контактных данных или параметров конфигурации
* Шаги подтверждения от пользователя
* Платежи или OAuth-перенаправления

Для использования получения данных внедрите [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) в обработчик инструмента и вызовите метод [elicit()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.elicit) с нужными параметрами запроса.

## Модель повторного выполнения

Получение данных — первоклассный
[вид input-запроса MRTR](../spec-2026-07-28.md#multi-round-trip-requests-mrtr).
Из этого следуют два практических правила:

1. **`elicit` принимает стабильный replay-ключ** — `ctx.elicit(key, params)`.
   По этому ключу ответ сопоставляется с местом вызова на следующем раунде.
2. **Обработчик выполняется с самого начала на каждом раунде.** Код выше
   точки `elicit` выполнится повторно, поэтому он должен быть без побочных
   эффектов — либо обёрнут в `ctx.memo` (вычислить один раз), `ctx.once`
   (выполнить один раз) или `ctx.on_commit` (отложить до финального
   результата).

Раунды прогоняет клиент внутри `call_tool`, поэтому вызывающий код видит
один вызов.

:::note Под флагом `legacy-spec`
Получение данных работает как серверный push-запрос, управляемый
возможностями: `ctx.elicit(params)` не принимает ключ, а обработчик
приостанавливается, а не перезапускается. См.
[Легаси-спецификация](../legacy-spec.md).
:::

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

    // "contact" — replay-ключ: по нему ответ клиента сопоставляется
    // с этим местом вызова на следующем раунде.
    ctx.elicit("contact", params.into())
        .await?
        .map(format_contact)
}

fn format_contact(c: Contact) -> String {
    format!("Name: {}, Age: {}, email: {}", c.name, c.age, c.email)
}
```

### Порядок выполнения:
1. Сервер отвечает `input_required`, передавая запрос формы
2. Клиент получает его, формирует и валидирует данные и повторяет вызов
3. Обработчик выполняется с начала; `ctx.elicit("contact", …)` воспроизводит ответ
4. Результат преобразуется в выходные данные инструмента

### Защита побочных эффектов {#guarding-side-effects}

Всё дорогое или заметное снаружи выше точки `elicit` нужно оборачивать в
примитив, потому что этот код выполняется на каждом раунде заново:

```rust
#[tool]
async fn place_order(mut ctx: Context) -> Result<String, Error> {
    // Вычисляется один раз, дальше воспроизводится.
    let quote: u32 = ctx.memo("quote", async { Ok(fetch_quote().await) }).await?;

    let params = ElicitRequestParams::form(format!("Доставка стоит ${quote}. Подтвердить?"))
        .with_schema::<Contact>();
    let contact: Contact = ctx.elicit("contact", params.into()).await?.content()
        .ok_or_else(|| Error::new(ErrorCode::InvalidParams, "отклонено"))?;

    // Выполнится не более одного раза за все раунды.
    ctx.once("charge", async { charge_card().await }).await?;

    // Выполнится ровно один раз, когда обработчик дойдёт до финального результата.
    ctx.on_commit(async { send_receipt().await });

    Ok(format!("Заказ подтверждён для {}", contact.name))
}
```

## Определение URL-запроса

URL-запросы используются, когда пользователь должен выполнить внешнее действие. Для создания [ElicitRequestUrlParams](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestUrlParams.html) используйте метод [ElicitRequestParams::url()](https://docs.rs/neva/latest/neva/types/elicitation/enum.ElicitRequestParams.html#method.url).
```rust
#[tool]
async fn pay_a_bill(mut ctx: Context) -> Result<&'static str, Error> {
    let params = ElicitRequestParams::url(
        "https://www.paypal.com/us/webapps/mpp/paypal-payment",
        "Please pay your bill using PayPal"
    );

    ctx.elicit("payment", params.into()).await?;

    Ok("Payment successful")
}
```

:::warning Уведомлений о завершении больше нет
MCP 2026-07-28 удалил `notifications/elicitation/complete` — **сигналом
завершения является сам ответ на input-запрос**.
`Context::complete_elicitation`, `Client::on_elicitation_completed` и
`ElicitationCompleteParams` больше не существуют.

URL-elicitation также лишился `elicitationId`: без серверного сигнала о
завершении нечего сопоставлять. Сервер, которому нужно отслеживать запрос
между повторами, кладёт собственный идентификатор в `requestState` —
например, через `ctx.memo`.
:::

:::note
* Клиент подтверждает принятие; выполнение инструмента возобновляет ответ
* Полезно для платежей, SSO, внешних подтверждений
:::

## Обучение на примерах
Полный рабочий пример доступен [здесь](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/server/src/main.rs).
