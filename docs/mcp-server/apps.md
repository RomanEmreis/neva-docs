---
sidebar_position: 20
---

# MCP Apps

**MCP Apps** ([SEP-1865](https://github.com/modelcontextprotocol/ext-apps)) gives
a tool a face: an HTML document the host renders in a sandboxed iframe and feeds
the tool's result into. It is the first official MCP extension, advertised as
`capabilities.extensions["io.modelcontextprotocol/ui"]`.

Enabled by the `apps` feature (included in `server-full`).

```toml
[dependencies]
neva = { version = "0.5", features = ["server-macros", "apps"] }
```

## What a server is actually responsible for

The specification is large, and most of it never reaches a server. It has two
halves, and only one of them is MCP traffic:

| Half | Between | Transport | Your server |
|---|---|---|---|
| **Data plane** | server ↔ client | MCP JSON-RPC | Serves it — a `_meta.ui` block on a tool, and a `ui://` HTML resource |
| **Presentation plane** | host ↔ iframe | JSON-RPC over `postMessage` | Never sees it |

Everything named `ui/*` — `ui/initialize`, `ui/notifications/tool-result`,
`ui/open-link`, host context, theming — is browser traffic between the host and
the iframe. A neva server neither sends nor receives any of it, and neva models
none of it. **Your server serves a tool and an HTML document; the host does the
theater.**

:::warning A UI-bound tool must still answer in text
The one behavioural rule the specification puts on a handler: a tool with a UI
**MUST** still return a meaningful `content` array. The model reads `content`;
the iframe is for humans, and not every client has one. Return the sentence, not
the bare datum — the app can render the same string.
:::

:::note 2026-07-28 only on the server
`with_apps()`, `add_ui_resource` and `map_ui_resource` are compiled out under
[`legacy-spec`](../legacy-spec): the extension rides
`capabilities.extensions`, which the previous generation has no place for. The
*client* half works in both profiles.
:::

## Enabling it

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_apps())
        .run()
        .await;
}
```

[`with_apps()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_apps)
advertises the extension and takes the defaults. Like Tasks, the server-side
capability is an **empty object** — the specification defines settings for the
client direction only, so a server has nothing to say beyond "supported", and
the method takes no closure.

Without it a host has no reason to look at the `_meta.ui` blocks at all.

## The two halves of an app

Always two, never one:

1. a **tool** that does the work and returns data, like any other tool;
2. a **`ui://` resource** holding the HTML that renders it.

The tool carries `_meta.ui.resourceUri`; the host fetches that resource with
`resources/read` and opens an iframe on it.

```rust compile
use neva::prelude::*;

/// Note what it returns: a sentence, not a bare timestamp. The model reads
/// `content` whether or not a UI exists.
#[tool(descr = "The current time.", ui = "ui://clock/app.html")]
async fn get_time() -> String {
    format!("The time is {}.", now())
}

fn now() -> String {
    "12:00:00 UTC".into()
}

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.add_ui_resource("ui://clock/app.html", "clock", "<!doctype html>…")
        .with_title("Clock")
        .with_descr("A ticking clock")
        .with_prefers_border(true);

    app.run().await;
}
```

That is the whole server side. The macro stamps `_meta.ui.resourceUri` onto the
tool;
[`add_ui_resource`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.add_ui_resource)
registers the read handler and fills in the
`text/html;profile=mcp-app` MIME type.

## Serving the document

### Fixed HTML — `add_ui_resource`

One call registers the `ui://` read handler, stamps the MIME type and hands back
a `&mut` for the rest of the configuration. The returned reference **stays live
for the whole chain**: the resource is materialized when the server starts, not
when the call returns, so a builder invoked later still counts.

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.add_ui_resource("ui://weather/dashboard", "dashboard", "<!doctype html>…")
        .with_title("Weather dashboard")
        .with_descr("Today's forecast")
        .with_csp(UiCsp::new()
            .with_connect_domains(["https://api.openweathermap.org"]))
        .with_permissions(UiPermissions::new().with_geolocation())
        .with_prefers_border(true);

    app.run().await;
}
```

| Builder | Sets |
|---|---|
| `with_title` / `with_descr` | Human-readable title and description |
| `with_csp` | The origins the app needs — see [The security block](#the-security-block) |
| `with_permissions` | Browser permissions the iframe *requests* |
| `with_domain` | Asks the host to serve the app from a dedicated sandbox origin |
| `with_prefers_border` | Whether the app wants a visible border and background |
| `with_ui` | Replaces the whole `_meta.ui` block at once — the escape hatch for a block built elsewhere |

### Generated HTML — a `ui://` resource like any other

When the markup is computed — read from disk, templated, assembled at read time
— register it the way you register any resource. **The `ui://` scheme is what
marks it as an app**, and the macro takes it from there: it supplies the
`text/html;profile=mcp-app` MIME type and validates the `ui_meta` block at
compile time.

