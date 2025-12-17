---
sidebar_position: 7
---

# Elicitation

This guide explains how a client handles [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation) requests sent by the MCP server.

## Enabling Elicitation Support
```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_elicitation(|e| e
            .with_form()
            .with_url()));
```
This enables:
* Form-based elicitation
* URL elicitation

## Handling Elicitation Requests

Define an elicitation handler using the [#[elicitation]](https://docs.rs/neva/latest/neva/attr.elicitation.html) attribute macro.
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
            // Follow the url to perform the external action.

            ElicitResult::accept()
        }
        ElicitRequestParams::Form(form) => {
            // Show the form to a user to fill in the data

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

### What Happens Here?

* URL elicitation
  * Client accepts and performs the action externally
* Form elicitation
  * Client constructs data
  * Data is validated against the server schema
  * Validated payload is returned as [ElicitResult](https://docs.rs/neva/latest/neva/types/elicitation/struct.ElicitResult.html)

:::info
If you skip the [with_elicitation()](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_elicitation) or [with_form()](https://docs.rs/neva/latest/neva/types/struct.ElicitationCapability.html#method.with_form) or [with_url](https://docs.rs/neva/latest/neva/types/struct.ElicitationCapability.html#method.with_url) but declare the elicitation handler this will enable form elicitation by default.
:::

## Observing Elicitation Completion
```rust
client.on_elicitation_completed(async |n| {
    let Some(params) = n.params::<ElicitationCompleteParams>() else {
        println!("Unable to read params");
        return;
    };

    println!("Elicitation {} has been completed.", params.id);
});
```
This is useful for:
* UI updates
* Logging
* Tracking external flows (payments, auth)

## Learn By Example
A complete working example is available [here](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/client/src/main.rs).
