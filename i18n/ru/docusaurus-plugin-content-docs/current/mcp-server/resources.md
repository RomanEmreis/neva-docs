---
sidebar_position: 3
---

# Ресурсы

Model Context Protocol (MCP) предоставляет стандартизированный способ для серверов предоставлять клиентам [ресурсы](https://modelcontextprotocol.io/specification/draft/server/resources). Ресурсы позволяют серверам передавать данные, обеспечивающие контекст для языковых моделей: файлы, схемы баз данных или специфичная для приложения информация. Каждый ресурс уникально идентифицируется по [**URI**](https://datatracker.ietf.org/doc/html/rfc3986).

В главе [Основы](/docs/mcp-server/basics#adding-a-resource-tempate-handler) мы научились объявлять простой динамический ресурс:
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
    let data = "some file contents"; // Читаем ресурс из источника

    ResourceContents::new(uri)
        .with_title(name)
        .with_blob(data)
}
```
Того же результата можно добиться **без** использования процедурного макроса:

```rust
use neva::prelude::*;

async fn get_res(uri: Uri, name: String) -> ResourceContents {
    let data = "some file contents"; // Читаем ресурс из источника

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

В примере выше имя шаблона ресурса должно быть задано явно.
При использовании атрибутного макроса [`#[resource]`](https://docs.rs/neva/latest/neva/attr.resource.html) имя шаблона ресурса автоматически выводится из имени функции.

Все остальные параметры шаблона ресурса, доступные в атрибутном макросе, можно настроить с помощью методов `with_*` (например, [`with_description()`](https://docs.rs/neva/latest/neva/types/resource/template/struct.ResourceTemplate.html#method.with_description)).

Метод [`map_resource()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_resource) регистрирует обработчик шаблона ресурса под указанным именем и возвращает изменяемую ссылку на зарегистрированный [шаблон ресурса](https://docs.rs/neva/latest/neva/types/resource/template/struct.ResourceTemplate.html).

## Содержимое

Существует несколько способов вернуть результат ресурса.
Наиболее удобный — использование перечисления [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html):

```rust
let resource = ResourceContents::new("res://text")
    .with_title("Text resource")
    .with_text("Some text content");
```

Конкретный тип содержимого задаётся вспомогательными методами:

* [`with_blob()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_blob)
* [`with_text()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_text)
* [`with_json()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_json)

Каждый из этих методов задаёт как содержимое, так и соответствующий MIME-тип.
При необходимости MIME-тип можно переопределить с помощью [`with_mime()`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html#method.with_mime).

Также можно использовать специализированные структуры напрямую:

* [`BlobResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.BlobResourceContents.html)
* [`TextResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.TextResourceContents.html)
* [`JsonResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.JsonResourceContents.html)

Можно также вернуть массив или [`Vec`](https://doc.rust-lang.org/std/vec/struct.Vec.html) из [`ResourceContents`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/enum.ResourceContents.html).
Все они автоматически преобразуются в [`ReadResourceResult`](https://docs.rs/neva/latest/neva/types/resource/read_resource_result/struct.ReadResourceResult.html).

## Статические ресурсы

Выше рассматривались динамические ресурсы, однако можно также определить обработчик статического ресурса, например:

```rust
#[resource(uri = "res://static_resource")]
async fn get_res(uri: Uri) -> ResourceContents {
    TextResourceContents::new(uri, "some file contents")
}
```
или с помощью метода [add_resource()](https://docs.rs/neva/latest/neva/app/struct.App.html#method.add_resource):
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

## Ресурсы `ui://` {#ui-resources}

Ресурс, URI которого начинается с `ui://`, — это [MCP App](./apps): HTML-документ,
который хост рендерит в песочнице iframe для указывающего на него инструмента.
Схема зарезервирована, и именно она помечает ресурс: neva отдаёт такое чтение как
`text/html;profile=mcp-app` и прикладывает блок безопасности `_meta.ui`:

```rust
app.add_ui_resource("ui://clock/app.html", "clock", "<!doctype html>…")
    .with_title("Clock")
    .with_prefers_border(true);
```

По умолчанию ресурсы `ui://` **не попадают** в `resources/list` — хост находит их
через метаданные инструмента, а не просмотром списка. См. [MCP Apps](./apps).

## Обработка `list_resources`

С помощью атрибутного макроса [`#[resources]`](https://docs.rs/neva/latest/neva/attr.resources.html) можно переопределить функцию, предоставляющую список ресурсов, и при необходимости реализовать пагинацию:

```rust
use neva::prelude::*;

#[resources]
async fn list_resources(_: ListResourcesRequestParams) -> Vec<Resource> {
    // Читаем список ресурсов из источника
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

Также можно использовать метод [`map_resources()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_resources):

```rust
let mut mcp_server = App::new()
    .with_options(|opt| opt
        .with_stdio()
        .with_name("Sample MCP Server")
        .with_version("1.0.0"));

mcp_server.map_resources(|_: ListResourcesRequestParams| async {
    // Читаем список ресурсов из источника
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

## Обновление ресурсов

Помимо [чтения ресурсов](/docs/mcp-server/tools#mcp-context), [инструменты MCP-сервера](https://modelcontextprotocol.io/specification/draft/server/tools) также могут добавлять, обновлять или удалять их:

```rust
use neva::prelude::*;

/// Добавление нового ресурса
#[tool]
async fn add_resource(mut ctx: Context, uri: Uri) -> Result<(), Error> {
    let resource = Resource::from(uri); // Создаём новый ресурс
    ctx.add_resource(resource).await
}

/// Удаление ресурса
#[tool]
async fn remove_resource(mut ctx: Context, uri: Uri) -> Result<(), Error> {
    ctx.remove_resource(uri).await
}

/// Обновление существующего ресурса
#[tool]
async fn update_resource(mut ctx: Context, uri: Uri) -> Result<(), Error> {
    // Читаем и обновляем ресурс с указанным URI
    // ...

    ctx.resource_updated(uri).await
}
```

Каждая из этих операций автоматически уведомляет всех клиентов, подписанных на
соответствующее событие:

* `notifications/resources/list_changed` — при добавлении или удалении ресурса
* `notifications/resources/updated` — при обновлении ресурса

Доставка идёт в живые потоки [`subscriptions/listen`](./subscriptions), чей
фильтр допускает уведомление, поэтому сервер должен объявить `listChanged` и
`subscribe`, чтобы клиент вообще мог о них попросить:

```rust
App::new()
    .with_options(|opt| opt
        .with_resources(|res| res.with_list_changed().with_subscribe()));
```

Чтобы не делать дорогую локальную работу, которую никто не слушает,
используйте
[`ctx.is_subscribed(&uri)`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.is_subscribed) —
но не для того, чтобы решить, слать ли уведомление: он **знает только про свой
узел**, и при [шине уведомлений](./subscriptions#запуск-нескольких-экземпляров)
подписчик на другом экземпляре может ждать ровно то, что этот пропустит. Начиная
с **0.5.3** `resource_updated` предпроверку не делает и публикует безусловно,
оставляя маршрутизацию фильтрам подписок.

:::note Под флагом `legacy-spec`
Возвращается пара RPC-методов `resources/subscribe` / `resources/unsubscribe`,
а вместе с ней `Context::subscribe_to_resource` /
`unsubscribe_from_resource`. В сборке по умолчанию этих методов нет —
подпиской теперь владеет клиент. См. [Подписки](./subscriptions) и
[Легаси-спецификация](../legacy-spec.md).
:::

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/server) доступен здесь.

### Дополнительные примеры

* [Обработка больших ресурсов](https://github.com/RomanEmreis/neva/tree/main/examples/large_resources_server)
* [Пагинация](https://github.com/RomanEmreis/neva/tree/main/examples/pagination)
* [Обновления ресурсов](https://github.com/RomanEmreis/neva/tree/main/examples/updates)
* [Подписки](https://github.com/RomanEmreis/neva/tree/main/examples/subscriptions)