```rust compile
use neva::prelude::*;

/// One document for every report.
#[resource(
    uri = "ui://report/view",
    title = "Report",
    descr = "Renders whichever report the tool just returned",
    ui_meta = r#"{
        "csp": { "resourceDomains": ["https://cdn.jsdelivr.net"] },
        "prefersBorder": false
    }"#
)]
async fn report_view() -> TextResourceContents {
    TextResourceContents::new("ui://report/view", "<!doctype html>…")
}

/// The data half. The id travels in the *result*, not in the resource URI.
#[tool(descr = "Show a report.", ui = "ui://report/view")]
async fn show_report(id: String) -> String {
    format!("Report {id}: all green.")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio().with_apps())
        .run()
        .await;
}
```

Neither `_meta.ui` nor a MIME type is set on the returned contents. The server
supplies both for a `ui://` read: the attribute's block falls back onto the
content item — the only place the tool-driven flow looks — and the app MIME type
is stamped on, since
[`TextResourceContents::new`](https://docs.rs/neva/latest/neva/types/struct.TextResourceContents.html#method.new)
would otherwise ship `text/plain`, which no host renders.

Return a block of your own with `TextResourceContents::with_ui(..)` when it
varies per response. That **replaces** the attribute's whole block rather than
merging into it — the precedence the specification gives a host.

Without macros, the same thing through
[`map_ui_resource`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_ui_resource),
which defaults the template's MIME type and registers a genuine template, so it
appears in `resources/templates/list`:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.map_ui_resource("ui://report/{id}", "report", |id: String| async move {
        TextResourceContents::new(
            format!("ui://report/{id}"),
            format!("<!doctype html><title>Report {id}</title>"),
        )
        .with_mime(APP_MIME_TYPE)
    });

    app.run().await;
}
```

:::warning The URI a tool points at must not be a template
A host fetches `_meta.ui.resourceUri` **verbatim** — nothing substitutes a tool
argument into it — so `ui://report/{id}` would be read as a literal and render a
report for `{id}`.

That is not a gap in the specification, it is its design: the document is the
static, cacheable, reviewable half, and the data arrives in the iframe as the
tool's result. **One document, every report.** Bind the tool to a concrete URI
and let the id travel in the result. The server warns about a templated binding
at startup.
:::

## Binding a tool to it

With the macro:

```rust
#[tool(descr = "Current weather", ui = "ui://weather/dashboard")]
async fn get_weather(city: String) -> String {
    format!("Sunny in {city}.")
}
```

Or on a manually registered tool, with
[`with_ui`](https://docs.rs/neva/latest/neva/types/struct.Tool.html#method.with_ui):

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.map_tool("get_weather", |city: String| async move {
        format!("Sunny in {city}.")
    })
        .with_arg_names(["city"])
        .with_ui("ui://weather/dashboard");

    app.run().await;
}
```

### Visibility: tools the app calls and the model never sees

A dashboard often needs a refresh button — a tool the iframe calls that has no
business in the agent's tool list. `visibility` says so:

```rust
#[tool(
    descr = "Re-read the clock.",
    ui = "ui://clock/app.html",
    visibility = ["app"]
)]
async fn refresh_clock() -> String {
    format!("The time is {}.", now())
}
```

The scopes are `"model"` and `"app"`; omitting `visibility` means both, which is
the specification's default.

:::warning Enforcement is the host's job, not the server's
An app-only tool is listed in `tools/list` like any other. What keeps it out of
the agent's tool list is the **host**, reading `_meta.ui.visibility`. This is a
UI affordance, not an access control — if a tool must not be called by an
untrusted caller, gate it with
[`with_roles`](./oauth#roles-and-permissions) or a middleware, exactly as you
would without a UI.
:::

## The security block

`_meta.ui` on the resource is what the host turns into a Content-Security-Policy
and an iframe `allow` attribute.

| Field | Type | Means |
|---|---|---|
| `csp.connectDomains` | `string[]` | Origins the app may `fetch` / open a socket to |
| `csp.resourceDomains` | `string[]` | Origins it may load scripts, styles, images and fonts from |
| `csp.frameDomains` | `string[]` | Origins it may embed in a nested frame |
| `csp.baseUriDomains` | `string[]` | Origins allowed in a `<base>` element |
| `permissions` | camera, microphone, geolocation, clipboardWrite | Browser permissions to *request* |
| `domain` | `string` | A dedicated sandbox origin — **host-defined format**, consult the host's docs |
| `prefersBorder` | `bool` | Whether the app wants a visible border and background |

Three things worth knowing:

* **Absent means the restrictive default.** An app that declares nothing gets no
  external access of any kind — the secure default, and the right one for a
  self-contained document.
* **Every origin belongs here, including your own.** The app runs sandboxed with
  no same-origin server, so wherever its own bundled scripts and styles come from
  has to be named too.
* **`permissions` are requests, not grants.** The host may ignore them, so
  feature-detect in the document rather than assuming.

In the builder form these are [`UiCsp`](https://docs.rs/neva/latest/neva/types/struct.UiCsp.html)
and [`UiPermissions`](https://docs.rs/neva/latest/neva/types/struct.UiPermissions.html);
in the attribute form, a JSON literal under `ui_meta`, checked at compile time.

## What the macros catch at compile time

`_meta` is an open map: a misspelled key serializes happily and is then ignored
by every host — a security block that silently does nothing. The macros close
that off while the literals are still in hand:

| You write | You get |
|---|---|
| `ui = "app.html"` | `ui` must be a `ui://` URI — the scheme is what marks a resource as an app |
| `visibility = ["agent"]` | Unknown visibility scope, expected one of: model, app |
| `ui_meta = r#"{ "prefers_border": true }"#` | Unknown key `prefers_border` — keys are camelCase on the wire |
| `ui_meta = r#"{ "csp": { "connect_domains": [] } }"#` | Unknown key in `ui_meta.csp` |
| `ui_meta = r#"{ "csp": [] }"#` | `ui_meta.csp` must be an object |
| `#[resource(uri = "ui://x", mime = "text/html")]` | A `ui://` resource is served as `text/html;profile=mcp-app` and nothing else |
| `ui_meta` on a non-`ui://` resource | The block only means anything on a `ui://` resource; hosts ignore it elsewhere |

