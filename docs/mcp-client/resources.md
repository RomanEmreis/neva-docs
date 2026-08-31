---
sidebar_position: 3
---

# Resources

In the [Basics](/docs/mcp-client/basics#read-a-resource) chapter, we learned how to read a resource.
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

:::info Fixed in 0.5.6
These accessors used to be compiled into **server** builds only, which left a
client-only build reading the enum's variants by hand. They are now available to
both. The *builders* — `with_mime`, `with_title`, … — stay server-side.
:::

A resource served as `text/html;profile=mcp-app` is an
[MCP App](./apps) document; `ui()` reads its security block.

## Subscribing to resource updates

Two notifications carry resource changes: `notifications/resources/list_changed`
when the list itself changes (the server must have declared `listChanged`),
and `notifications/resources/updated` when a specific resource changes (the
server must have declared `subscribe`).

Register the handlers **after `connect()`** — they assert on what the server
advertises, which is not known until discovery has run:

```rust
client.on_resources_changed(|_: Notification| async {
    println!("Resource list has been updated");
});

client.on_resource_changed(|n: Notification| async move {
    let params = n.params::<SubscribeRequestParams>()
        .expect("Expected SubscribeRequestParams");

    println!("Resource '{}' has been updated", params.uri); 
});
```

Handlers alone do not make notifications arrive: under MCP 2026-07-28 the
client asks for them with a `subscriptions/listen` stream, which is where the
per-resource subscription lives:

```rust
let mut subscription = client
    .listen(SubscriptionFilter::new()
        .with_resources_changed()
        .with_resource("res://some-resource"))
    .await?;

// ...

subscription.cancel().await?;
```

See [Subscriptions](./subscriptions) for the filter, the acknowledgment, and
the subscription's lifecycle.

:::note Replacing `subscribe_to_resource`
`client.subscribe_to_resource(uri)` / `unsubscribe_from_resource(uri)` are the
legacy pair. They stay compiled — the dual-mode fallback still reaches legacy
peers — but reject a 2026-07-28 peer with `MethodNotFound`. Use
`SubscriptionFilter::with_resource(uri)` instead, as above.
:::

## Learn By Example
Here you may find the full [example](https://github.com/RomanEmreis/neva/tree/main/examples/client)

### Additional examples

* [Subscriptions (MCP 2026-07-28)](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
* [Subscription to the resource updates (legacy)](https://github.com/RomanEmreis/neva/tree/main/examples/subscription)