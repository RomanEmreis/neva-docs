---
sidebar_position: 12
---

# Внедрение зависимостей

Neva включает встроенный контейнер внедрения зависимостей (DI), позволяющий регистрировать общие сервисы — подключения к базам данных, HTTP-клиенты, объекты конфигурации, кэши — и автоматически предоставлять их обработчикам инструментов, ресурсов и промптов.

:::info
DI входит в пресет `server-full`. При использовании пользовательского набора компонентов добавьте компонент `di` явно:

```toml
neva = { version = "0.2.6", features = ["server-macros", "di"] }
```
:::

## Жизненные циклы сервисов

Neva поддерживает три жизненных цикла сервисов, управляющих тем, как и когда создаются экземпляры:

| Жизненный цикл | Создаётся | Общий для |
|----------------|-----------|-----------|
| **Singleton** | Один раз при запуске | Всех запросов и сессий |
| **Scoped** | Один раз на входящее MCP-сообщение | Всех обработчиков в рамках одного запроса |
| **Transient** | При каждом разрешении | Ничего — каждый вызов получает новый экземпляр |

Выбирайте **singleton** для stateless или потокобезопасных сервисов (например, HTTP-клиент или конфигурация только для чтения). Выбирайте **scoped**, когда сервис должен быть общим в рамках одного запроса, но изолированным от других (например, транзакция базы данных). Выбирайте **transient**, когда всегда нужен новый экземпляр.

## Регистрация сервисов

Сервисы регистрируются в `App` при настройке, до вызова `.run()`.

### Singleton

Передайте уже созданный экземпляр:

```rust
use neva::prelude::*;

#[derive(Clone)]
struct AppConfig {
    api_url: String,
}

#[tokio::main]
async fn main() {
    let config = AppConfig { api_url: "https://api.example.com".into() };

    App::new()
        .with_options(|opt| opt.with_stdio())
        .add_singleton(config)
        .run()
        .await;
}
```

`T` должен реализовывать `Send + Sync + 'static`. `Clone` необходим для прямого извлечения значения; для совместного использования по указателю используйте `Dc<T>` (описано ниже).

### Scoped — через трейт `Inject`

