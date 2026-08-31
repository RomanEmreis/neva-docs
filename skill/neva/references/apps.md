# MCP Apps — giving a tool a UI

MCP Apps ([SEP-1865](https://github.com/modelcontextprotocol/ext-apps)) is
the first official MCP extension, advertised as
`capabilities.extensions["io.modelcontextprotocol/ui"]`. A tool points at a
`ui://` HTML document; the host renders it in a sandboxed iframe and feeds
the tool's result into it.

Behind the `apps` feature, which is in `server-full` and `client-full`.
Additive — it pulls in no new dependencies.

```toml
neva = { version = "0.5", features = ["server-macros", "apps"] }
```

## The single most important fact

**A neva server never sends or receives a `ui/*` message.** The
specification has two halves and only one is MCP traffic:

| Half | Between | Transport | neva |
|---|---|---|---|
| Data plane | server ↔ client | MCP JSON-RPC | Implements it — `_meta.ui` blocks on tools and resources |
| Presentation plane | host ↔ iframe | JSON-RPC over `postMessage` | Models none of it |

`ui/initialize`, `ui/notifications/tool-result`, `ui/open-link`, the sandbox
proxy, host context, theming, display modes — all browser traffic. Do not go
looking for a neva API for any of it, and do not write one. The server serves
a tool and an HTML document.

## Non-negotiables for MCP Apps

1. **A UI-bound tool MUST still return a meaningful `content` array.** The
   model reads `content`; the iframe is for humans, and not every client has
   one. Return `"The time is 12:00:00 UTC."`, not `"12:00:00"`.

2. **`_meta.ui.resourceUri` must not be a template.** A host fetches it
   verbatim — nothing substitutes tool arguments into it. `ui://report/{id}`
   renders a report for the literal `{id}`. One static document; the data
   arrives as the tool's result.

3. **`visibility` is not access control.** An app-only tool is listed in
   `tools/list` like any other; the *host* keeps it out of the agent's list.
   If a tool must not be called by an untrusted caller, gate it with
   `with_roles` or middleware, exactly as you would without a UI.

4. **An absent `_meta.ui` is the restrictive default**, not "unspecified,
   therefore allow": no external access of any kind.

5. **The server half is 2026-07-28 only.** `with_apps()`,
   `add_ui_resource` and `map_ui_resource` are compiled out under
   `legacy-spec`. The client half works in both profiles.

## A complete server

```rust
use neva::prelude::*;

/// A sentence, not a bare timestamp — see non-negotiable 1.
#[tool(descr = "The current time.", ui = "ui://clock/app.html")]
async fn get_time() -> String {
    format!("The time is {}.", now())
}

/// A tool the iframe calls and the model never sees.
#[tool(
    descr = "Re-read the clock.",
    ui = "ui://clock/app.html",
    visibility = ["app"]
)]
async fn refresh_clock() -> String {
    format!("The time is {}.", now())
}

fn now() -> String {
    "12:00:00 UTC".into()
}

#[tokio::main]
async fn main() {
    let mut app = App::new().with_options(|opt| opt
        .with_stdio()
        .with_name("Clock")
        .with_version("0.1.0")
        // Without this the `_meta.ui` blocks below mean nothing to a host.
        .with_apps());

    app.add_ui_resource("ui://clock/app.html", "clock", "<!doctype html>…")
        .with_title("Clock")
        .with_descr("A ticking clock")
        .with_prefers_border(true);

    app.run().await;
}
```

`add_ui_resource` registers the `ui://` read handler and stamps
`text/html;profile=mcp-app`. The returned `&mut` stays live for the whole
chain — the resource is materialized when the server starts, so a builder
called later still counts.

## Serving the document

### Fixed HTML

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new().with_options(|opt| opt.with_stdio().with_apps());

    app.add_ui_resource("ui://weather/dashboard", "dashboard", "<!doctype html>…")
        .with_title("Weather dashboard")
        .with_csp(UiCsp::new()
            .with_connect_domains(["https://api.openweathermap.org"])
            .with_resource_domains(["https://cdn.jsdelivr.net"]))
        .with_permissions(UiPermissions::new().with_geolocation())
        .with_domain("a904794854a047f6.example-host.com")
        .with_prefers_border(true);

    app.run().await;
}
```

`with_ui(UiResourceMeta)` replaces the whole block at once, for a block
built elsewhere.

### Generated HTML

Register it as an ordinary resource. The `ui://` scheme is what marks it as
an app; the macro supplies the MIME type and validates `ui_meta` at compile
time.

```rust
use neva::prelude::*;

#[resource(
    uri = "ui://report/view",
    title = "Report",
    ui_meta = r#"{
        "csp": { "resourceDomains": ["https://cdn.jsdelivr.net"] },
        "prefersBorder": false
    }"#
)]
async fn report_view() -> TextResourceContents {
    // No `_meta.ui` and no MIME type here: the server supplies both for a
    // `ui://` read. `TextResourceContents::new` would otherwise ship
    // `text/plain`, which no host renders.
    TextResourceContents::new("ui://report/view", "<!doctype html>…")
}

