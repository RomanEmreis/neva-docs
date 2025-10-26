---
sidebar_position: 3
---

# Resources

The Model Context Protocol (MCP) provides a standardized way for servers to expose [resources](https://modelcontextprotocol.io/specification/draft/server/resources) to clients. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Each resource is uniquely identified by a [**URI**](https://datatracker.ietf.org/doc/html/rfc3986).

In the [Basics](/docs/mcp-server/basics) chapter, we learned how to declare a simple dynamic resource:
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

# Contents

There are several ways to provide a resource result. The most convenient way is to use the [ResourceContents](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html) struct:
```rust
let resource = ResourceContents::new("res://text")
    .with_title("Text resource")
    .with_text("Some text content");
```
You can specify a particular content type by using methods like:
* [with_blob()](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_blob)
* [with_text()](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_text)
* [with_json()](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_json)

That are takes a content and sets an appropriate MIME type. The last one can be also configured by using the [with_mime()](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_mime) method.

You may also return an array or [Vec](https://doc.rust-lang.org/std/vec/struct.Vec.html) of [ResourceContents](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html) they all will be converted into [ReadResourceResult](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.ReadResourceResult.html).


