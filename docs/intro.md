---
sidebar_position: 1
---

# Getting Started

## Model Context Protocol (MCP)
MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ChatGPT can connect to data sources (e.g. local files, databases), tools (e.g. search engines, calculators) and workflows (e.g. specialized prompts) - enabling them to access key information and perform tasks.

You may learn more about MCP [here](https://modelcontextprotocol.io/docs/getting-started/intro).

## Neva
Neva provides everything you need to quickly build MCP clients and servers, fully aligned with the latest MCP specification.

:::warning
This project is currently in preview. Breaking changes can be introduced without prior notice.
:::

## Supported Platforms
Neva runs on Rust stable on Linux, macOS, and Windows.

## Install Rust
If you don’t have Rust installed yet, the easiest way is via [`rustup`](https://doc.rust-lang.org/book/ch01-01-installation.html).  
Neva requires Rust **1.90 or newer**. Running `rustup update` ensures you’re on the latest version.

## Under the Hood
Neva is powered by **Tokio**, Rust’s battle-tested async runtime.  
This gives your MCP apps **efficient concurrency** and **production-ready performance** right from the start.

## Learn by Example
For full examples and tutorials, check out the [examples directory](https://github.com/RomanEmreis/neva/tree/main/examples).
