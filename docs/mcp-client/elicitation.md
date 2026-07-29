---
sidebar_position: 7
---

# Elicitation

This guide explains how a client handles [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation) requests sent by the MCP server.

## The Client Drives the Round-Trips

Under [MCP 2026-07-28](../spec-2026-07-28.md#multi-round-trip-requests-mrtr)
elicitation is not a push request the client receives out of band. The
server answers a tool call with `input_required`; the client's handler
produces the answer and **re-issues the call**, carrying the sealed
`requestState` back.

Neva does that loop for you, inside `call_tool`:

* your handler is invoked once per `input_required` round;
* `Client::call_tool` returns only the final result — the caller sees a
  single call;
* registering a handler is what makes the client declare
  `clientCapabilities.elicitation`, and a server may only ask for a kind the
  client declared;
* cap the re-issues per slot with
  [`McpOptions::with_max_mrtr_rounds`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html).

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
If you skip the [with_elicitation()](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_elicitation) or [with_form()](https://docs.rs/neva/latest/neva/types/struct.ElicitationCapability.html#method.with_form) or [with_url()](https://docs.rs/neva/latest/neva/types/struct.ElicitationCapability.html#method.with_url) but declare the elicitation handler this will enable form elicitation by default.
:::

## Elicitation Completion

:::warning Removed in MCP 2026-07-28
There is no `notifications/elicitation/complete` any more — **answering the
input request is the completion signal**, so
`Client::on_elicitation_completed` and `ElicitationCompleteParams` no longer
exist. URL elicitation also lost its `elicitationId`: with no
server-initiated completion signal there is nothing to correlate.

If you were using the notification for UI updates or audit logging, hook the
handler itself instead — it runs exactly when the client answers.

These APIs come back under [`legacy-spec`](../legacy-spec.md).
:::

## Learn By Example
A complete working example is available [here](https://github.com/RomanEmreis/neva/blob/main/examples/elicitation/client/src/main.rs).
