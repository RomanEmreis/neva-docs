---
sidebar_position: 22
---

# MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io) is how a server is
found and installed: an author publishes a `server.json` under a namespace they
have proved they own, and clients read the listing to know what to install and
how to run it.

Most of what goes in that document the server already knows — the version it
reports, the transport it is configured with, the crate Cargo is building — so
neva writes it out instead of leaving it to be typed by hand and to drift on
the next release.

```toml
[dependencies]
neva = { version = "...", features = ["server-macros", "registry"] }
```

`registry` is part of [`server-full`](../features#presets). It adds types and a
validator and no new dependencies, and is opt-in so an embedded server does not
carry them.

## Emit the manifest from the server itself

The manifest is a build output, not a file you maintain. Give the binary a flag
that prints it, and the published version is the version you just built:

```rust compile
use neva::prelude::*;

#[tool(descr = "Returns the forecast for a city")]
async fn forecast(city: String) -> String {
    format!("Sunny in {city}, as ever")
}

#[tokio::main]
async fn main() {
    let app = App::new().with_options(|opt| opt
        .with_stdio()
        .with_name("weather")
        .with_version(env!("CARGO_PKG_VERSION")));

    if std::env::args().any(|arg| arg == "--emit-manifest") {
        // What the app knows, plus what Cargo knows about this crate.
        match neva::server_manifest!(app, "io.github.romanemreis/weather").to_json() {
            Ok(json) => print!("{json}"),
            Err(err) => {
                eprintln!("this server.json is not the shape the schema asks for: {err}");
                std::process::exit(1);
            }
        }
        return;
    }

    app.run().await;
}
```

```bash
cargo run -- --emit-manifest > server.json
```

Exiting non-zero on an invalid manifest is the point of doing it here: a
release that cannot produce a valid `server.json` fails in the build that
produced it rather than at the upload.

## The name is the one thing never derived

:::warning The registry name is not the MCP server name
`with_name("weather")` sets the **MCP** server name — what `serverInfo` carries
and what a user sees in a client. The registry's `name` is a reverse-DNS
identifier inside a namespace you have proved you own:
`io.github.<user>/<server>`.

They are different strings under different rules, and passing one where the
other belongs produces a manifest that fails namespace verification. That is
why `server_manifest(name)` always takes it explicitly.
:::

## What is derived, and what you say

| Field | Comes from |
|---|---|
| `version` | `with_version(..)`, or the crate version via `with_cargo` |
| `packages[].transport` | The transport the app is configured with |
| `packages[]` (cargo entry) | `with_cargo` / `with_cargo_package` — crate name and version |
| `description` | `Cargo.toml`'s `description`, unless `with_description` set one first |
| `repository` | `Cargo.toml`'s `repository`, when it is a github.com or gitlab.com URL |
| `websiteUrl` | `Cargo.toml`'s `homepage` |
| `name` | Always yours — see above |
| `title`, `icons`, `_meta` | Always yours |

`with_cargo` never overwrites something already set, so the way to say
something different from what Cargo says is to say it **before** the
`with_cargo` call.

```rust compile
use neva::prelude::*;
use neva::registry::KeyValueInput;

fn main() {
    let app = App::new().with_options(|opt| opt
        .with_stdio()
        .with_name("weather")
        .with_version("0.3.0"));

    let manifest = app
        .server_manifest("io.github.romanemreis/weather")
        .with_title("Weather")
        // Said before `with_cargo_package`, so the crate description does not
        // win: the registry allows 100 characters, crates.io does not care.
        .with_description("Forecasts from the national weather service")
        .with_cargo_package(neva::cargo_env!(), |package| package
            .with_environment_variable(
                KeyValueInput::new("WEATHER_API_KEY")
                    .with_description("API key for the weather provider")
                    .required()
                    .secret()));

    print!("{}", manifest.to_json().expect("a complete manifest"));
}
```

[`cargo_env!()`](https://docs.rs/neva/latest/neva/macro.cargo_env.html) is a
macro rather than a function because `CARGO_PKG_*` are compile-time values of
**your** crate — a function inside neva would read neva's. It works in a
`build.rs` too, which is the other place a manifest is often written.

### The version rule

`App::server_manifest` publishes the version only when
[`with_version`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_version)
was actually called — not when the value merely looks set. An app that never
called it reports *neva's* version, and publishing the SDK's version as the
server's is the kind of wrong nobody notices. In that case the field is left
for `with_cargo` to fill from the crate, and refused by validation if nothing
does.

A version deliberately set to whatever neva happens to be at is still yours and
is kept.

### The transport rule

The package entry says how a client talks to what it installs, and that is read
off the app:

* `with_stdio()` → `"transport": { "type": "stdio" }`, which is what
  `cargo install` leaves behind — a binary on `PATH` the client spawns.
* `with_http(..)` / `with_default_http()` → `streamable-http` at the URL the
  server answers on. A wildcard bind becomes the address a client can actually
  dial: `0.0.0.0:3000` is published as `127.0.0.1:3000`, `[::]` as `[::1]`.

An app with **no** transport configured yields no transport at all rather than
a defaulted `stdio`: such a server cannot start, so publishing an install for
it would be publishing something that cannot work. Validation says so.

## Shaping the package

What a client needs in order to run the server goes on the package entry:

| Builder | For |
|---|---|
| `with_environment_variable(KeyValueInput::new(..))` | Environment the server is run with |
| `with_package_argument(Argument::named("--port"))` | Arguments passed to the server |
| `with_runtime_argument(..)` | Arguments passed to the runtime (a container, a launcher) |
| `with_runtime_hint("docker")` | The runtime a client should use — a Cargo package needs none |
| `with_file_sha256(..)` | The hash of an `mcpb` archive |

A `KeyValueInput` or `Argument` carries what a client's configuration UI needs:
`.required()`, `.secret()`, `.with_default(..)`, `.with_choices([..])`,
`.with_placeholder(..)`, `.with_format(InputFormat::Number)`.

:::tip Prefer environment variables for anything user-supplied
Arguments end up on a command line, and a client that runs one through a shell
can be made to run more than the server. A secret belongs in
`with_environment_variable(..)`, marked `.secret()`.
:::

### Other package types, and servers that are already running

`Package::cargo(..)` is the shorthand; `Package::new(..)` takes any of them.
`RegistryType` names `Cargo`, `Oci` and `Mcpb`, with `Other(..)` for a registry
this SDK does not name — the string is what reaches the registry, so
`Other("mcpb".into())` is held to exactly the `mcpb` rules.

A hosted server has nothing to install, so it is a **remote** instead: a URL
to call, with the `{placeholders}` in it declared beside it.

```rust compile
use neva::registry::{Input, Remote, ServerManifest, Transport};

fn main() {
    let manifest = ServerManifest::new("io.github.romanemreis/weather", "0.3.0")
        .with_description("Forecasts from the national weather service")
        .with_remote(
            Remote::new(Transport::streamable_http("https://{tenant}.weather.example/mcp"))
                .with_variable("tenant", Input::new()
                    .with_description("your tenant")
                    .required()));

    assert!(manifest.to_json().is_ok());
}
```

A manifest may carry both: packages for the people who self-host, remotes for
the hosted offering. It needs at least one of the two.

A remote is never `stdio` — there is no process on this side to spawn — and
every `{name}` in a URL must be filled by something the entry declares, whether
that is a remote's `variables` or a package's environment variables and
arguments. Both are checked.

## Validation happens before the upload, not during it

`to_json()` runs
[`validate()`](https://docs.rs/neva/latest/neva/registry/struct.ServerManifest.html#method.validate)
first — there is no use for a `server.json` that is not the shape the schema
describes. It catches the rules a manifest can break while looking perfectly
fine:

* a `name` outside the reverse-DNS shape (a bare `weather` is the common one);
* a `description` over **100 characters** — the limit that catches people,
  because crates.io has no such ceiling — or missing entirely;
* a `title` that is present but blank;
* a version range (`^1.2`, `>=1.0, <2.0`) where an exact version belongs;
* the `format: uri` fields, parsed rather than prefix-matched;
* an icon source that is not `https://`, or over 255 characters — a `data:`
  URI carrying the image itself is a URI, and is not a listing's icon;
* a `{template}` nothing declares;
* nothing to install and nothing to call;
* a remote over stdio, or a package derived from an app with no transport.

:::note It is not a registry's validator
A registry has rules of its own — which hosts it will fetch an archive from,
which base URLs it takes, what it makes of a loopback address — and those are
its to apply and to change. An `Ok` here says the document is the shape the
schema describes; when a registry refuses it, the registry says which of *its*
rules was broken, and that is the answer to act on.
:::

The `$schema` written into the document is pinned rather than tracking `draft`:
a published manifest should not change meaning underneath its author. Override
it with `with_schema_url(..)` when a newer schema lands before neva moves.

## Publishing

1. `cargo publish`, so there is something to install.
2. Put the server name in the crate's README as **visible text** — that is how
   crates.io ownership is proved:

   ```markdown
   - MCP Registry name: `mcp-name: io.github.<your-user>/<your-server>`
   ```

   Not as an HTML comment: crates.io strips those when it renders markdown and
   the validator reads the rendered HTML. (PyPI and NuGet keep comments; cargo
   is the exception.)
3. Write the manifest, prove the namespace is yours, and publish:

   ```bash
   cargo run -- --emit-manifest > server.json
   ```

   ```bash
   mcp-publisher login github
   ```

   ```bash
   mcp-publisher publish
   ```

`login github` is what makes `io.github.<user>/…` yours to publish under; a
domain namespace (`com.example/…`) is proved with DNS instead.

:::warning `mcp-publisher init` writes the wrong file for a Rust crate
It picks the package type by looking for `package.json`, `pyproject.toml` or a
`Dockerfile` and falls back to npm — so a crate comes out as
`"registryType": "npm"` with a placeholder identifier. Generating the manifest
from the server also keeps the version in step on every release, which a file
written once and edited by hand does not.
:::

## Learn By Example

The full walk-through, from `--emit-manifest` to `mcp-publisher publish`, is in
[`examples/registry`](https://github.com/RomanEmreis/neva/tree/main/examples/registry).
