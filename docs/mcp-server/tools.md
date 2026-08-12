---
sidebar_position: 2
---

# Tools

The Model Context Protocol (MCP) allows servers to expose [tools](https://modelcontextprotocol.io/specification/draft/server/tools) that can be invoked by language models. Tools enable models to interact with external systems, such as querying databases, calling APIs, or performing computations. Each tool is uniquely identified by a name and includes metadata describing its schema.

In the [Basics](/docs/mcp-server/basics#setup-a-tool) chapter, we learned how to declare a simple tool:

```rust
use neva::prelude::*;

#[tool(descr = "A simple 'say hello' tool")]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

You can achieve the same result **without** using the procedural macro:

```rust
use neva::prelude::*;

async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    let mut mcp_server = App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP Server")
            .with_version("1.0.0"));
            
    mcp_server
        .map_tool("hello", hello)
        .with_description("A simple 'say hello' tool");

    mcp_server.run().await;
}
```

In the example above, the tool name must be set explicitly.
When using the [`#[tool]`](https://docs.rs/neva/latest/neva/attr.tool.html) attribute macro, the tool name is automatically inferred from the function name.

All other tool parameters that can be specified in the attribute macro can also be configured using `with_*` methods (for example, [`with_description()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_description)).

The [`map_tool()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_tool) method registers a tool handler under a specified name and returns a mutable reference to the registered [tool](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html).

## Input Schema

You can describe an explicit input schema for a tool.
If not provided, Neva automatically generates one based on the tool handler’s function signature.

Schemas are full **JSON Schema 2020-12** documents — `InputSchema` over a
`serde_json::Value` — and the `#[tool]` macro emits complete 2020-12
documents automatically.

To override the generated schema, you can specify it as a JSON string:

```rust
#[tool(
    descr = "A simple 'say hello' tool",
    input_schema = r#"{
        "properties": {
            "name": { 
                "type": "string", 
                "description": "The name to greet"
            }
        },
        "required": ["name"]
    }"#
)]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

A schema you write is published **verbatim**. Every keyword neva does not
model itself — `default`, `pattern`, `examples`, `$schema`, `$defs`, `$ref`,
`additionalProperties`, `allOf`/`anyOf`, `if`/`then`/`else` — survives into
the listing untouched, at the root and below it, so a peer validating
against the published schema accepts exactly what the tool accepts.

`"integer"` is its own type rather than an alias for `"number"`: a field
declared `integer` rejects `1.5` but still accepts `1.0`, since the check
judges the value and not how it was written.

## Output Schema

If your tool returns [**structured data**](https://modelcontextprotocol.io/specification/draft/server/tools#tool-result) (for example, a JSON object),
Neva automatically generates an output schema based on the return type.

Just like with the [input schema](/docs/mcp-server/tools#input-schema),
you can override it manually:

```rust
#[tool(
    descr = "A 'say hello' tool with structured output",
    output_schema = r#"{
        "properties": {
            "message": { 
                "type": "string", 
                "description": "The generated greeting message"
            }
        },
        "required": ["message"]
    }"#
)]
async fn hello(say: String, name: String) -> Json<Results> {
    let result = Results { 
        message: format!("{say}, {name}!")
    };
    result.into()
}
```

## Optional Arguments

An argument declared `Option<T>` is published as its inner `T` but is left
out of `required`; a call that omits it hands the handler `None` instead of
failing:

```rust
#[tool(descr = "Greets a person, by nickname when there is one")]
async fn greet(name: String, alias: Option<String>) -> String {
    format!("Hello, {}!", alias.unwrap_or(name))
}
```

A tool whose arguments are *all* optional publishes no `required` key at
all. The rule follows the resolved type, so a type alias
(`type MaybeFloor = Option<i32>;`) behaves the same way, and
`Option<Json<T>>` still describes `T` in full.

Prompts work the same way — see
[Prompts → Optional Arguments](./prompts#optional-arguments).

## Argument Names

A call's `arguments` are read **by name**, not by position — so the names
the handler reads by have to be the names the `inputSchema` publishes.

With `#[tool]` there is nothing to do: the macro takes the function's own
parameter names. A bare closure is the exception, because Rust does not
preserve a closure's parameter names — such a tool falls back to publishing
and reading the positional `arg0`, `arg1`, … The `map_tool!` macro reads the
names off the closure for you:

```rust compile
use neva::{App, map_tool};

#[tokio::main]
async fn main() {
    let mut app = App::new();

    map_tool!(app, "greet", |name: String, age: i32| async move {
        format!("Hello, {name}! You are {age}.")
    })
    .with_description("Greets a person");

    app.run().await;
}
```

