---
sidebar_position: 2
---

# Feature Flags

Neva uses Cargo feature flags to keep compile times low and binary size minimal — only the code you actually need gets compiled. This page explains all available features and how to combine them for common scenarios.

## Quick Start

For most projects, the bundled presets are all you need:

```toml
[dependencies]
# Full-featured MCP server
neva = { version = "...", features = ["server-full"] }

# Full-featured MCP client
neva = { version = "...", features = ["client-full"] }

# Both server and client
neva = { version = "...", features = ["full"] }
```

## Feature Reference

### Presets

| Feature | Includes | Description |
|---------|----------|-------------|
| `full` | `server-full` + `client-full` | Everything — for apps that run both a server and a client |
| `server-full` | `server-macros`, `tracing`, `http-server-volga`, `server-tls`, `di`, `tasks` | All server capabilities, including the default Volga-based HTTP server |
| `client-full` | `client-macros`, `tracing`, `http-client`, `client-tls`, `tasks` | All client capabilities |

### Server Features

| Feature | Includes | Description |
|---------|----------|-------------|
| `server` | — | Core server runtime: tool, resource, and prompt handler registration, stdio transport |
| `server-macros` | `server`, `macros` | Adds attribute macros (`#[tool]`, `#[resource]`, `#[prompt]`, etc.) |
| `http-server` | `server` | Engine-agnostic Streamable HTTP abstractions — pulls in no HTTP framework. Plug in your own stack (axum, hyper, actix-web, …) by implementing [`HttpEngine`](./mcp-server/custom-http) |
| `http-server-volga` | `http-server` | Default [Volga](https://docs.rs/volga)-based HTTP server adapter, including JWT auth |
| `server-tls` | `http-server-volga` | TLS support for the default HTTP server, including automatic dev certificate generation |

### Client Features

| Feature | Includes | Description |
|---------|----------|-------------|
| `client` | — | Core client runtime: tool calls, resource reads, prompt fetching, stdio transport |
| `client-macros` | `client`, `macros` | Adds attribute macros (`#[sampling]`, `#[elicitation]`) |
| `http-client` | `client` | Streamable HTTP transport and SSE stream support |
| `client-tls` | — | TLS support for the HTTP client (rustls) |

### Shared Features

| Feature | Description |
|---------|-------------|
| `macros` | Procedural macro infrastructure (shared between `server-macros` and `client-macros`) |
| `di` | [Dependency injection](./mcp-server/di) — service container with singleton, scoped, and transient lifetimes |
| `tasks` | [Task-augmented requests](./mcp-server/tasks) — long-running async tool execution with polling |
| `tracing` | Structured logging via the [`tracing`](https://docs.rs/tracing) ecosystem and MCP log notifications |

## Common Configurations

### Minimal stdio server (no macros)

```toml
neva = { version = "...", features = ["server"] }
```

Use this when you prefer to register handlers manually with `map_tool()`, `map_resource()`, and `map_prompt()` instead of attribute macros.

### Server with macros, without HTTP

```toml
neva = { version = "...", features = ["server-macros", "tracing"] }
```

Attribute macros and logging, but no HTTP transport compiled in. Useful for stdio-only servers.

### HTTP server without TLS

```toml
neva = { version = "...", features = ["server-macros", "http-server-volga", "tracing", "di", "tasks"] }
```

Default (Volga-based) HTTP transport without TLS — suitable for local or internal deployments behind a reverse proxy.

### HTTP server on a custom stack (axum / hyper / actix-web)

```toml
neva = { version = "...", features = ["server-macros", "http-server", "tracing", "di", "tasks"] }
# plus your framework of choice
axum = "0.8"
```

The `http-server` feature ships the engine-agnostic abstractions only — no Volga, no framework dependency. You implement [`HttpEngine`](./mcp-server/custom-http) for your stack and wire it in via `HttpServer::from_engine(...)`. See [Custom HTTP Stack](./mcp-server/custom-http) for a complete walk-through.

:::warning Breaking change in v0.3.3
Before v0.3.3, the `http-server` flag transitively pulled in Volga. Starting with v0.3.3, `http-server` is engine-agnostic and contains **no** framework. If you depend on the bundled Volga server, switch to `http-server-volga` (or stay on `server-full`, which now selects `http-server-volga` for you).
:::

### Minimal HTTP client

```toml
neva = { version = "...", features = ["http-client"] }
```

A lightweight client that connects to remote MCP servers over HTTP, without macros or tracing.

### Server + embedded client (agent pattern)

```toml
neva = { version = "...", features = ["server-full", "http-client"] }
```

An MCP server that also acts as a client — for example, a server that delegates sampling requests or fans out to other MCP servers.

## Feature Composition

The diagram below shows how features build on each other:

```
full
├── server-full
│   ├── server-macros
│   │   ├── server
│   │   └── macros
│   ├── http-server-volga
│   │   └── http-server
│   │       └── server
│   ├── server-tls
│   │   └── http-server-volga
│   ├── tracing
│   ├── di
│   └── tasks
└── client-full
    ├── client-macros
    │   ├── client
    │   └── macros
    ├── http-client
    │   └── client
    ├── client-tls
    ├── tracing
    └── tasks
```
