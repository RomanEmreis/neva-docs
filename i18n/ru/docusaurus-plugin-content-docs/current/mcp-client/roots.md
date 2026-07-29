---
sidebar_position: 5
---

# Корневые каталоги

:::warning Устарело с момента появления
MCP 2026-07-28 убрал `roots/list` как серверный запрос к клиенту, управляемый
возможностями, и перенёс его на MRTR в виде
[вида input-запроса](../spec-2026-07-28.md#виды-input-запросов-elicitation-sampling-roots)
— **сразу устаревшего**. `Client::add_root` / `add_roots` помечены
`#[deprecated]` и требуют `#[allow(deprecated)]`.

Новым инструментам лучше принимать нужные пути явными аргументами.
:::

Model Context Protocol (MCP) предоставляет стандартизированный способ для клиентов предоставлять серверам файловые «корневые каталоги». [Корневые каталоги](https://modelcontextprotocol.io/specification/draft/client/roots) определяют границы, в пределах которых серверы могут работать в файловой системе, позволяя им понять, к каким директориям и файлам у них есть доступ.

## Корневые каталоги — это конфигурируемые данные

Корневые каталоги — не обработчик. Клиент отвечает на input-запрос сервера
`roots/list` из того списка, с которым он был собран, а **непустой список
заставляет его объявить `clientCapabilities.roots`** в каждом запросе:
сервер может запросить только тот вид, который клиент объявил.

Поскольку уведомления `notifications/roots/list_changed` больше нет, сервер
видит тот список, который есть у клиента в момент прихода запроса.
Подписываться не на что, и возможность `roots.listChanged` включать не нужно.

### Добавление корневых каталогов
```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_http(|http| http.bind("127.0.0.1:3001").with_endpoint("/mcp")));

    // Устарело с момента появления, как и весь вид roots.
    #[allow(deprecated)]
    client
        .add_root("file:///home/user/projects/my_project", "My Project")
        .add_root("file:///home/user/projects/my_another_project", "My Another Project");

    client.connect().await?;

    // Раунд MRTR происходит внутри этого единственного вызова.
    let result = client.call_tool("scan_workspace", ()).await?;
    tracing::info!("Result: {:?}", result.content);

    client.disconnect().await
}
```

## Доступ к корневым каталогам на сервере

Внедрите [`Context`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html)
в обработчик инструмента и запросите список со стабильным **replay-ключом**:

```rust
#[tool]
async fn scan_workspace(mut ctx: Context) -> Result<String, Error> {
    // Первый раунд разворачивает обработчик с `input_required` и конвертом
    // `roots/list`; второй — воспроизводит ответ из `requestState`.
    #[allow(deprecated)]
    let roots = ctx.list_roots("dirs").await?;

    // Каждый корневой каталог содержит URI и человекочитаемое имя
    for root in &roots.roots {
        tracing::info!(uri = %root.uri, name = %root.name);
    }

    Ok(format!("корневых каталогов: {}", roots.roots.len()))
}
```

Весь код выше точки `list_roots` выполняется на втором раунде заново,
поэтому побочные эффекты оборачивайте в `ctx.memo` / `ctx.once` /
`ctx.on_commit` — те же примитивы, что и для
[получения данных](../mcp-server/elicitation#guarding-side-effects).

:::note Под флагом `legacy-spec`
Корневые каталоги работают как push-запрос: `ctx.list_roots()` не принимает
ключ, их можно добавлять после `connect()`, а возможность
`roots.listChanged` (`with_roots(|r| r.with_list_changed())`) уведомляет
сервер об изменениях. См. [Легаси-спецификация](../legacy-spec.md).
:::

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/roots) доступен здесь.