/// The id travels in the *result*, not in the resource URI.
#[tool(descr = "Show a report.", ui = "ui://report/view")]
async fn show_report(id: String) -> String {
    format!("Report {id}: all green.")
}

#[tokio::main]
async fn main() {
    App::new().with_options(|opt| opt.with_stdio().with_apps()).run().await;
}
```

`TextResourceContents::with_ui(..)` on the returned contents **replaces**
the attribute's block rather than merging into it — that is the precedence
a host applies.

Without macros, `map_ui_resource` does the same and registers a genuine
template (so it shows up in `resources/templates/list`):

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new().with_options(|opt| opt.with_stdio().with_apps());

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

Note the asymmetry this creates, and do not confuse the two: a *template*
may be `ui://report/{id}`, but the `resourceUri` a **tool** points at may
not (non-negotiable 2).

## Binding a tool without the macro

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new().with_options(|opt| opt.with_stdio().with_apps());

    app.map_tool("get_weather", |city: String| async move {
        format!("Sunny in {city}.")
    })
        .with_arg_names(["city"])
        .with_ui("ui://weather/dashboard");

    // A refresh button for the iframe, invisible to the model.
    app.map_tool("refresh_dashboard", || async { "refreshed" })
        .with_ui("ui://weather/dashboard")
        .with_visibility([UiVisibility::App]);

    app.run().await;
}
```

`Tool::with_ui` accepts any URI, unlike the macro — a non-`ui://` scheme is
caught only as a startup warning.

## The `_meta.ui` security block

| Field | Type | Means |
|---|---|---|
| `csp.connectDomains` | `string[]` | Origins the app may `fetch` / open a socket to |
| `csp.resourceDomains` | `string[]` | Origins for scripts, styles, images, fonts |
| `csp.frameDomains` | `string[]` | Origins it may embed in a nested frame |
| `csp.baseUriDomains` | `string[]` | Origins allowed in `<base>` |
| `permissions` | `camera`, `microphone`, `geolocation`, `clipboardWrite` | Browser permissions to **request** — the host may ignore them |
| `domain` | `string` | A dedicated sandbox origin. **Host-defined format** — do not invent one |
| `prefersBorder` | `bool` | Whether the app wants a visible border and background |

Every origin the app touches goes in, **including wherever its own bundled
scripts and styles are served from** — it runs sandboxed with no same-origin
server.

Builder types: `UiCsp`, `UiPermissions`, `UiResourceMeta`. Attribute form: a
JSON literal under `ui_meta`, camelCase keys.

## What the macros reject at compile time

`_meta` is an open map, so a typo would serialize happily and then be
ignored by every host — a security block that silently does nothing. The
macros make these compile errors:

| Written | Rejected because |
|---|---|
| `ui = "app.html"` | Not a `ui://` URI |
| `visibility = ["agent"]` | Unknown scope; only `model` and `app` exist |
| `ui_meta = r#"{ "prefers_border": true }"#` | Unknown key — the wire is camelCase |
| `ui_meta = r#"{ "csp": { "connect_domains": [] } }"#` | Unknown key in `ui_meta.csp` |
| `ui_meta = r#"{ "csp": [] }"#` | `ui_meta.csp` must be an object |
| `ui_meta = r#"{ "domain": 1 }"#` | `ui_meta.domain` must be a string |
| `#[resource(uri = "ui://x", mime = "text/html")]` | A `ui://` resource is served as `text/html;profile=mcp-app` and nothing else |
| `ui_meta` on a non-`ui://` resource | The block means nothing there |

**Changed in 0.5.6:** `#[tool]`, `#[resource]`, `#[resources]`, `#[prompt]`
and `#[handler]` now reject *any* unknown attribute instead of ignoring it.
A misspelled `visibility` used to publish an app-only tool to the agent. If
an existing macro invocation stops compiling after the upgrade, the
attribute it names was never doing anything — fix the spelling or delete it.

Two mistakes survive to startup and are logged as warnings there: a tool
pointing at a `ui://` resource nothing serves, and a `resourceUri` carrying
a template segment.

## Listing `ui://` resources

Off by default: a `ui://` resource answers `resources/read` and stays out of
`resources/list`, because hosts discover apps through tool metadata. To list
them anyway — so hosts can review each security block at connection time —
register the extension directly instead of using `with_apps()`:

```rust
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

`with_apps()` *is* `with_extension(AppsExtension::new())` — use one or the
other, not both.

## Authorization

`add_ui_resource` carries **no** role or permission requirement: on an
OAuth-protected server anyone who can reach it can read it. That is usually
right — the document is a template a host prefetches and reviews, while the
data comes from a tool, which does carry `with_roles`. To restrict the
markup itself, register it with `map_ui_resource` and put the requirement on
the returned `ResourceTemplate`. Tracked as
[#123](https://github.com/RomanEmreis/neva/issues/123).

## The client half

Works in both protocol profiles.

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new().with_options(|opt| opt
        .with_stdio("my-server-binary", ["--flag"])
        // Advertises `io.modelcontextprotocol/ui` with
        // `mimeTypes: ["text/html;profile=mcp-app"]`.
        .with_apps());

    client.connect().await?;

    let tools = client.list_tools(None).await?;

    for tool in tools.tools.iter() {
        let Some(ui) = tool.ui() else { continue };
        // A host MUST NOT put an app-only tool in the agent's tool list.
        if !tool.is_model_visible() {
            continue;
        }
        println!("{} -> {:?}", tool.name, ui.resource_uri);
    }

    // The `resources/read` a host makes before opening an iframe.
    if let Some(uri) = tools
        .get("get_time")
        .and_then(|tool| tool.ui())
        .and_then(|ui| ui.resource_uri)
    {
        let result = client.read_resource(uri).await?;
        for contents in result.contents.iter() {
            println!("{} [{}]", contents.uri(), contents.mime().unwrap_or("?"));
            println!("  _meta.ui: {:?}", contents.ui());
        }
    }

    client.disconnect().await
}
```

| Call | Purpose |
|---|---|
| `opt.with_apps()` | Declares the extension with the one content type the spec defines |
| `opt.with_app_mime_types([..])` | The general form, for a client rendering something else |
| `tool.ui()` | `Option<UiToolMeta>` — `resource_uri`, `visibility` |
| `tool.is_model_visible()` / `is_app_visible()` | Both `true` for a tool with no Apps metadata, and for one that omits `visibility` |
| `contents.ui()` | `Option<UiResourceMeta>` off a `resources/read` result |

`mimeTypes` is **required** by the spec, which is why the client method
fills it in while the server advertises `{}`. A client that names none has
not declared support.

Declaring it is a promise about *rendering*. A neva client is not a browser
— make the declaration when this process embeds a webview or is a host
handing the document to one, not merely to read the metadata, which works
without it.