[`with_arg_names()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_arg_names)
is the same thing spelled out, for a named function or a handler you did not
declare inline:

```rust compile
use neva::App;

async fn greet(name: String, age: i32) -> String {
    format!("Hello, {name}! You are {age}.")
}

#[tokio::main]
async fn main() {
    let mut app = App::new();

    app.map_tool("greet", greet)
        .with_arg_names(["name", "age"]);

    app.run().await;
}
```

Either call renames the generated schema and the extraction names
**together**, so the two cannot drift. Only the value-carrying parameters
are named: `Context`, `Meta<_>` and a DI-injected `Dc<T>` are skipped here
exactly as they are skipped in the schema. An `Option<T>` *is* named — it
occupies an argument slot, it simply is not required.

:::note A schema you wrote is never renamed
A schema supplied through `input_schema = "..."` or
[`with_input_schema()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_input_schema)
is taken verbatim — every key in it was chosen on purpose. Name its
properties as you name the arguments. The two calls may appear in either
order.
:::

### Startup Validation

A tool or prompt that publishes arguments its handler does not read cannot be
called successfully by anyone, so `App::run` refuses to start on the
disagreement instead of failing on a peer's first call — a wrong count of
declared names, a duplicate name, or a schema property the handler never
looks for. [`Context::add_tool`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.add_tool)
and `add_prompt` run the same check and return an error, since a primitive
registered while the server runs has no startup left to fail.

:::warning Wire change in v0.5.2
A tool registered from a bare closure now advertises `arg0`, `arg1`, … where
it used to key the properties by *type* name — and `|a: i32, b: i32|`
publishes two properties where the two `i32` slots used to collapse into
one. Tools declared with `#[tool]` are unaffected. If you register tools
from closures and want the old wire names back, name them explicitly with
`map_tool!` or `with_arg_names()`.
:::

## Mirroring an Argument into a Header

A tool may ask that one of its arguments also travel as an HTTP header, so
that proxies and gateways can route or rate-limit on it without parsing the
body. Annotate the property in the `inputSchema` with `x-mcp-header`, and
clients will mirror the value into `Mcp-Param-{name}` on `tools/call`:

```rust
#[tool(
    descr = "Fetches a tenant's dashboard",
    input_schema = r#"{
        "properties": {
            "tenant": {
                "type": "string",
                "description": "Tenant identifier",
                "x-mcp-header": true
            }
        },
        "required": ["tenant"]
    }"#
)]
async fn dashboard(tenant: String) -> String {
    format!("Dashboard for {tenant}")
}
```

Servers *may* use the annotation; clients **must** honor it. Neva's own
client records the annotations from `tools/list` and attaches the headers
automatically, and the server rejects a `tools/call` whose header and body
disagree with `HeaderMismatch` (`-32020`).

### The registrations expire with the listing

What a client learned from `tools/list` is only good for that listing's
`ttlMs` — an absent `ttlMs` reads as `0`, so those annotations are usable
for that exchange and no longer. Once they have expired, a `HeaderMismatch`
has the client re-list and retry the call once; that fresh listing counts
for the retry whatever its own TTL, for the refused tool and that one
exchange only.

This matters if you change a tool's `x-mcp-header` annotations at runtime:
set a `ttlMs` you are willing to be held to, and expect one extra
`tools/list` round-trip after a change rather than a permanently wrong
header.

:::warning
A definition that breaks the spec's constraints — a non-token name, a
duplicate, a non-primitive type, or a property that is not statically
reachable through `properties` — causes the **whole tool** to be dropped
from the listing. That is deliberate: one bad definition must not be able to
change what a good one sends. This applies to Streamable HTTP; other
transports may ignore the annotation.
:::

## Listing Order

Tool, prompt, and resource registries are `BTreeMap`-backed, so `tools/list`
returns entries **ordered by name** and the order is stable across calls.
This is what makes cursor [pagination](../mcp-client/basics.md#pagination)
safe — an arbitrary order could skip or repeat entries across pages — and it
lets LLM prompt caches hit on an unchanged tool listing.

## MCP Context

For more advanced scenarios - for example, when a tool needs to access resources you also declared in your MCP Server -
you can inject the [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) into your tool handler:

```rust
#[tool(descr = "Fetches resource metadata")]
async fn read_resource(ctx: Context, res: Uri) -> Result<Content, Error> {
    let result = ctx.resource(res).await?;
    let resource = result.contents
        .into_iter()
        .next()
        .expect("No resource contents");
    Ok(Content::resource(resource))
}
```


## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/server)
