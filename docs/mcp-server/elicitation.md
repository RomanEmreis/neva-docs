---
sidebar_position: 6
---

# Elicitation

This guide explains how to use [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation) on the server side to request additional user input or external actions during tool execution.

## What is Elicitation?

Elicitation allows a server tool to:
* Request structured user input (forms with schema validation)
* Ask the client to perform an external action (e.g. open a payment URL)
* Pause execution until the elicitation is accepted or rejected

Typical use cases:
* Collecting contact or configuration data
* User confirmation steps
* Payments or OAuth-style redirects

To use elicitation, inject [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) into your tool handler and call the [elicit()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.elicit) method with either form or URL elicit request params.

## The Re-Run Model

Elicitation is the first-class
[MRTR input-request kind](../spec-2026-07-28.md#multi-round-trip-requests-mrtr).
Two consequences shape every handler that elicits:

1. **`elicit` takes a stable replay key** — `ctx.elicit(key, params)`. The
   key is how the answer is matched back to this call site on the next
   round.
2. **The handler re-runs from the top on every round.** Code above an elicit
   point executes again, so it must be side-effect-free — or wrapped in
   `ctx.memo` (compute once), `ctx.once` (run once), or `ctx.on_commit`
   (defer to the final result).

The client drives the rounds inside `call_tool`, so its caller still sees a
single call.

:::note Under `legacy-spec`
Elicitation is a capability-driven server→client push request instead:
`ctx.elicit(params)` takes no key, and the handler suspends rather than
re-running. See [Legacy spec](../legacy-spec.md).
:::

## Ask Only for What the Caller Can Answer

Under MCP 2026-07-28 capabilities are declared **per request**, in the
call's `_meta`. [`Context::client_capabilities()`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.client_capabilities)
reports what the caller of *this* call declared, so a handler that can do
without an input can look before it asks:

```rust compile
use neva::{Context, error::Error, types::elicitation::ElicitRequestParams, tool};

#[tool]
async fn greet(mut ctx: Context) -> Result<String, Error> {
    if ctx.client_capabilities().elicitation.is_none() {
        return Ok("Hello, stranger!".to_string());
    }
    let params = ElicitRequestParams::form("Your name?")
        .with_required("name", "string")
        .into();
    let res = ctx.elicit("name", params).await?;
    Ok(format!("{:?}", res.content))
}
```

This is worth doing because asking anyway is not a degraded experience — it
**ends the call** with `MissingRequiredClientCapability` (`-32021`).

### Elicitation is reported down to the mode

`elicitation` is not a flag but an
[`ElicitationModes`](https://docs.rs/neva/latest/neva/types/mrtr/struct.ElicitationModes.html):
the spec spells `form` and `url` as sub-capabilities inside the
`elicitation` object, and a client that can render a form may well be unable
to open a URL.

* A client that **named modes** is stating a list of what it can do — a mode
  missing from it is one it cannot answer.
* A client that declared `elicitation` but **named no mode** (`{}`) has
  ruled nothing out; `unconstrained()` is `true` and every mode is allowed.

`allows(&params)` answers the whole question — "can this caller be sent
*these* params" — for either shape:

```rust compile-fragment
use neva::prelude::*;
use neva::types::elicitation::ElicitRequestParams;

let params: ElicitRequestParams = ElicitRequestParams::url(
    "https://example.com/pay",
    "Please pay your bill"
).into();

match ctx.client_capabilities().elicitation {
    Some(modes) if modes.allows(&params) => { ctx.elicit("payment", params).await?; }
    // Declared elicitation, but not this mode — take the other path.
    _ => return Ok("Send an invoice instead".into()),
}
```

## Defining a Form Elicitation

Forms use a JSON schema to define and validate structured input.
```rust
#[json_schema(de)]
struct Contact {
    name: String,
    email: String,
    age: u32,
}
```
With [#[json_schema]](https://docs.rs/neva/latest/neva/attr.json_schema.html) attribute macro you can control the serialization/deserialization performed by [serde](https://serde.rs/) for your struct:
* `all` - Applies also `derive(serde::Serialize, serde::Deserialize)`.
* `serde` - Applies also `derive(serde::Serialize, serde::Deserialize)`.
* `ser` - Applies also `derive(serde::Serialize)`.
* `de` - Applies also `derive(serde::Deserialize)`.

### Creating and Sending a Form Request
To create elicit request form params you need to use the [ElicitRequestParams::form()](https://docs.rs/neva/latest/neva/types/elicitation/enum.ElicitRequestParams.html#method.form) method with the following [with_contract()](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestFormParams.html#method.with_schema) that specifies the expected JSON schema.
```rust
#[tool]
async fn generate_business_card(mut ctx: Context) -> Result<String, Error> {
    let params = ElicitRequestParams::form(
        "Please provide your contact information"
    )
    .with_schema::<Contact>();

    // "contact" is the replay key: it matches the client's answer
    // back to this call site on the next round.
    ctx.elicit("contact", params.into())
        .await?
        .map(format_contact)
}

fn format_contact(c: Contact) -> String {
    format!("Name: {}, Age: {}, email: {}", c.name, c.age, c.email)
}
```

### Execution flow:
1. Server replies `input_required`, carrying the form elicitation request
2. Client receives it, produces and validates the data, and retries the call
3. The handler re-runs from the top; `ctx.elicit("contact", …)` replays the answer
4. The result is mapped to the tool output

### Guarding side effects

Anything expensive or externally visible above an elicit point needs a
primitive, because that code runs again on every round:

```rust
#[tool]
async fn place_order(mut ctx: Context) -> Result<String, Error> {
    // Computed once, replayed on later rounds.
    let quote: u32 = ctx.memo("quote", async { Ok(fetch_quote().await) }).await?;

    let params = ElicitRequestParams::form(format!("Shipping is ${quote}. Confirm?"))
        .with_schema::<Contact>();
    let contact: Contact = ctx.elicit("contact", params.into()).await?.content()
        .ok_or_else(|| Error::new(ErrorCode::InvalidParams, "declined"))?;

    // Runs at most once across all rounds.
    ctx.once("charge", async { charge_card().await }).await?;

    // Runs exactly once, when the handler reaches its final result.
    ctx.on_commit(async { send_receipt().await });

    Ok(format!("Order confirmed for {}", contact.name))
}
```

## Defining a URL Elicitation

URL elicitations are used when the user must perform an external action. You can create the [ElicitRequestUrlParams](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestUrlParams.html) by leveraging the [ElicitRequestParams::url()](https://docs.rs/neva/latest/neva/types/elicitation/enum.ElicitRequestParams.html#method.url) method.
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

:::warning Completion notifications are gone
MCP 2026-07-28 removed `notifications/elicitation/complete` — **answering
the input request is the completion signal**. `Context::complete_elicitation`,
`Client::on_elicitation_completed`, and `ElicitationCompleteParams` no longer
exist.

URL elicitation also lost its `elicitationId`: with no server-initiated
completion signal there is nothing to correlate. A server that needs to
track an elicitation across retries encodes its own identifier in
`requestState` — for example via `ctx.memo`.
:::

:::note
* The client confirms acceptance; the answer is what resumes the tool
* Useful for payments, SSO, external confirmations
:::

## Learn By Example
A complete working example is available [here](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/server/src/main.rs).
