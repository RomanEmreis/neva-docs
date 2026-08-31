---
sidebar_position: 13
---

# MCP Apps

The client half of [MCP Apps](../mcp-server/apps): declare that this side can
render an app, then read back which tools have one, which of them the model may
see, and what the document's security block asks for.

Enabled by the `apps` feature (included in `client-full`).

```toml
[dependencies]
neva = { version = "0.5", features = ["client", "apps"] }
```

:::info A neva client is not a browser
The `ui/*` traffic — the handshake, the tool-result push, the theming — runs
between a **host** and its iframe, inside a browser. neva models none of it. What
it gives you is the part a host needs from an MCP library: declare the extension,
find which tools have a face, fetch the HTML, and know which tools the model may
see. The rendering is yours.
:::

## Declaring the capability

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio("cargo", ["run", "--manifest-path", "./server/Cargo.toml"])
            .with_apps());

    client.connect().await?;
    client.disconnect().await
}
```

[`with_apps()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_apps)
advertises `io.modelcontextprotocol/ui` with the one content type the
specification defines, `text/html;profile=mcp-app`. A server checks this before
offering a UI-bound tool instead of a text-only one.

`mimeTypes` is **required** by the specification — a client that names none has
not declared support — which is why the method fills it in rather than
advertising an empty object the way the server side does.

To name a different set, use
[`with_app_mime_types`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_app_mime_types):

```rust compile
use neva::prelude::*;

fn main() {
    let client = Client::new()
        .with_options(|opt| opt.with_app_mime_types([APP_MIME_TYPE]));
    let _ = client;
}
```

The initial specification defines only that one type; the rest are reserved.

:::warning Declare it only if something here renders
Declaring the extension is a promise about **rendering**. Make it when this
process embeds a webview that shows the HTML, or when it is a host handing the
document on to one — not merely to read the metadata, which works without the
declaration.
:::

### Where it is sent, and where it is not

The declaration rides the `initialize` handshake, under
`capabilities.extensions`. That covers every connection in a
[`legacy-spec`](../legacy-spec) build, and the dual-mode fallback in a
2026-07-28 one.

Against a server that speaks MCP 2026-07-28, a neva client currently advertises
**nothing**: that generation
[replaced the handshake with discovery](../spec-2026-07-28#discovery-replaces-the-handshake)
and carries capabilities in each request's `_meta`, a channel that is not wired
for extensions yet. Tracked as
[#122](https://github.com/RomanEmreis/neva/issues/122).

This does not stop anything on this page from working — reading the metadata off
`tools/list` and `resources/read` needs no negotiation. What it means is that a
server cannot yet *vary* its answer by whether you can render.

:::note New in 0.5.6
`ClientCapabilities::extensions` is no longer gated on the protocol generation,
so a legacy `initialize` can carry it. Additive; its counterpart on
`ServerCapabilities` stays 2026-07-28-only.
:::

## Finding the tools that have a face

[`Tool::ui()`](https://docs.rs/neva/latest/neva/types/struct.Tool.html#method.ui)
reads the `_meta.ui` block back:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio("cargo", ["run", "--manifest-path", "./server/Cargo.toml"])
            .with_apps());

    client.connect().await?;

    let tools = client.list_tools(None).await?;

    for tool in tools.tools.iter() {
        // Every tool has a `content` answer; only some have a face.
        let Some(ui) = tool.ui() else {
            println!("{}: no UI", tool.name);
            continue;
        };

        let audience = if tool.is_model_visible() {
            "model + app"
        } else {
            "app only"
        };
        println!("{}: {} -> {:?}", tool.name, audience, ui.resource_uri);
    }

    client.disconnect().await
}
```

| Accessor | Answers |
|---|---|
| `tool.ui()` | The `UiToolMeta` block — `resource_uri` and `visibility` — or `None` for an ordinary tool |
| `tool.is_model_visible()` | May the agent see and call this tool? |
| `tool.is_app_visible()` | May the iframe call it? |

Both predicates are `true` for a tool with no MCP Apps metadata at all, and for
one whose `visibility` is omitted — that takes the specification's
`["model", "app"]` default. Only an explicit `visibility` leaving a scope out
makes the corresponding predicate `false`.

`ui()` is deliberately lenient in one direction and strict in the other. It also
accepts the **deprecated flat** `_meta["ui/resourceUri"]` key, which is what the
specification asks of a reader (the nested block wins where both are present),
and a malformed block reads as absent rather than failing the surrounding
`tools/list`. The visibility predicates do *not* share that leniency: an explicit
`visibility` that cannot be decoded **denies**, so a garbled block can never
promote an app-only tool into the agent's list.

:::warning Filtering is your job
A server lists app-only tools in `tools/list` like any other — the metadata is
the whole mechanism. A host **MUST NOT** put a tool `is_model_visible()` returns
`false` for into the agent's tool list. Nothing enforces this for you.
:::

## Fetching the document

This is the `resources/read` a host makes before it opens an iframe:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio("cargo", ["run", "--manifest-path", "./server/Cargo.toml"])
            .with_apps());

    client.connect().await?;

    let tools = client.list_tools(None).await?;

    if let Some(uri) = tools
        .get("get_time")
        .and_then(|tool| tool.ui())
        .and_then(|ui| ui.resource_uri)
    {
        let result = client.read_resource(uri).await?;
        for contents in result.contents.iter() {
            println!(
                "{} [{}] {} bytes",
                contents.uri(),
                contents.mime().unwrap_or("?"),
                contents.text().map(str::len).unwrap_or_default()
            );
            // The block the host turns into a CSP and an `allow` attribute.
            println!("  _meta.ui: {:?}", contents.ui());
        }
    }

    client.disconnect().await
}
```

A `ui://` read always comes back as `text/html;profile=mcp-app`. The `_meta.ui`
block carries `csp`, `permissions`, `domain` and `prefersBorder` — see
[The security block](../mcp-server/apps#the-security-block) for what each field
means.

:::warning Absent is not permissive
A missing `_meta.ui`, or a missing `csp` inside one, is the **restrictive**
default: no external access of any kind. Do not read it as "unspecified,
therefore allow" — that inverts the specification's intent and hands an untrusted
document the network.
:::

:::note New in 0.5.6
[`ResourceContents`](https://docs.rs/neva/latest/neva/types/enum.ResourceContents.html)'s
accessors — `uri`, `text`, `blob`, `json`, `mime`, `title`, `annotations` — are
now available to a client build. Previously they were server-side only, which
made a client read the enum's variants by hand. The *builders* stay server-side.
:::

## What's next

* [MCP Apps on the server](../mcp-server/apps) — serving the tool and the document
* [Tools](./tools) — calling tools and reading structured results
* [Resources](./resources) — the general `resources/read` machinery
* [`examples/apps`](https://github.com/RomanEmreis/neva/tree/main/examples/apps) —
  a runnable pair, client and server
