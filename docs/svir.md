---
sidebar_position: 6
sidebar_label: svir Bridge
---

# Handing Tools to a Model

An MCP server describes tools; a model calls them. Between the two sits the
loop that offers the tools to the model, runs the calls it makes, and hands the
results back. [svir](https://docs.rs/svir) is the model side of that loop — tool
descriptors, calls and results for function calling, and a
[`Toolbox`](https://docs.rs/svir/latest/svir/trait.Toolbox.html) trait a request
takes its tools from. It has no MCP of its own.

The `svir` feature is the bridge: it implements `Toolbox` over MCP, so the tools
of a server — a remote one, or your own — can be handed to a model as they are.

| Toolbox | Offers | A call is |
|---|---|---|
| [`RemoteTools::new(client)`](#a-remote-servers-tools) | A connected server's tools | A `tools/call` over the client |
| [`App::into_toolbox()`](#your-own-tools-in-process) | This server's tools; the app serves nothing over MCP | Run in this process, through the server's pipeline |
| [`App::with_toolbox()`](#serving-and-calling-at-once) | The same, while the server keeps serving over MCP | Run in this process |
| [`ctx.tools().toolbox()`](#a-tool-that-drives-a-model) | Inside a handler, the server's other tools, as this request may call them | Run in this process |

Prompts and resources are not tools — in MCP the user picks a prompt and the
application picks a resource — so they become [svir messages](#prompts-and-resources)
instead. And a server's sampling request can be [answered with a model](#answering-sampling-with-a-model).

## Enabling the bridge

```toml
[dependencies]
neva = { version = "0.7", features = ["client-full", "svir"] }  # or server-full
svir = "0.1.4"
tokio = { version = "1", features = ["full"] }
```

`svir` is in none of the presets — not `full`, not `server-full`, not
`client-full`. svir is still `0.x`, and a preset that included it would turn
every breaking svir release into a breaking neva one.

neva brings svir in without its default features: the types and the `Toolbox`
trait, no HTTP client. The model is called through svir directly, so depend on
svir yourself — its default features bring the client and TLS.

The `svir::Error` a model call fails with converts into neva's `Error`, so `?`
passes it on. The converted message is svir's own account of the failure: the
model server's message, which can name the account, stays in the svir error's
`source` and is never what an MCP peer is answered with.

## A remote server's tools

[`RemoteTools`](https://docs.rs/neva/latest/neva/svir/struct.RemoteTools.html)
takes a connected `Client` — the client itself, or an `Arc` of one the rest of
the program shares — and offers the server's tools:

```rust compile features="full svir"
use neva::{Client, svir::RemoteTools};
use svir::Toolbox;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_http(|http| http.bind("127.0.0.1:3000").with_endpoint("/mcp")));
    client.connect().await?;

    // The server's tools, offered as `board_add_task` and so on.
    let tools = RemoteTools::new(client).with_prefix("board_").load().await?;

    let model = svir::Client::openai("http://127.0.0.1:1234").build()?;
    let mut request = svir::Request::new("qwen3")
        .system("You keep the user's task board with the tools you have.")
        .tools(&tools)
        .user("Put three tasks on the board for the release, then show it to me.");

    // Answer the model's calls until it answers the user.
    for _ in 0..8 {
        let done = model.complete(&request).await?;
        if done.calls.is_empty() {
            println!("{}", done.text);
            return Ok(());
        }
        // Each call is a `tools/call`; the calls of one turn run concurrently.
        let results = tools.call_all(&done.calls).await;
        request = request.assistant(done).tool_results(results);
    }

    Err("the model kept calling tools".into())
}
```

The descriptors are a **snapshot** — `Toolbox::tools` is synchronous, and a
listing is paged over the network. `load()` takes the first one and `refresh()`
renews it, for example when the server sends
`notifications/tools/list_changed`. Only the tools in the snapshot can be
called: a model naming another one is told there is no such tool.

`tools.client()` reaches the client again, for the rest of what the server
offers — its prompts and resources.

## Choosing what is offered

Which tools a model may use is your policy, not the server's:

```rust
let tools = RemoteTools::new(client)
    .filter(|tool| !tool.name.starts_with("admin_"))
    .rename(|name| name.replace('.', "_"))
    .with_prefix("gh_")
    .load()
    .await?;
```

* **`filter`** keeps a tool only if every filter keeps it. Each one sees the
  tool as the server listed it, under the server's name, wherever it stands
  among the renames.
* **`rename`** offers a tool under another name, and a call is forwarded under
  the one the server knows. Renames apply in order, each to the name the
  previous ones made. **`with_prefix`** is a rename that prepends — the way to
  keep the tools of two servers apart in one request.

A function name a model API accepts is `[a-zA-Z0-9_-]{1,64}`, where MCP also
allows `.` and up to 128 characters. A tool whose name cannot be carried, after
the renames, or two tools under one name, **fail the snapshot** rather than
being renamed behind your back — a silent rename would have the model call a
tool by a name nothing answers to. Rename it or filter it out. A failed
`refresh()` keeps the previous snapshot.

Some tools are never offered:

* a tool that can only be called as a task (`task_support = "required"`);
* with the `apps` feature, a tool [MCP Apps](./mcp-server/apps#visibility-tools-the-app-calls-and-the-model-never-sees) hides
  from the model;
* in-process, a tool requiring [roles or permissions](#what-an-in-process-call-holds)
  the caller does not hold.

## What the model is told

A tool result is a string to a model, so the content is flattened into one:

| Content | Told as |
|---|---|
| Text blocks | Their text, joined with a blank line |
| Structured content | JSON text — only when there is no text block, since a tool returning both serializes the same data into the text |
| An embedded text or JSON resource | Its text, or its JSON |
| A resource link | Its name and URI |
| An image, audio, a binary resource | An **error** naming what could not be passed on |

A result the tool flagged as an error, and a call the server refused, are told
as an error with its message. Nothing is dropped silently: what a model cannot
take is said, so the model can say so too.

A model's arguments go out as `tools/call` takes them. A call without
arguments arrives as `{}`, an empty string or `null` about equally often, and
all three are no arguments; anything else that is not a JSON object is the
model's mistake, and is told back to it.

## Your own tools, in process

A tool written once with `#[tool]` can be handed to a model with no MCP
transport in between. [`App::into_toolbox`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.into_toolbox)
consumes the server and returns its tools as a
[`LocalTools`](https://docs.rs/neva/latest/neva/svir/struct.LocalTools.html):

```rust compile features="full svir"
use neva::prelude::*;

#[tool(descr = "Adds two numbers")]
fn add(a: i64, b: i64) -> i64 {
    a + b
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = App::new();

    // Served nothing over MCP: a transport configured here is not started.
    let tools = app.into_toolbox().load().await?;

    let request = svir::Request::new("qwen3")
        .tools(&tools)
        .user("What is 2 + 40?");
    // ... the same loop as above.
    let _ = request;
    Ok(())
}
```

Each call is a `tools/call` run **through the same pipeline** a call over MCP
takes. The server's middleware sees it — authorization, rate limits, audit apply
to the model as to any other caller — and the tool gets its `Context` and its
injected dependencies (`Dc<T>`) as it would over MCP. `filter`, `rename` and
`with_prefix` work as on `RemoteTools`, and `refresh()` picks up tools added or
removed since the snapshot.

What there is not is a **peer**. A tool that asks for input — elicitation,
sampling, roots — is refused at once rather than left waiting, and its progress
and log notifications go nowhere.

### Serving and calling at once

[`App::with_toolbox`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.with_toolbox)
does both: the server runs as configured, and the toolbox calls the same tools
in this process.

```rust compile features="full svir"
use neva::prelude::*;

#[tool(descr = "Adds two numbers")]
fn add(a: i64, b: i64) -> i64 {
    a + b
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let app = App::new().with_options(|opt| opt.with_default_http());

    let (app, tools) = app.with_toolbox();
    tokio::spawn(app.run());

    // Waits until `run` has built the server.
    let tools = tools.load().await?;
    // Served over HTTP, and offered to a model here.
    let _ = tools;
    Ok(())
}
```

The toolbox is bound to the server once `run` has built it, so `load()` waits
for that. It fails if the server is dropped without running, or stops before it
gets that far.

## A tool that drives a model

Inside a handler, [`ctx.tools().toolbox()`](https://docs.rs/neva/latest/neva/app/context/api/struct.Tools.html#method.toolbox)
offers the server's **other** tools — the shape of an orchestrator, a tool
that hands a task to a model along with the rest of the server:

```rust compile features="full svir"
use neva::{di::Dc, prelude::*};
use svir::Toolbox;

#[tool(descr = "Plans the week, keeping the board up to date")]
async fn plan_week(ctx: Context, model: Dc<svir::Client>, focus: String) -> Result<String, Error> {
    // Every other tool of this server, as this request may call them.
    let tools = ctx.tools().toolbox().load().await?;

    let mut request = svir::Request::new("qwen3")
        .tools(&tools)
        .user(format!("Plan my week around {focus}."));

    for _ in 0..8 {
        let done = model.complete(&request).await?;
        if done.calls.is_empty() {
            return Ok(done.text);
        }
        let results = tools.call_all(&done.calls).await;
        request = request.assistant(done).tool_results(results);
    }

    Err(Error::new(ErrorCode::InternalError, "the model kept calling tools"))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let model = svir::Client::openai("http://127.0.0.1:1234").build()?;

    App::new()
        .with_options(|opt| opt.with_default_http())
        .add_singleton(model)
        .run()
        .await;
    Ok(())
}
```

Two bounds keep such a tool from calling itself forever:

* **The tool it is taken in is left out.** A model calling `plan_week` from
  inside `plan_week` would start the whole loop over within the call still
  running it. A tool that means to recurse keeps itself with `with_caller()`.
* **In-process calls nest at most four deep.** `a` calls `b`, which calls `a`
  again: leaving the caller out stops the direct loop, the depth bounds the rest.
  A call past the bound is not made, and the model is told why.
  `with_max_depth(n)` changes it for that toolbox.

The depth is the chain's, whichever toolbox makes the calls: one from
`App::into_toolbox` kept and called inside a handler counts as deep as one taken
from the handler's `Context`. On a task the handler spawns, only the one from
the `Context` knows how deep it is.

### What an in-process call holds

A toolbox from `ctx.tools().toolbox()` holds the **claims of the current
request**: a tool those claims do not reach is not offered, and the server's
checks see them on every call. A toolbox from `App::into_toolbox` or
`App::with_toolbox` is taken in no request and holds no claims, so a tool that
requires [roles or permissions](./mcp-server/http#role-based-access-control) is not offered
by it at all.

## Prompts and resources

[`prompt_messages`](https://docs.rs/neva/latest/neva/svir/fn.prompt_messages.html)
turns a prompt into the messages it opens a conversation with, and
[`resource_parts`](https://docs.rs/neva/latest/neva/svir/fn.resource_parts.html)
turns a resource into parts to attach to one:

```rust compile features="full svir"
use neva::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = Client::new().with_options(|opt| opt.with_default_http());
    client.connect().await?;

    // The conversation opens with the server's own prompt.
    let prompt = client.prompts().get("plan_week", [("focus", "the release")]).await?;
    let request = neva::svir::prompt_messages(prompt)?
        .into_iter()
        .fold(svir::Request::new("qwen3"), svir::Request::message);

    // A resource, attached to a question.
    let notes = client.resources().read("file:///notes.md").await?;
    let question = neva::svir::resource_parts(notes)?
        .into_iter()
        .fold(svir::Message::user("Summarise these notes."), svir::Message::with);

    let _request = request.message(question);
    client.disconnect().await?;
    Ok(())
}
```

A prompt keeps its roles, and consecutive messages of one role become one turn.
Text is text, an image an image, an embedded resource is attached as
`resource_parts` attaches it, and a resource link is its name and URI. A
resource's text becomes a text file named by its URI — which is how the model is
told where it came from — and so does its JSON; an image blob is an image.
Audio and other binary contents are an **error** rather than dropped. A prompt's
description is for the user, not the model, and is left out.

## Answering sampling with a model

A server asking its client for a sample wants exactly what svir does.
[`sampling_request`](https://docs.rs/neva/latest/neva/svir/fn.sampling_request.html)
turns `sampling/createMessage` into a request to a model, and
[`sampling_result`](https://docs.rs/neva/latest/neva/svir/fn.sampling_result.html)
turns the model's answer into the sample the server gets back:

```rust compile features="full svir"
use neva::prelude::*;
use neva::types::sampling::CreateMessageRequestParams;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let model = svir::Client::openai("http://127.0.0.1:1234").build()?;

    let mut client = Client::new().with_options(|opt| opt.with_default_http());

    // Sampling is deprecated in MCP 2026-07-28 (see the Sampling page).
    #[allow(deprecated)]
    client.map_sampling(move |params: CreateMessageRequestParams| {
        let model = model.clone();
        async move {
            let request = neva::svir::sampling_request("qwen3", params)?;
            // A model that cannot be reached fails the sample, not the client.
            let done = model.complete(&request).await?;
            neva::svir::sampling_result(&request, done)
        }
    });

    client.connect().await?;
    let result = client.tools().call("summarize_report", [("topic", "EMEA")]).await?;
    println!("{:?}", result.content);
    client.disconnect().await?;
    Ok(())
}
```

The handler [may fail](./mcp-client/sampling#a-handler-that-can-fail): under MCP
2026-07-28 the call that asked for the sample fails with the error, and under
`legacy-spec` the error is what the server is answered with.

What carries over: the system prompt, the messages, the tools, `maxTokens` and
`temperature`. Roles are kept; a `tool_use` block is a call in the assistant's
turn and each `tool_result` a tool message of its own, flattened as a tool's
answer is for a model. `toolChoice: none` leaves the tools out.

Audio, stop sequences and `toolChoice: required` cannot be passed on and are an
**error**. What the spec leaves to the client is left out: `includeContext`,
`modelPreferences` — the model is your choice — and the provider `metadata`.

The sample is the model's text, then a `tool_use` block per call, each keeping
the call's id so the `tool_result` the server sends back finds it. The stop
reason is `toolUse` when the model called a tool, and otherwise follows why it
stopped: `endTurn`, `maxTokens`, or `contentFilter`.

## Learn By Example

[`examples/svir`](https://github.com/RomanEmreis/neva/tree/main/examples/svir) is
a task board written once with `#[tool]` and `#[prompt]`, handed to a model both
ways: served over MCP and called from a client through `RemoteTools`, or called
in the same process through `App::into_toolbox`. Any OpenAI-compatible model
server will do — LM Studio, llama.cpp, vLLM, a hosted endpoint.

For the model side — streaming, layers, a `Toolbox` of your own — see the
[svir documentation](https://romanemreis.github.io/svir-docs/).
