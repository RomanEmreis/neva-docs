---
sidebar_position: 1
---

# Основы

Давайте воспользуемся MCP-клиентом Neva для подключения к вашим MCP-серверам (и другим тоже).

## Создание приложения

Создайте новое бинарное приложение:
```bash
cargo new neva-mcp-client
cd neva-mcp-client
```

Добавьте следующие зависимости в ваш `Cargo.toml`:

```toml
[dependencies]
neva = { version = "...", features = "client-full" }
tokio = { version = "1", features = ["full"] }
```

## Вызов инструмента {#call-a-tool}

Для начала вызовем инструмент, созданный в разделе [основы сервера](/docs/mcp-server/basics#setup-a-tool).

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

    let args = ("name", "John");
    let result = client.tools().call("hello", args).await?;

    println!("{:?}", result.content);

    client.disconnect().await
}
```

Здесь мы настраиваем [MCP-клиент](https://docs.rs/neva/latest/neva/client/struct.Client.html) для подключения к серверу через `stdio`.
После подключения можно вызывать инструменты, получать запросы или читать ресурсы вплоть до отключения (или удаления клиента).

Примитивы сервера сгруппированы так же, как MCP называет свои методы, — по
одному пространству имён на префикс:

| Пространство имён | Методы |
|---|---|
| [`client.tools()`](https://docs.rs/neva/latest/neva/client/api/struct.Tools.html) | `tools/list`, `tools/call` |
| [`client.resources()`](https://docs.rs/neva/latest/neva/client/api/struct.Resources.html) | `resources/list`, `resources/templates/list`, `resources/read` |
| [`client.prompts()`](https://docs.rs/neva/latest/neva/client/api/struct.Prompts.html) | `prompts/list`, `prompts/get` |
| [`client.tasks()`](https://docs.rs/neva/latest/neva/client/api/struct.Tasks.html) | `tasks/get`, `tasks/update`, `tasks/cancel` — см. [Задачи](./tasks) |

Каждое пространство имён — `Copy`-представление, заимствованное у клиента,
поэтому их можно держать сколько угодно одновременно:
`let (tools, prompts) = (client.tools(), client.prompts());`.

:::note `disconnect()` — локальная операция
Он останавливает транспорт и **ничего** не отправляет по сети. В протоколе
нет прощального сообщения: `notifications/cancelled` без параметров, который
neva отправляла раньше, не проходит проверку по схеме самой спецификации, а о
том, что клиент ушёл, сервер и так узнаёт по закрытому соединению.
:::

## Когда `connect` не удался {#when-connect-fails}

`connect()` запускает транспорт, и транспорт, который не запустился, сообщает
об этом **сразу**: команда stdio, которую не удалось запустить, отвергнутая
конфигурация OAuth или TLS, неудачная привязка к порту. Это больше не
всплывает позже как истёкший таймаут запроса, а клиенту, которому вовсе не
задали транспорт, об этом говорят на `connect`, а не на первом вызове.

Неудача на этапе подъёма оставляет клиент целым: настроенный транспорт
никуда не делся, поэтому тем же клиентом можно попробовать ещё раз — или
направить его в другое место.

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_stdio("weather-mcp", ["--stdio"]));

    if let Err(err) = client.connect().await {
        eprintln!("установленный сервер не запустился: {err}");

        // Тот же клиент, но теперь нацеленный на локальную сборку.
        client = client.with_options(|opt| opt
            .with_stdio("cargo", ["run", "-p", "weather-mcp"]));
        client.connect().await?;
    }

    let tools = client.tools().list(None).await?;
    println!("{} инструментов", tools.tools.len());

    client.disconnect().await
}
```

:::note Что можно повторить, а что нет
Всё, что транспорт отверг **целиком**: ничего не израсходовано, поэтому
следующая попытка — настоящая попытка. Когда транспорт уже запущен, более
поздний сбой (например, сервер отвечает на discovery ошибкой) повтором не
отменяется: нужен новый `Client`, потому что stdio-серверу в любом случае
нужен новый дочерний процесс.
:::

## Получение промпта {#get-a-prompt}

