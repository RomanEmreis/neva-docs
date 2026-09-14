---
sidebar_position: 3
---

# Handler Shapes

Every registration point in neva — tools, prompts, resources, resource
listings, completion, plain request handlers, and the client's sampling and
elicitation handlers — accepts a handler in one of **two shapes**:

```rust compile
use neva::prelude::*;

// Asynchronous: returns a future the server awaits.
#[tool(descr = "Greets a person, eventually")]
async fn greet_later(name: String) -> String {
    format!("Hello, {name}!")
}

// Synchronous: returns the value itself.
#[tool(descr = "Greets a person")]
fn greet(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .run()
        .await;
}
```

:::info New in neva 0.6.0
Before **0.6.0** a handler had to return a future, so a body doing nothing but
arithmetic still had to be an `async fn`. Synchronous handlers are **additive**:
which shape a handler has is read off its signature, the published schema and
the argument slots are identical either way, and existing `async fn` handlers
are untouched.
:::

## Choosing a shape

The question is not "is this function short" — it is **what the body does with
the thread it is given**.

| The body | Write | Runs on |
|---|---|---|
| **Awaits** something — an HTTP call, an async database driver, another MCP peer through `Context` | `async fn`, or a closure returning an `async` block | The runtime, yielding at each await |
| **Computes on data already in hand** — arithmetic, formatting, a map lookup, filtering a `Vec` | a plain `fn` | Inline, on the runtime thread that dispatched the request |
| **Blocks** — `std::fs`, a synchronous database or HTTP driver, `Command::output`, a long computation | a plain `fn` registered through [`blocking`](#nevablocking) | Tokio's blocking pool |

The middle row is the cheap one: no task spawn, no yield point, nothing to
poll. The third row exists because an inline synchronous handler that *really*
blocks holds a runtime worker for its whole duration, and that worker polls
nothing else meanwhile.

:::warning `blocking` on a short body is a pessimization
Handing `a + b` to another thread costs far more than the addition. Reach for
`blocking` when the body genuinely blocks, not because it is synchronous.
:::

## Where the two shapes are accepted

Both shapes work at every registration point, on both sides of the protocol:

| Side | Accepts either shape |
|---|---|
| Server, methods | [`App::map_tool`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_tool), `map_prompt`, `map_resource`, `map_resources`, `map_completion`, `map_handler`, `map_ui_resource` |
| Server, constructors | [`Tool::new`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.new), [`Prompt::new`](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html#method.new) |
| Server, macros | `#[tool]`, `#[prompt]`, `#[resource]`, `#[resources]`, `#[completion]`, `#[handler]`, and the `map_tool!` / `map_prompt!` macros |
| Client | [`Client::map_sampling`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.map_sampling), [`Client::map_elicitation`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.map_elicitation), `#[sampling]`, `#[elicitation]` |

Closures work the same way:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio());

    // Synchronous closure — returns the value.
    app.map_tool("add", |a: i32, b: i32| a + b)
        .with_arg_names(["a", "b"]);

    // Asynchronous closure — returns a future.
    app.map_tool("add_later", |a: i32, b: i32| async move { a + b })
        .with_arg_names(["a", "b"]);

    app.run().await;
}
```

Remember that a **bare closure** publishes `arg0`, `arg1`, … because Rust drops
closure parameter names — that is unchanged by the handler's shape, and is why
both calls above name their arguments. See
[Argument names](./tools#startup-validation).

## `neva::blocking`

[`blocking`](https://docs.rs/neva/latest/neva/fn.blocking.html) wraps a
synchronous handler so it runs on Tokio's blocking pool instead of the runtime
thread that dispatched the request. It is accepted at every registration point,
so one adapter covers them all:

```rust compile
use neva::{prelude::*, blocking};

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio());

    app.map_tool("read_file", blocking(|path: String| {
        std::fs::read_to_string(path).unwrap_or_default()
    }))
    .with_arg_names(["path"]);

    app.run().await;
}
```

`blocking` takes a **synchronous** handler. An asynchronous one has nothing to
offload — it already yields — and is rejected at compile time.

### The `blocking` attribute

Every attribute macro takes `blocking` as a flag, which applies the same
wrapper for you. It works on all eight: `#[tool]`, `#[prompt]`, `#[resource]`,
`#[resources]`, `#[completion]`, `#[handler]`, `#[sampling]` and
`#[elicitation]`.

```rust compile
use neva::prelude::*;

#[tool(descr = "Reads a text file", blocking)]
fn read_file(path: String) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .run()
        .await;
}
```

On an `async fn` the attribute is a **compile error**, for the same reason the
function form is: there is nothing to move off the runtime.

### Two semantics worth knowing

* **A panic is propagated**, not swallowed. A panic inside the handler lands on
  the awaiting task exactly as it would have had the handler run inline — the
  offload is not supposed to change what a panicking handler does.
* **The offloaded task is not cancelled when the request is.** Once started it
  runs to completion and its result is discarded. A blocking body cannot be
  interrupted from outside, so a handler that must stop early needs to check a
  flag of its own.

## Errors work the same way

A synchronous handler returns `Result` exactly as an asynchronous one does, and
the error model is unchanged: for a tool an `Err` becomes a *tool error* — a
successful response with `is_error: true` — while for a resource or a prompt it
is a JSON-RPC error that fails the request. See
[Error handling](./error-handling).

```rust compile
use neva::prelude::*;

#[tool(descr = "Divides two numbers")]
fn divide(a: f64, b: f64) -> Result<f64, Error> {
    if b == 0.0 {
        return Err(Error::new(ErrorCode::InvalidParams, "division by zero"));
    }
    Ok(a / b)
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .run()
        .await;
}
```

## `neva::marker` — the shape as a type

The two shapes cannot be told apart by a `where` clause: an impl for each would
overlap, and coherence rejects that. So the shape rides as a **type-level
marker**, [`neva::marker::Async`](https://docs.rs/neva/latest/neva/marker/struct.Async.html)
or [`marker::Immediate`](https://docs.rs/neva/latest/neva/marker/struct.Immediate.html),
on the handler traits:

```rust
pub trait ToolHandler<Args, M = marker::Async>: HandlerFn<Args, M> { … }
```

The marker is **defaulted**, and it is inferred from the handler at the
registration site. In practice it never appears in handler code, and a bound
written as `ToolHandler<Args>` means exactly what it meant before synchronous
handlers existed.

A `blocking(..)` handler carries `marker::Immediate` too — it is a synchronous
handler with a different execution strategy, not a third shape.

:::warning Spelled-out generics need one more argument
The registration methods gained the marker as a generic parameter, so a call
site that writes its generics out by hand needs a fourth argument:

```rust
// 0.5.x
app.map_tool::<_, _, (String,)>("greet", greet);

// 0.6.0 — fails with E0107 until the marker is added
app.map_tool::<_, _, (String,), _>("greet", greet);
```

This is the only source-breaking part of the change. Every call site that
leaves inference to do its job — which is the normal way to write them — is
unaffected. See the [0.6.0 migration notes](../spec-2026-07-28#migrating-to-060).
:::

## What's next

* [Tools](./tools) — schemas, argument names, content types
* [Error handling](./error-handling) — what an `Err` means per handler kind
* [Dependency injection](./di) — injecting services into either shape
* [Elicitation](./elicitation) — why an elicit point makes a handler *re-run*
