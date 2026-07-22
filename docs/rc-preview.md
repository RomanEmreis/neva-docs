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
* **Multi Round-Trip Requests (MRTR).** A handler can pause mid-execution
  to ask the client for input: it calls `ctx.elicit(key, params)`,
  `ctx.sample(key, params)`, or `ctx.list_roots(key)` and awaits the
  answer. Progress lives in an AEAD-sealed `requestState` blob the client
  echoes on retry, so any request can land on any instance. Side effects
  must be wrapped in `ctx.once` / `ctx.memo` / `ctx.on_commit` because
  handlers re-run from the top each round. See
  [Input-request kinds](#input-request-kinds-elicitation-sampling-roots)
  below for how sampling and roots ride the same substrate.
* **JSON Schema 2020-12 for tools.** `Tool.input_schema` /
  `output_schema` carry a `serde_json::Value`-backed `InputSchema`; the
  `#[tool]` macro emits full 2020-12 documents.
* **Extensions framework.** New `Extension` trait; **Tasks** is the
  first built-in consumer (id `io.modelcontextprotocol/tasks`).
* **Server-side logging is compiled out.** neva's RC build drops both
  `logging/setLevel` and the server's `notifications/message` emission
  path (they are gated `#[cfg(not(proto-2026-07-28-rc))]`) — use the
  host's own telemetry pipeline instead. Note the spec itself is narrower:
  the 2026-07-28 draft only *removes* `logging/setLevel` and keeps
  `notifications/message` as a request-scoped, **deprecated** notification
  gated on `_meta["io.modelcontextprotocol/logLevel"]`. neva does not
  implement that request-scoped path yet.

## Input-request kinds: elicitation, sampling, roots

The 2026-07-28 spec did not delete sampling and roots — it removed them as
**capability-driven server→client requests** and re-homed the ability onto
MRTR as **input-request kinds**, alongside elicitation. On the wire an
input request is still a `{ method, params }` envelope; `method` is the
discriminator (`elicitation/create`, `sampling/createMessage`,
`roots/list`).

* **Elicitation** is first-class.
* **Sampling** and **roots** return under the RC flag, but — matching the
  spec's own 12-month lifecycle — **already deprecated**. The APIs carry
  `#[deprecated]` and exist for migration; call sites need
  `#[allow(deprecated)]`.

The mechanics are identical across kinds, so `once` / `memo` / `on_commit`
cover them for free:

* **Server** — `ctx.sample(key, params)` borrows the client's model and
  `ctx.list_roots(key)` reads its roots, both replaying from the encrypted
  `requestState` on the next round, exactly like `ctx.elicit`.
* **Client** — sampling is fulfilled by the client's `map_sampling`
  handler and roots from its configured list, both inside the client's
  round-trip loop (the caller of `call_tool` still sees one call). The
  legacy server-push `SamplingHandler` channel stays gone; the
  `#[sampling]` attribute macro belongs to that push model and is **not**
  available under the RC flag — wire the handler with `map_sampling`.
* **Capabilities** — `ClientMrtrCapabilities` carries `elicitation`,
  `sampling`, and `roots` flags. A non-empty roots list or a registered
  `map_sampling` handler makes the client declare the matching flag; the
  server gates each kind on its own flag and reports a request for an
  undeclared kind instead of stalling the round-trip. The flags are
  additive, so a peer that only sends `elicitation` still decodes.

:::note API shape (breaking within the RC surface)
The generalized input request replaced `mrtr::ElicitationInputRequest`
with the `mrtr::InputRequest` union
(`InputRequest::Elicitation(params)` / `Sampling` / `Roots`), and
`mrtr::InputResponses` is now `HashMap<String, serde_json::Value>` — the
result type depends on the requested kind, so deserialize your own type
out of the value. The wire format is unchanged; only the RC (non-semver)
Rust API moved.
:::

## Where to look right now

* **[Release notes (v0.4.0)](https://github.com/RomanEmreis/neva/releases/tag/0.4.0)** — narrative, migration, deployment notes.
* **[`examples/mrtr`](https://github.com/RomanEmreis/neva/tree/main/examples/mrtr)** — end-to-end MRTR server + client.
* **[`examples/sampling/rc`](https://github.com/RomanEmreis/neva/tree/main/examples/sampling/rc)** / **[`examples/roots/rc`](https://github.com/RomanEmreis/neva/tree/main/examples/roots/rc)** — the sampling and roots kinds on the MRTR substrate. Each `rc/` directory is its own Cargo workspace so the RC flag stays off the legacy crates.
* **`cargo doc --features proto-2026-07-28-rc --open`** — generates the
  API reference for the RC surface in your own checkout.

## Deployment must-do for multi-instance HTTP

Two shared resources, both required:

1. `App::with_request_state_secret(<shared secret>)` — without it,
   cross-instance retries fail to decrypt `requestState`. neva warns at
   startup if you forget. neva **seals** `requestState` with
   ChaCha20-Poly1305 rather than merely signing it: the AEAD tag
   authenticates the blob exactly as an HMAC would, but a signed state
   would still be *readable*, and `ctx.memo` writes server-computed values
   (an upstream response, a quoted price, a downstream token) into it for
   the next round to replay. Confidentiality costs nothing here, so the
   secret upholds it, not just integrity — treat it as a secret and rotate
   it via `App::with_request_state_keys`.
2. `App::with_request_state_store(<shared store>)` — without it,
   lost-response retries re-run the handler and double-fire
   `on_commit`. Default `InMemoryStateStore` is per-process; implement
   `RequestStateStore` over Redis or similar for production.
