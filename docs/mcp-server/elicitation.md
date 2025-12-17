---
sidebar_position: 6
---

# Elicitation

This guide explains how to use [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation) on the server side to request additional user input or external actions during tool execution.

## What is Elicitation?

Elicitation allows a server tool to:
* Request structured user input (forms with schema validation)
* Ask the client to perform an external action (e.g. open a payment URL)
* Pause execution until the elicitation is accepted, rejected, or completed

Typical use cases:
* Collecting contact or configuration data
* User confirmation steps
* Payments or OAuth-style redirects

To use elicitation, inject [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) into your tool handler and call the [elicit()](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.elicit) method with either form of URL elicit request params.

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

    ctx.elicit(params.into())
        .await?
        .map(format_contact)
}

fn format_contact(c: Contact) -> String {
    format!("Name: {}, Age: {}, email: {}", c.name, c.age, c.email)
}
```

### Execution flow:
1. Server sends a form elicitation request
2. Client receives and validates the data
3. Tool resumes with the validated payload
4. The result is mapped to the tool output

## Defining a URL Elicitation

URL elicitations are used when the user must perform an external action. You can create the [ElicitRequestUrlParams](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitRequestUrlParams.html) by leveraging the [ElicitRequestParams::url()](https://docs.rs/neva/latest/neva/types/elicitation/enum.ElicitRequestParams.html#method.url) method.
```rust
#[tool]
async fn pay_a_bill(mut ctx: Context) -> Result<&'static str, Error> {
    let params = ElicitRequestParams::url(
        "https://www.paypal.com/us/webapps/mpp/paypal-payment",
        "Please pay your bill using PayPal"
    );

    let elicitation_id = params.id.clone();

    ctx.elicit(params.into()).await?;

    // Send the `notifications/elicitation/complete`
    ctx.complete_elicitation(elicitation_id).await?;

    Ok("Payment successful")
}
```

You may also send a `notifications/elicitation/complete` notification when an out-of-band interaction is completed. This allows clients to react programmatically if appropriate.

:::note
* The server controls when the elicitation is considered completed
* The client only confirms acceptance
* Useful for payments, SSO, external confirmations
:::

## Learn By Example
A complete working example is available [here](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/server/src/main.rs).
