---
sidebar_position: 99
---

# MCP 2026-07-28 RC preview

neva 0.4 ships **opt-in** support for the MCP 2026-07-28 Release
Candidate spec behind the compile-time `proto-2026-07-28-rc` feature
flag. The legacy spec remains the default and the rest of this site
documents it.

:::caution RC status
Wire format and APIs gated by `proto-2026-07-28-rc` are **not** covered
by semver and may change before the final spec ships
(scheduled 2026-07-28). When the RC graduates the flag will invert —
the RC path becomes the default and the current default moves under a
`legacy-spec` flag.
:::

## What changes under the flag

* **Stateless HTTP transport.** `initialize`/`initialized` handshake is
  replaced by a single `server/discover` request. No `Mcp-Session-Id`
  on the wire; every POST carries a required `MCP-Protocol-Version`
  header. Server-initiated notifications are inert — clients poll.
* **Multi Round-Trip Requests (MRTR) for elicitation.** Handlers call
  `ctx.elicit(key, params).await?`; progress lives in an AEAD-sealed
  `requestState` blob the client echoes on retry, so any request can
  land on any instance. Side effects must be wrapped in `ctx.once` /
  `ctx.memo` / `ctx.on_commit` because handlers re-run each round.
* **JSON Schema 2020-12 for tools.** `Tool.input_schema` /
  `output_schema` carry a `serde_json::Value`-backed `InputSchema`; the
  `#[tool]` macro emits full 2020-12 documents.
* **Extensions framework.** New `Extension` trait; **Tasks** is the
  first built-in consumer (id `io.modelcontextprotocol/tasks`).
* **Removed:** `roots/list`, `sampling/createMessage`,
  `logging/setLevel`. Their host-side replacements: out-of-band roots,
  host-provided tool for sampling, host's own telemetry for logging.

## Where to look right now

* **[Release notes (v0.4.0)](https://github.com/RomanEmreis/neva/releases/tag/v0.4.0)** — narrative, migration, deployment notes.
* **[`examples/mrtr`](https://github.com/RomanEmreis/neva/tree/main/examples/mrtr)** — end-to-end MRTR server + client.
* **`cargo doc --features proto-2026-07-28-rc --open`** — generates the
  API reference for the RC surface in your own checkout.

## Deployment must-do for multi-instance HTTP

Two shared resources, both required:

1. `App::with_request_state_secret(<shared secret>)` — without it,
   cross-instance retries fail to decrypt `requestState`. neva warns at
   startup if you forget.
2. `App::with_request_state_store(<shared store>)` — without it,
   lost-response retries re-run the handler and double-fire
   `on_commit`. Default `InMemoryStateStore` is per-process; implement
   `RequestStateStore` over Redis or similar for production.
