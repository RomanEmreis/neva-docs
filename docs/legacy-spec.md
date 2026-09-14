---
sidebar_position: 99
---

# Legacy spec and upgrade paths

This page covers the `legacy-spec` profile and the release-to-release upgrades.
Day-to-day reference lives on the other pages; version-specific detail lives
here and in the [CHANGELOG](https://github.com/RomanEmreis/neva/blob/main/CHANGELOG.md).

`legacy-spec` is the opt-in Cargo feature that restores the **pre-2026-07-28**
protocol generation — MCP 2024-11-05 … 2025-11-25.

```toml
[dependencies]
neva = { version = "0.6", features = ["server-full", "legacy-spec"] }
```

It is a **generation switch, not an addition**: enabling it compiles the
[MCP 2026-07-28](./spec-2026-07-28) surface *out*. The two generations never
coexist in one build.

:::warning `--all-features` selects the legacy profile
Cargo features are additive, so `--all-features` turns `legacy-spec` on and
therefore exercises the *legacy* profile. The default profile needs an
explicit feature list — e.g. `--features "server-full client-full"` or
`--features full`. This is also why `docs.rs` publishes neva with
`features = ["full"]` rather than all features.
:::

## What `legacy-spec` restores

| Area | Legacy behavior |
|---|---|
| Handshake | `initialize` / `initialized`, with `serverInfo` in `InitializeResult` |
| Transport | Session-bound Streamable HTTP: `Mcp-Session-Id`, session `DELETE`, [SSE `GET` streams](#concurrent-sse-streams) with `Last-Event-ID` replay — as many at once as the client opens |
| Stream resumption | A dropped `POST` response stream is resumed once, with a `GET` carrying `Last-Event-ID` after the pause the server asked for — only when the server named an id to resume from. Each stream keeps its own cursor and its own reconnection delay, taken from that stream's SSE `retry:` field rather than a fixed three seconds |
| Version selection | `with_mcp_version(...)` on the **server** |
| Server→client requests | Capability-driven push for `sampling/createMessage`, `roots/list`, `elicitation/create` — no MRTR |
| Macros | The `#[sampling]` attribute macro |
| Logging | `logging/setLevel` plus `with_logging(handle)` and a global `notifications/message` emission path |
| Tools | The legacy `ToolSchema` (not JSON Schema 2020-12) |
| Tasks | The 2025-11-25 surface: `tasks/list`, `tasks/result`, the `cancel`/`list`/`requests` capability sub-tree, `with_tasks(|t| …)`, client-hosted tasks |
| Notifications | `ping`, `notifications/roots/list_changed`, `notifications/elicitation/complete` |
| Subscriptions | The `resources/subscribe` / `resources/unsubscribe` RPC pair, `Context::subscribe_to_resource` / `unsubscribe_from_resource`, and `resource::commands::{SUBSCRIBE, UNSUBSCRIBE}` — server-side subscription state instead of a `subscriptions/listen` stream |
| Requests | No mandatory `_meta` keys, no routing-header validation, no `resultType` |
| [MCP Apps](./mcp-server/apps) | **Nothing** — the server half is compiled out, since the extension rides `capabilities.extensions`, which this generation has no place for. The [client half](./mcp-client/apps) does work: a legacy `initialize` carries the declaration on every connection, where a 2026-07-28 one puts it on [each request's `_meta`](./spec-2026-07-28#capabilities-ride-each-request) instead |

Everything else — DI, middleware, content types, JWT auth, TLS, custom HTTP
engines, batch requests — is shared between the two generations and behaves
the same either way.

## Concurrent SSE streams

The spec lets a client "remain connected to multiple SSE streams
simultaneously", and asks for event ids assigned "on a per-stream basis, to act
as a cursor within that particular stream". A session therefore holds a **map**
of streams, each with its own sender, cursor and replay buffer, and every
tracked event id names the stream it belongs to:

```
id: 0:7
```

`<stream>:<seq>`. That is what makes the rest of the rules enforceable.

| A `GET` on the session endpoint | What it gets |
|---|---|
| With a `Last-Event-ID` | Resumes **the stream that id names**, replayed that stream's backlog past the cursor and nothing that went out on another one |
| With a `Last-Event-ID` naming a stream the session does not hold | `404` — answering from whatever stream is at hand would replay what was delivered elsewhere |
| Without one, nothing connected to the standalone stream | That stream, which is the one carrying server-initiated traffic |
| Without one, the standalone stream already live | A **second** stream. The first stays open, and the server-initiated traffic moves onto the newer one |
| When the session already holds 8 streams | `429`. A disconnected stream is dropped to make room first, so the cap is spent on live ones |

Server-initiated traffic — log notifications included — rides exactly one
stream at a time, which is the spec's MUST NOT on delivering a message on more
than one. It follows the newest live stream; with nothing live the role stays
put, so an ordinary reconnect takes that stream back and is replayed what it
missed while the connection was down.

:::info Ids that name no stream still resume
An id in the older per-session shape — `<seq>`, with no stream — is read as the
standalone stream's cursor while the session holds only that one, so a client
reconnecting across a server upgrade resumes rather than starting over. neva's
own client is unaffected either way: it echoes back whatever id it was handed.

Custom HTTP engines take one signature change:
[`tracked_event`](./mcp-server/custom-http#the-httpengine-contract) is handed an
`EventId` instead of a `u64`.
:::

## Talking to a legacy peer *without* `legacy-spec`

You usually don't need the flag on the client. neva's default-build client
is **dual-mode**: it opens with `server/discover` and, if the peer clearly
does not speak MCP 2026-07-28, falls back to the `initialize` handshake and
speaks legacy to that peer for the rest of the connection. See
[Discovery replaces the handshake](./spec-2026-07-28#discovery-replaces-the-handshake).

The **server** side has no such fallback — it is compile-time pure. A server
that must serve legacy clients needs the `legacy-spec` build.

## Upgrading 0.5.x → 0.6.0 {#migrating-to-060}

Two calls changed. Both fail the build rather than changing behaviour quietly,
so there is nothing to audit by eye.

### `UiResource::with_permissions` was renamed

On a [`UiResource`](./mcp-server/apps#serving-the-document), `with_permissions`
sets **who may read the resource**, as it does on every other resource. The
iframe's browser permissions are `with_ui_permissions`:

```rust
// before
app.add_ui_resource("ui://scan/app.html", "scan", html)
    .with_permissions(UiPermissions::new().with_camera());

// after
app.add_ui_resource("ui://scan/app.html", "scan", html)
    .with_ui_permissions(UiPermissions::new().with_camera());
```

`UiResourceMeta::with_permissions` is unaffected.

### Registration methods take one more generic parameter

Every registration point carries a **handler-shape marker** as a generic
parameter — it is what lets one call accept both an
[`async fn` and a plain `fn`](./mcp-server/handlers). It is always inferred, so
only a call site that spells its generics out by hand is affected:

```rust
// before
app.map_tool::<_, _, (String,)>("greet", greet);

// after — E0107 until the marker is added
app.map_tool::<_, _, (String,), _>("greet", greet);
```

Affected: `App::map_tool`, `map_prompt`, `map_resource`, `map_ui_resource`,
`map_handler`, `map_resources`, `map_completion`, `Tool::new` and `Prompt::new`.
`Client::map_sampling` and `Client::map_elicitation` keep their arity, but their
second parameter is the marker rather than the handler's future type.

**Bounds are unaffected.** The marker is defaulted on the traits
(`ToolHandler<Args, M = marker::Async>`), so `where F: ToolHandler<Args, Output = R>`
keeps its meaning — as does every call site that leaves inference to do its job.

## Upgrading 0.4.x → 0.5.0 {#migrating-to-050}

| You were on 0.4.x with… | Do this |
|---|---|
| `features = ["proto-2026-07-28-rc"]` | **Drop the flag.** It no longer exists — what it gated is now the default. |
| The old default (no protocol flag) | Add `legacy-spec` to keep the old wire, or migrate to [MCP 2026-07-28](./spec-2026-07-28). |

Beyond the flag, the code changes worth checking:

* **Tasks** — `opt.with_tasks()` takes no closure; `list_tasks()` is gone
  (poll `tasks/get` instead); `Task::ttl` serializes as `ttlMs` and is now
  `Option<usize>`. See [Tasks](./mcp-server/tasks).
* **Results** — every success result now carries `resultType`. If you parse
  raw responses, read it via `Response::result_type()`.
* **HTTP engine adapters** — `SseResponse` is renamed to `StreamResponse`
  (its `Status` variant to `Complete`), and `handlers::dispatch_post`
  returns `StreamResponse<…>` instead of a plain response. See
  [Custom HTTP Stack](./mcp-server/custom-http).
* **Removed calls** — `ping`, `complete_elicitation`,
  `on_elicitation_completed`, `with_logging` / `set_log_level`.
* **Resource subscriptions** — `resources/subscribe` / `resources/unsubscribe`
  are folded into the [`subscriptions/listen`](./spec-2026-07-28#subscriptions)
  filter. Replace `client.subscribe_to_resource(uri)` with
  `client.listen(SubscriptionFilter::new().with_resource(uri))`, and drop
  `ctx.subscribe_to_resource(..)` from server handlers — the client owns the
  subscription now. See [Subscriptions](./mcp-client/subscriptions).
* **Sampling & roots** — still available, but as
  [MRTR input-request kinds](./spec-2026-07-28#input-request-kinds-elicitation-sampling-roots)
  and `#[deprecated]`. The `#[sampling]` attribute macro belongs to the
  legacy push model and is not available in the default build; wire the
  handler with `map_sampling`.

## Examples

The legacy variants of the roots and sampling examples live under a
`legacy/` sub-directory, each its own Cargo workspace (Cargo unifies
features across members built together, so a shared workspace would flip the
generation for every crate in it):

* [`examples/roots/legacy/{server,client}`](https://github.com/RomanEmreis/neva/tree/main/examples/roots/legacy)
* [`examples/sampling/legacy/{server,client}`](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/legacy)