Реализуйте трейт [`Inject`](https://docs.rs/volga-di/latest/volga_di/trait.Inject.html), чтобы описать, как сервис создаётся из контейнера. Контейнер вызывает это один раз на область видимости запроса.

```rust
use neva::prelude::*;

#[derive(Clone)]
struct RequestLogger {
    prefix: String,
}

impl Inject for RequestLogger {
    fn inject(_: &Container) -> Result<Self, DiError> {
        Ok(Self { prefix: "[req]".into() })
    }
}

App::new()
    .with_options(|opt| opt.with_stdio())
    .add_scoped::<RequestLogger>()
    .run()
    .await;
```

### Scoped — через фабрику

Когда конструирование простое или не хочется реализовывать `Inject`, передайте замыкание:

```rust
App::new()
    .add_scoped_factory(|| RequestLogger { prefix: "[req]".into() })
    .run()
    .await;
```

### Scoped — через `Default`

Если ваш тип реализует `Default`, используйте сокращённую форму:

```rust
#[derive(Default, Clone)]
struct RequestContext {
    trace_id: Option<String>,
}

App::new()
    .add_scoped_default::<RequestContext>()
    .run()
    .await;
```

### Transient — через `Inject`, фабрику или `Default`

Варианты transient аналогичны scoped. Единственное отличие: фабрика (или `Inject::inject`, или `Default::default`) вызывается каждый раз при разрешении типа, а не один раз на область видимости:

```rust
App::new()
    .add_transient::<MyService>()                    // через Inject
    .add_transient_factory(|| MyService::new())      // через замыкание
    .add_transient_default::<MyService>()            // через Default
    .run()
    .await;
```

## Извлечение сервисов в обработчиках

Используйте `Dc<T>` как параметр функции для получения сервиса в любом обработчике инструмента, ресурса или промпта. `Dc` (Dependency Container) оборачивает разрешённый экземпляр в `Arc` и реализует `Deref`, поэтому его можно использовать как обычную ссылку.

```rust
use neva::prelude::*;

#[derive(Default, Clone)]
struct AppConfig {
    greeting: String,
}

#[tool(descr = "Greets a user using configured greeting")]
async fn hello(config: Dc<AppConfig>, name: String) -> String {
    format!("{}, {name}!", config.greeting)
}

#[tokio::main]
async fn main() {
    let config = AppConfig { greeting: "Hello".into() };

    App::new()
        .with_options(|opt| opt.with_stdio())
        .add_singleton(config)
        .run()
        .await;
}
```

`Dc<T>` работает со всеми типами обработчиков:

```rust
// В обработчике ресурса
#[resource(uri = "data://{id}", title = "Fetch data")]
async fn fetch_data(db: Dc<Database>, uri: Uri, id: String) -> ResourceContents {
    let row = db.get(&id).await?;
    ResourceContents::new(uri).with_text(row)
}

// В обработчике промпта
#[prompt(descr = "Generate a prompt using config")]
async fn my_prompt(config: Dc<AppConfig>, topic: String) -> PromptMessage {
    PromptMessage::user().with(format!("{}: {topic}", config.greeting))
}
```

### Получение значения в собственность

Если нужен `T` во владение, а не общая ссылка, вызовите `.cloned()` на `Dc<T>`:

```rust
#[tool(descr = "Returns config details")]
async fn describe(config: Dc<AppConfig>) -> String {
    let owned: AppConfig = config.cloned();
    owned.greeting
}
```

## Извлечение сервисов в промежуточных обработчиках

Внутри промежуточного обработчика используйте `ctx.resolve::<T>()` для получения клонированного значения или `ctx.resolve_shared::<T>()` для `Arc<T>`:

```rust
use neva::prelude::*;

async fn auth_middleware(ctx: MwContext, next: Next) -> Response {
    let config = ctx.resolve_shared::<AppConfig>()?;
    // Использование config для проверки аутентификации, логирования и т.д.
    next(ctx).await
}
```

:::note
`resolve` и `resolve_shared` доступны только при включённом компоненте `di`.
:::

## Трейт `Inject`

`Inject` даёт типу возможность извлекать свои собственные зависимости из контейнера — полезно, когда сервис сам зависит от других зарегистрированных сервисов:

```rust
use neva::prelude::*;

#[derive(Clone)]
struct EmailService {
    config: AppConfig,
}

impl Inject for EmailService {
    fn inject(container: &Container) -> Result<Self, DiError> {
        let config = container.resolve::<AppConfig>()?;
        Ok(Self { config })
    }
}
```

При вызове `add_scoped::<EmailService>()` Neva будет вызывать `EmailService::inject(container)` в начале каждой области видимости запроса.

## Полный пример

```rust
use neva::prelude::*;

// --- Сервисы ---

#[derive(Clone)]
struct AppConfig {
    api_url: String,
}

#[derive(Clone)]
struct ApiClient {
    base_url: String,
}

impl ApiClient {
    async fn fetch(&self, path: &str) -> String {
        format!("GET {}{path}", self.base_url)
    }
}

impl Inject for ApiClient {
    fn inject(container: &Container) -> Result<Self, DiError> {
        let config = container.resolve::<AppConfig>()?;
        Ok(Self { base_url: config.api_url.clone() })
    }
}

// --- Обработчики ---

#[tool(descr = "Fetches data from the upstream API")]
async fn fetch_data(client: Dc<ApiClient>, path: String) -> String {
    client.fetch(&path).await
}

// --- Главная функция ---

#[tokio::main]
async fn main() {
    let config = AppConfig { api_url: "https://api.example.com".into() };

    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("API MCP server")
            .with_version("1.0.0"))
        .add_singleton(config)        // общий, заранее созданный
        .add_scoped::<ApiClient>()    // создаётся один раз на запрос через Inject
        .run()
        .await;
}
```