:::info New in 0.5.6: unknown attributes are rejected
`#[tool]`, `#[resource]`, `#[resources]`, `#[prompt]` and `#[handler]` now
**reject** an attribute they do not know instead of ignoring it. The motivating
case is exactly this page's: a misspelled `visibility` used to publish an
app-only tool to the agent. If an existing macro invocation suddenly fails to
compile, the attribute was never doing anything.
:::

Two mistakes the macros cannot catch are checked at startup instead, and logged
as warnings: a tool pointing at a `ui://` resource **nothing serves** (the host's
`resources/read` would fail and the tool renders bare), and a `resourceUri`
carrying a template segment. `Tool::with_ui` — the non-macro path — is also where
a non-`ui://` scheme can still slip through, so it is warned about there too.

## Listing `ui://` resources

By default a `ui://` resource answers `resources/read` and stays **out of**
`resources/list`. The specification allows this — a host discovers apps through
the tool's `_meta.ui.resourceUri`, and a UI template is not something a user
browses.

Turn it on when you want hosts to be able to review each app's security block at
connection time, by registering the extension directly instead of through the
`with_apps()` wrapper:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio())
        .with_extension(AppsExtension::new().with_listed_resources());

    app.add_ui_resource("ui://clock/app.html", "clock", "<!doctype html>…")
        .with_title("Clock");

    app.run().await;
}
```

The switch is read when the server starts, so it applies to every
`add_ui_resource` regardless of the order the builder calls happen in.

## Authorization

A resource registered with `add_ui_resource` carries **no role or permission
requirement**: on an [OAuth-protected server](./oauth) anyone who can reach it
can read it.

That is usually right. The document is a template a host is expected to prefetch
and review at connection time, while the data it displays comes from a tool —
which does carry `with_roles`. When the markup itself must be restricted,
register it with `map_ui_resource` instead and put the requirement on the
returned `ResourceTemplate`. A per-resource requirement on `add_ui_resource` is
[tracked as #123](https://github.com/RomanEmreis/neva/issues/123).

## The View side

The document is an MCP client of its own, speaking JSON-RPC over `postMessage`,
and it opens the way any client does. The order is not decoration: a host **MUST
NOT** send anything to a View before it has seen `ui/notifications/initialized`,
and that notification only follows a completed `ui/initialize`. Skip either and a
conforming host holds the tool result back, leaving the document on its
placeholder.

```html
<script>
  // Registered before the handshake finishes: the host may send the result the
  // moment it sees `initialized`, and a listener added after that would miss it.
  on("ui/notifications/tool-result", (result) => {
    document.getElementById("out").textContent = result?.content?.[0]?.text;
  });

  await request("ui/initialize", {
    appInfo: { name: "Clock", version: "0.1.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: "2026-01-26",
  });
  notify("ui/notifications/initialized");
</script>
```

In practice you do not write this by hand — the browser SDK
([`@modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps))
does the handshake and hands you `ontoolresult`, `callServerTool` and
`getHostContext`. It is spelled out here because it is the half a Rust author
never sees in their own code and is therefore easy to forget to ship.

Note the protocol version: `2026-01-26` tracks the **MCP Apps** specification,
not the MCP one.

## Known gaps in 0.5.6

| Gap | Issue |
|---|---|
| A handler cannot yet ask whether the caller can render a UI, so it cannot vary its `content` by that. Answer well in text unconditionally — which the specification requires anyway | [#122](https://github.com/RomanEmreis/neva/issues/122) |
| Against a server speaking MCP 2026-07-28, a neva **client** advertises no extensions: that generation has no handshake to put them on | [#122](https://github.com/RomanEmreis/neva/issues/122) |
| `add_ui_resource` takes no role or permission requirement | [#123](https://github.com/RomanEmreis/neva/issues/123) |

## What's next

* [MCP Apps on the client](../mcp-client/apps) — declaring the capability and
  reading the metadata back
* [Tools](./tools) — everything a tool is, UI or not
* [Resources](./resources) — the general resource machinery `ui://` rides on
* [`examples/apps`](https://github.com/RomanEmreis/neva/tree/main/examples/apps) —
  a runnable server and client, including a View that completes the handshake
