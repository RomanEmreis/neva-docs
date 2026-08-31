---
sidebar_position: 3
---

# Resources

The Model Context Protocol (MCP) provides a standardized way for servers to expose [resources](https://modelcontextprotocol.io/specification/draft/server/resources) to clients. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Each resource is uniquely identified by a [**URI**](https://datatracker.ietf.org/doc/html/rfc3986).

In the [Basics](/docs/mcp-server/basics#adding-a-resource-tempate-handler) chapter, we learned how to declare a simple dynamic resource:
```rust
use neva::prelude::*;

#[resource(
    uri = "res://{name}",
    title = "Read resource",
    descr = "Some details about resource",
    mime = "application/octet-stream",
    annotations = r#"{
        "audience": ["user"],
        "priority": 1.0
    }"#
)]
async fn get_res(uri: Uri, name: String) -> ResourceContents {
    let data = "some file contents"; // Read a resource from some source

    ResourceContents::new(uri)
        .with_title(name)
        .with_blob(data)
}
```
You can achieve the same result **without** using the procedural macro:

```rust
use neva::prelude::*;

async fn get_res(uri: Uri, name: String) -> ResourceContents {
    let data = "some file contents"; // Read a resource from some source

    ResourceContents::new(uri)
        .with_title(name)
        .with_blob(data)
}

#[tokio::main]
async fn main() {
    let mut mcp_server = App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP Server")
            .with_version("1.0.0"));
            
    mcp_server
        .map_resource("res://{name}", "get_res", hello)
        .with_description("Some details about resource")
        .with_title("Read resource")
        .with_mime("application/octet-stream")
        .with_annotations(|anotations| anotations
            .with_audience("user")
            .with_priority(1.0));

    mcp_server.run().await;
}
```

In the example above, the resource template name must be set explicitly.
When using the [`#[resource]`](https://docs.rs/neva/latest/neva/attr.resource.html) attribute macro, the resource template name is automatically inferred from the function name.

All other resource template parameters that can be specified in the attribute macro can also be configured using `with_*` methods (for example, [`with_description()`](https://docs.rs/neva/latest/neva/types/resource/template/struct.ResourceTemplate.html#method.with_description)).

The [`map_resource()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_resource) method registers a resource template handler under a specified name and returns a mutable reference to the registered [resource template](https://docs.rs/neva/latest/neva/types/resource/template/struct.ResourceTemplate.html).

## Contents

There are several ways to provide a resource result.
The most convenient one is to use the [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html) enum:

```rust
let resource = ResourceContents::new("res://text")
    .with_title("Text resource")
    .with_text("Some text content");
```

You can specify a particular content type using helper methods such as:

* [`with_blob()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_blob)
* [`with_text()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_text)
* [`with_json()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_json)

Each of these methods sets both the content and an appropriate MIME type.
If needed, you can override the MIME type using [`with_mime()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_mime).

Alternatively, you can use one of the specialized structs directly:

* [`BlobResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.BlobResourceContents.html)
* [`TextResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.TextResourceContents.html)
* [`JsonResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.JsonResourceContents.html)

You can also return an array or [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) of [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html).
They will all be automatically converted into a [`ReadResourceResult`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.ReadResourceResult.html).

## Static resources

Above we considered dynamic resources, however, you may also want to define a static resource handler, for example:

```rust
#[resource(uri = "res://static_resource")]
async fn get_res(uri: Uri) -> ResourceContents {
    TextResourceContents::new(uri, "some file contents")
}
```
or by using the [add_resource()](https://docs.rs/neva/latest/neva/app/struct.App.html#method.add_resource) method:
```rust
let mut mcp_server = App::new()
    .with_options(|opt| opt
        .with_stdio()
        .with_name("Sample MCP Server")
        .with_version("1.0.0"));
        
mcp_server
    .add_resource("res://static_resource", "Some static resource");

mcp_server.run().await;
```

## `ui://` resources

A resource whose URI starts with `ui://` is an [MCP App](./apps): an HTML
document a host renders in a sandboxed iframe for a tool that points at it. The
scheme is reserved, and it is what marks the resource — neva serves such a read
as `text/html;profile=mcp-app` and attaches the `_meta.ui` security block:

```rust
app.add_ui_resource("ui://clock/app.html", "clock", "<!doctype html>…")
    .with_title("Clock")
    .with_prefers_border(true);
```

`ui://` resources stay **out of** `resources/list` by default — a host finds
them through the tool's metadata, not by browsing. See [MCP Apps](./apps).

## Handling `list_resources`

You can override the function that provides a list of resources and optionally handle pagination using the [`#[resources]`](https://docs.rs/neva/latest/neva/attr.resources.html) attribute macro:

```rust
use neva::prelude::*;

#[resources]
async fn list_resources(_: ListResourcesRequestParams) -> Vec<Resource> {
    // Read a list of resources from some source
    let resources = vec![
        Resource::new("res://res1", "resource 1")
            .with_descr("A test resource 1")
            .with_mime("text/plain"),
        Resource::new("res://res2", "resource 2")
            .with_descr("A test resource 2")
            .with_mime("text/plain"),
    ];
    resources
}
```

Alternatively, you can use the [`map_resources()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_resources) method:

```rust
let mut mcp_server = App::new()
    .with_options(|opt| opt
        .with_stdio()
        .with_name("Sample MCP Server")
        .with_version("1.0.0"));
        
mcp_server.map_resources(|_: ListResourcesRequestParams| async {
    // Read a list of resources from some source
    let resources = vec![
        Resource::new("res://res1", "resource 1")
            .with_descr("A test resource 1")
            .with_mime("text/plain"),
        Resource::new("res://res2", "resource 2")
            .with_descr("A test resource 2")
            .with_mime("text/plain"),
    ];
    resources
});

mcp_server.run().await;
```

## Resource updates

In addition to [reading resources](/docs/mcp-server/tools#mcp-context), [MCP Server Tools](https://modelcontextprotocol.io/specification/draft/server/tools) can also add, update, or remove them:

```rust
use neva::prelude::*;

/// Adding a new resource
#[tool]
async fn add_resource(mut ctx: Context, uri: Uri) -> Result<(), Error> {
    let resource = Resource::from(uri); // Create a new resource
    ctx.add_resource(resource).await
}

/// Removing a resource
#[tool]
async fn remove_resource(mut ctx: Context, uri: Uri) -> Result<(), Error> {
    ctx.remove_resource(uri).await
}

/// Updating an existing resource
#[tool]
async fn update_resource(mut ctx: Context, uri: Uri) -> Result<(), Error> {
    // Read and update the resource with the given URI
    // ...

    ctx.resource_updated(uri).await
}
```

Each of these operations automatically notifies every client subscribed to the
corresponding event:

* `notifications/resources/list_changed` — when a resource has been added or removed
* `notifications/resources/updated` — when a resource has been updated

Delivery goes to the live [`subscriptions/listen`](./subscriptions) streams
whose filter admits the notification, so the server needs `listChanged` and
`subscribe` advertised for a client to be able to ask for them:

```rust
App::new()
    .with_options(|opt| opt
        .with_resources(|res| res.with_list_changed().with_subscribe()));
```

Use
[`ctx.is_subscribed(&uri)`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.is_subscribed)
to skip expensive local work nobody is listening for — but not to decide
whether to notify: it is **node-local**, and under a
[notification bus](./subscriptions#running-more-than-one-instance) a subscriber
on another instance may be waiting for exactly what this one would skip. Since
**0.5.3** `resource_updated` no longer pre-checks it and publishes
unconditionally, letting the subscription filters route the result.

:::note Under `legacy-spec`
The `resources/subscribe` / `resources/unsubscribe` RPC pair comes back, and
with it `Context::subscribe_to_resource` / `unsubscribe_from_resource`. Those
methods do not exist in the default build — the client owns the subscription
now. See [Subscriptions](./subscriptions) and [Legacy spec](../legacy-spec.md).
:::

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/server).

### Additional examples

* [Handling large resources](https://github.com/RomanEmreis/neva/tree/main/examples/large_resources_server)
* [Pagination](https://github.com/RomanEmreis/neva/tree/main/examples/pagination)
* [Resource updates](https://github.com/RomanEmreis/neva/tree/main/examples/updates)
* [Subscriptions](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
