```rust
#[prompt(descr = "Analyze code for potential improvements")]
async fn analyze_code(lang: String) -> PromptMessage {
    // Do the analysis ...
    PromptMessage::user()
        .with(format!("Language: {lang}"))
}
```