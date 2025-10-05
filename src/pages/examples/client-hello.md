```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_stdio("cargo", ["run", "greeting-server"]));

client.connect().await?;

let args = ("name", "John");
let result = client.call_tool("hello", args).await?;

// Prints: "Hello John!"
println!("{:?}", result.content);                 
client.disconnect().await
```