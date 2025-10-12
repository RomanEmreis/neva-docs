```rust
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

#[resource(
    uri = "res://{name}",
    mime = "text/plain"
)]
async fn get_res(name: String) -> TextResourceContents {
    // Read resource from from some source

    TextResourceContents::new(
        format!("res://{name}"),
        format!("Some details about resource: {name}"))
}
```