`ui()` is lenient in one direction and strict in the other: it also accepts
the deprecated flat `_meta["ui/resourceUri"]` key (the nested block wins
where both are present), and a malformed block reads as absent rather than
failing the surrounding `tools/list`. The **visibility predicates do not
share that leniency** — an explicit `visibility` that cannot be decoded
denies, so a garbled block can never promote an app-only tool into the
agent's list.

**Changed in 0.5.6:** `ResourceContents`'s accessors — `uri`, `text`,
`blob`, `json`, `mime`, `title`, `annotations` — are available to a client
build. They used to be server-only. The builders stay server-side.

## The View side (what ships inside the HTML)

The document is an MCP client speaking JSON-RPC over `postMessage`. The host
**MUST NOT** send it anything before `ui/notifications/initialized`, which
only follows a completed `ui/initialize`. Skip either and the tool result
never arrives — the app sits on its placeholder forever, with nothing in the
server logs to show for it.

```html
<script>
  // Registered BEFORE the handshake: the host may push the result the moment
  // it sees `initialized`, and a later listener misses it.
  on("ui/notifications/tool-result", (r) => {
    document.getElementById("out").textContent = r?.content?.[0]?.text;
  });

  await request("ui/initialize", {
    appInfo: { name: "Clock", version: "0.1.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },  // required
    protocolVersion: "2026-01-26",   // the MCP Apps spec version, not MCP's
  });
  notify("ui/notifications/initialized");
</script>
```

In real apps this is the browser SDK
(`@modelcontextprotocol/ext-apps`), which gives you `ontoolresult`,
`callServerTool` and `getHostContext`. Recommend it rather than hand-rolling
the transport; the point of showing it here is that a Rust author never sees
this half in their own code and therefore forgets to ship it.

## Gaps in 0.5.6

| Gap | Consequence for code you write |
|---|---|
| No `Context::supports_apps()` — a handler cannot vary its answer by whether the caller can render ([#122](https://github.com/RomanEmreis/neva/issues/122)) | Answer well in text unconditionally. Do not invent an API for this |
| A client speaking 2026-07-28 advertises no extensions — that generation has no handshake to carry them ([#122](https://github.com/RomanEmreis/neva/issues/122)) | A server cannot detect Apps support. Under `legacy-spec` the `initialize` handshake does carry it |
| `add_ui_resource` takes no role requirement ([#123](https://github.com/RomanEmreis/neva/issues/123)) | Use `map_ui_resource` + `ResourceTemplate` when the markup must be restricted |

## Symptom → cause

| Symptom | Cause |
|---|---|
| The host renders nothing; the tool result is plain text | `with_apps()` was never called, so the extension is not advertised |
| `resources/read` on the `ui://` URI fails | Nothing serves it. Register with `add_ui_resource` / `map_ui_resource` — the startup warning names the tool |
| The document loads but stays on its placeholder | The View never completed `ui/initialize` → `ui/notifications/initialized`, or registered its result listener after the handshake |
| The app renders as plain text, unstyled | MIME type is not `text/html;profile=mcp-app`. A hand-built `TextResourceContents` on a non-`ui://` URI ships `text/plain` |
| A CSP setting appears to be ignored | A snake_case key in a hand-written `_meta`. The macro's `ui_meta` catches this; a hand-built `serde_json::json!` does not |
| Fetches from the app are blocked | The origin is not in `csp.connectDomains` — including your own asset host |
| An app-only tool shows up in the agent's tool list | Expected on the server; the host filters. Check `is_model_visible()` on the host side |
| A tool was published to the agent despite `visibility` | Pre-0.5.6, a misspelled attribute was ignored. Upgrade — it is now a compile error |
| The app renders one report for every id | The tool's `resourceUri` is a template. Point it at a concrete document and put the id in the result |
| `with_apps` / `add_ui_resource` not found | Either the `apps` feature is off, or the build has `legacy-spec` on (which includes `--all-features`) |