Далее получим [промпт](/docs/mcp-server/basics#adding-a-prompt-handler), чтобы увидеть, как они работают на стороне клиента.

```rust
let args = ("lang", "Rust");
let prompt = client.prompts().get("hello_world_code", args).await?;
```

## Чтение ресурса {#read-a-resource}

Затем прочитаем ресурс, объявленный [здесь](/docs/mcp-server/basics#adding-a-resource-tempate-handler).
```rust
let resource = client.resources().read("res://resource-1").await?;
```

## Список инструментов, промптов и ресурсов

Наконец, вот как динамически изучить все доступные инструменты, промпты и ресурсы.

```rust
// Все инструменты, со всех страниц
let tools = client.tools().list_all().await?;

// Все ресурсы
let resources = client.resources().list_all().await?;

// Первая страница шаблонов ресурсов
let templates = client.resources().templates(None).await?;

// Все промпты
let prompts = client.prompts().list_all().await?;
```

`list_all()` обходит список страница за страницей и возвращает элементы
вместе. Если сервер всё ещё отдаёт страницы после 64-й, это **ошибка**, а не
частичный список: обрезанный список выглядел бы полным.

## Пагинация {#pagination}

Большие списки по умолчанию возвращаются постранично по 10 элементов.
Чтобы обходить их самостоятельно, `list(cursor)` запрашивает одну страницу:
`None` — первую, а [`next_cursor`](https://docs.rs/neva/latest/neva/types/cursor/struct.Cursor.html)
предыдущей страницы — следующую:

```rust
// Первые 10
let resources = client.resources().list(None).await?;

// Следующие 10
let resources = client.resources().list(resources.next_cursor).await?;

// Ещё 10
let resources = client.resources().list(resources.next_cursor).await?;
```

Списки на стороне сервера упорядочены детерминированно по имени, поэтому
постраничный обход больше не может пропустить или продублировать запись. См.
[Порядок в списке](../mcp-server/tools#listing-order).

## Совместное использование клиента {#sharing-a-client}

Все методы запросов принимают `&self`, поэтому подключённый клиент можно
разделить между задачами — положите его в `Arc` и клонируйте дескриптор:

```rust
use std::sync::Arc;
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_default_http());
    client.connect().await?;

    let client = Arc::new(client);
    let calls = ["London", "Paris", "Tokyo"].map(|city| {
        let client = client.clone();
        tokio::spawn(async move {
            client.tools().call("get_weather", ("city", city)).await
        })
    });

    for call in calls {
        println!("{:?}", call.await);
    }
    Ok(())
}
```

Настройка по-прежнему требует `&mut self`: `connect`, обработчики `map_*` и
`on_*` и корневые каталоги настраиваются до того, как клиент станет общим.

## Таймауты и отмена {#timeouts-and-cancellation}

Запрос, которого клиент перестал ждать, **отменяется** — когда он превышает
таймаут ([`with_timeout`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_timeout),
по умолчанию 10 секунд) и когда его future удаляется, например
`tokio::time::timeout` или проигравшей веткой `select!`:

```rust
use std::time::Duration;

// Удалён через секунду: сервер получит указание прекратить работу над ним.
let result = tokio::time::timeout(
    Duration::from_secs(1),
    client.tools().call("slow_report", ()),
).await;
```

Как об этом узнаёт сервер, зависит от транспорта. Через Streamable HTTP в MCP
2026-07-28 клиент закрывает поток ответа запроса — там это *и есть* отмена, и
`notifications/cancelled` не отправляется. Через stdio и легаси-узлу клиент
отправляет `notifications/cancelled`. В любом случае слот ожидания запроса
освобождается сразу, а запоздавший ответ на него отбрасывается. Запросы
брошенного [пакета](./batch) тоже отменяются; легаси-`initialize`, который
спецификация отменять не разрешает, — никогда.

## Кэширование

Каждый результат-список — а также `server/discover` и `resources/read` —
несёт `ttlMs` и `cacheScope`. В MCP 2026-07-28 это **обязательные** члены, а
не опциональные подсказки, поэтому клиент всегда знает, как долго результат
остаётся актуальным и кому его можно показывать:

| `cacheScope` | Смысл |
|---|---|
| `private` | Кэшируется только для этого клиента (значение по умолчанию) |
| `public` | Может использоваться разными клиентами |

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/client) доступен здесь.
