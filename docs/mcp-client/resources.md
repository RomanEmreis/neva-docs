---
sidebar_position: 3
---

# Resources

In the [Basics](/docs/mcp-client/basics) chapter, we learned how to read a resource.
In this section, we’ll explore in more detail how deal with resources provided by the MCP server.

## Reading a Resource

To read a resource, use the [`read_resource()`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.read_resource) method.
It requires the tool name and optional arguments.

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio(
                "cargo", 
                ["run", "--manifest-path", "./neva-mcp-server/Cargo.toml"]));

    client.connect().await?;

    let resource = client.read_resource("res://resource-1").await?

    println!("{:?}", result.contents);

    client.disconnect().await
}
```

## Contents

In the example above, the [`read_resource`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.read_resource) method returns a [`ReadResourceResult`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.ReadResourceResult.html),
which contains a [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) of [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html).

You can access individual resource fields using the following methods:

* [`uri()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.uri)
* [`title()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.title)
* [`mime()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.mime)
* [`annotations()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.annotations)
* [`text()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.text) — returns the text content
* [`blob()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.blob) — returns the binary (blob) content
* [`json()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.json) — returns the JSON content

## Subscribing to resource updates

When the list of available resources changes on the server, and the MCP server has declared `listChanged`,
it will publish a `notifications/resources/list_changed` notification.
On the client side, you can subscribe to it as follows:

```rust
client.on_resources_changed(|_: Notification| async {
    println!("Resource list has been updated");
});
```

Additionally, when a specific resource is updated on the server,
a `notifications/resources/updated` notification is sent.
You can subscribe or unsubscribe from these updates using:

```rust
client.on_resource_changed(|n: Notification| async move {
    let params = n.params::<SubscribeRequestParams>()
        .expect("Expected SubscribeRequestParams");

    println!("Resource '{}' has been updated", params.uri); 
});

client.subscribe_to_resource("res://some-resource").await?;

// ...

client.unsubscribe_from_resource("res://some-resource").await?;
```

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/client)

### Additional examples

* [Subscription to the resource updates](https://github.com/RomanEmreis/neva/tree/main/examples/subscription)