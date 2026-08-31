---
sidebar_position: 2
---

# Инструменты

Model Context Protocol (MCP) позволяет серверам предоставлять [инструменты](https://modelcontextprotocol.io/specification/draft/server/tools), которые могут вызываться языковыми моделями. Инструменты позволяют моделям взаимодействовать с внешними системами: делать запросы к базам данных, вызывать API, выполнять вычисления. Каждый инструмент уникально идентифицируется по имени и содержит метаданные с описанием его схемы.

В главе [Основы](/docs/mcp-server/basics#setup-a-tool) мы научились объявлять простой инструмент:

```rust
use neva::prelude::*;

#[tool(descr = "A simple 'say hello' tool")]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

Того же результата можно добиться **без** использования процедурного макроса:

```rust
use neva::prelude::*;

async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}

#[tokio::main]
async fn main() {
    let mut mcp_server = App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_name("Sample MCP Server")
            .with_version("1.0.0"));

    mcp_server
        .map_tool("hello", hello)
        .with_description("A simple 'say hello' tool");

    mcp_server.run().await;
}
```

В примере выше имя инструмента должно быть задано явно.
При использовании атрибутного макроса [`#[tool]`](https://docs.rs/neva/latest/neva/attr.tool.html) имя инструмента автоматически выводится из имени функции.

Все остальные параметры инструмента, доступные в атрибутном макросе, можно настроить с помощью методов `with_*` (например, [`with_description()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_description)).

Метод [`map_tool()`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_tool) регистрирует обработчик инструмента под указанным именем и возвращает изменяемую ссылку на зарегистрированный [инструмент](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html).

## Схема входных данных {#input-schema}

Для инструмента можно явно задать схему входных данных.
Если схема не указана, Neva автоматически генерирует её на основе сигнатуры функции-обработчика.

Схемы — это полноценные документы **JSON Schema 2020-12** (`InputSchema`
поверх `serde_json::Value`), и макрос `#[tool]` формирует полные документы
2020-12 автоматически.

Для переопределения сгенерированной схемы укажите её в виде JSON-строки:

```rust
#[tool(
    descr = "A simple 'say hello' tool",
    input_schema = r#"{
        "properties": {
            "name": {
                "type": "string",
                "description": "The name to greet"
            }
        },
        "required": ["name"]
    }"#
)]
async fn hello(name: String) -> String {
    format!("Hello, {name}!")
}
```

Написанная вами схема публикуется **дословно**. Все ключевые слова, которые
neva не моделирует сама — `default`, `pattern`, `examples`, `$schema`,
`$defs`, `$ref`, `additionalProperties`, `allOf`/`anyOf`,
`if`/`then`/`else`, — попадают в список нетронутыми, как в корне, так и
глубже, поэтому клиент, проверяющий данные по опубликованной схеме,
принимает ровно то же, что принимает инструмент.

`"integer"` — самостоятельный тип, а не синоним `"number"`: поле, объявленное
как `integer`, отклоняет `1.5`, но по-прежнему принимает `1.0`, потому что
проверяется само значение, а не то, как оно записано.

## Схема выходных данных {#output-schema}

Если инструмент возвращает [**структурированные данные**](https://modelcontextprotocol.io/specification/draft/server/tools#tool-result) (например, JSON-объект),
Neva автоматически генерирует схему выходных данных на основе возвращаемого типа.

Как и в случае [схемы входных данных](/docs/mcp-server/tools#input-schema),
её можно переопределить вручную:

```rust
#[tool(
    descr = "A 'say hello' tool with structured output",
    output_schema = r#"{
        "properties": {
            "message": {
                "type": "string",
                "description": "The generated greeting message"
            }
        },
        "required": ["message"]
    }"#
)]
async fn hello(say: String, name: String) -> Json<Results> {
    let result = Results {
        message: format!("{say}, {name}!")
    };
    result.into()
}
```

## Необязательные аргументы {#optional-arguments}

Аргумент, объявленный как `Option<T>`, публикуется со своим внутренним типом
`T`, но не попадает в `required`; если вызов его не передал, обработчик
получает `None`, а не ошибку:

```rust
#[tool(descr = "Greets a person, by nickname when there is one")]
async fn greet(name: String, alias: Option<String>) -> String {
    format!("Hello, {}!", alias.unwrap_or(name))
}
```

Инструмент, у которого *все* аргументы необязательные, вообще не публикует
ключ `required`. Правило работает по разрешённому типу, поэтому псевдоним
типа (`type MaybeFloor = Option<i32>;`) ведёт себя так же, а
`Option<Json<T>>` по-прежнему описывает `T` целиком.

С промптами всё устроено так же — см.
[Промпты → Необязательные аргументы](./prompts#optional-arguments).

## Имена аргументов {#argument-names}

Аргументы вызова читаются из `arguments` **по имени**, а не по позиции —
значит, имена, по которым читает обработчик, обязаны совпадать с именами,
которые публикует `inputSchema`.

С `#[tool]` делать ничего не нужно: макрос берёт имена параметров самой
функции. Исключение — «голое» замыкание: Rust не сохраняет имена его
параметров, поэтому такой инструмент публикует и читает позиционные `arg0`,
`arg1`, … Макрос `map_tool!` считывает имена с замыкания за вас:

```rust
use neva::{App, map_tool};

#[tokio::main]
async fn main() {
    let mut app = App::new();

    map_tool!(app, "greet", |name: String, age: i32| async move {
        format!("Hello, {name}! You are {age}.")
    })
    .with_description("Greets a person");

    app.run().await;
}
```

[`with_arg_names()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_arg_names) —
то же самое в явном виде, для именованной функции или обработчика, который
вы объявили не по месту:

```rust
use neva::App;

async fn greet(name: String, age: i32) -> String {
    format!("Hello, {name}! You are {age}.")
}

#[tokio::main]
async fn main() {
    let mut app = App::new();

    app.map_tool("greet", greet)
        .with_arg_names(["name", "age"]);

    app.run().await;
}
```

Любой из двух вызовов переименовывает сгенерированную схему и имена для
извлечения **вместе**, так что разойтись они не могут. Именуются только
параметры, несущие значения: `Context`, `Meta<_>` и внедрённый через DI
`Dc<T>` пропускаются здесь ровно так же, как пропускаются в схеме.
`Option<T>` **именуется** — он занимает слот аргумента, просто не является
обязательным.

:::note Написанная вами схема никогда не переименовывается
Схема, заданная через `input_schema = "..."` или
[`with_input_schema()`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.with_input_schema),
берётся дословно — каждый ключ в ней выбран намеренно. Называйте её свойства
так же, как называете аргументы. Порядок этих двух вызовов не важен.
:::

### Проверка при старте {#startup-validation}

Инструмент или промпт, публикующий аргументы, которые его обработчик не
читает, не сможет успешно вызвать никто, поэтому `App::run` отказывается
стартовать при таком расхождении, а не падает на первом же вызове клиента —
это касается неверного количества объявленных имён, дубликата имени или
свойства схемы, которое обработчик не ищет.
[`Context::add_tool`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html#method.add_tool)
и `add_prompt` выполняют ту же проверку и возвращают ошибку: у примитива,
зарегистрированного на работающем сервере, старта, на котором можно упасть,
уже не осталось.

:::warning Изменение протокола в v0.5.2
Инструмент, зарегистрированный из «голого» замыкания, теперь объявляет
`arg0`, `arg1`, … там, где раньше ключами свойств были имена *типов*, а
`|a: i32, b: i32|` публикует два свойства там, где два слота `i32` раньше
схлопывались в одно. Инструментов, объявленных через `#[tool]`, это не
касается. Если вы регистрируете инструменты из замыканий и хотите вернуть
прежние имена в протоколе, задайте их явно через `map_tool!` или
`with_arg_names()`.
:::

## Дублирование аргумента в заголовок {#x-mcp-header}

Инструмент может попросить, чтобы один из его аргументов дополнительно
передавался в HTTP-заголовке — тогда прокси и шлюзы смогут маршрутизировать
и ограничивать трафик по нему, не разбирая тело запроса. Пометьте свойство в
`inputSchema` аннотацией `x-mcp-header`, и клиенты продублируют значение в
заголовок `Mcp-Param-{name}` при `tools/call`:

```rust
#[tool(
    descr = "Fetches a tenant's dashboard",
    input_schema = r#"{
        "properties": {
            "tenant": {
                "type": "string",
                "description": "Tenant identifier",
                "x-mcp-header": true
            }
        },
        "required": ["tenant"]
    }"#
)]
async fn dashboard(tenant: String) -> String {
    format!("Dashboard for {tenant}")
}
```

Серверы *могут* использовать аннотацию; клиенты **обязаны** её соблюдать.
Собственный клиент neva запоминает аннотации из `tools/list` и добавляет
заголовки автоматически, а сервер отклоняет `tools/call`, у которого
заголовок расходится с телом, с ошибкой `HeaderMismatch` (`-32020`).

### Регистрации живут ровно столько, сколько список {#header-registration-ttl}

То, что клиент узнал из `tools/list`, действительно только в течение `ttlMs`
этого списка, а отсутствующий `ttlMs` читается как `0` — то есть аннотации
годны на этот обмен и не дольше. Когда они истекли, `HeaderMismatch`
заставляет клиента заново запросить список и один раз повторить вызов; этот
свежий список годится для повтора независимо от собственного TTL — только
для отклонённого инструмента и только для этого обмена.

Это важно, если вы меняете аннотации `x-mcp-header` инструмента на лету:
задавайте такой `ttlMs`, которого готовы придерживаться, и рассчитывайте на
один лишний round-trip `tools/list` после изменения — вместо навсегда
неверного заголовка.

:::warning
Определение, нарушающее ограничения спецификации — имя не является токеном,
дубликат, непримитивный тип или свойство, недостижимое статически через
`properties`, — исключает из списка **весь инструмент**. Это сделано
намеренно: одно неверное определение не должно менять то, что отправляет
корректное. Правило действует для Streamable HTTP; другие транспорты вправе
игнорировать аннотацию.
:::

## Неизвестные атрибуты отклоняются {#unknown-attributes-are-rejected}

`#[tool]`, `#[resource]`, `#[resources]`, `#[prompt]` и `#[handler]`
**отклоняют** атрибут, которого не знают:

```rust
#[tool(descr = "…", visibilty = ["app"])]   // ошибка: неизвестный атрибут `visibilty`
```

:::info Изменено в 0.5.6
Раньше незнакомый атрибут молча игнорировался. Мотивирующий случай — опечатка в
`visibility`, из-за которой [инструмент только для приложения](#giving-a-tool-a-ui)
публиковался агенту: важная для безопасности настройка выглядела применённой, но
не была. Если вызов макроса, который раньше собирался, вдруг перестал — этот
атрибут никогда ничего не делал.
:::

## Как дать инструменту UI {#giving-a-tool-a-ui}

Инструмент может указывать на HTML-документ, который хост рендерит в песочнице
iframe, — это [MCP Apps](./apps), за фичей `apps`:

```rust
#[tool(descr = "Current weather", ui = "ui://weather/dashboard")]
async fn get_weather(city: String) -> String {
    format!("Sunny in {city}.")
}
```

Инструмент при этом всё равно возвращает фразу: инструмент с UI **ОБЯЗАН**
вернуть осмысленный массив `content`, потому что модель читает `content`, а
iframe есть не у каждого клиента. `visibility = ["app"]` помечает инструмент,
который может вызывать iframe и не должна видеть модель. Половину с ресурсом
см. в [MCP Apps](./apps).

## Порядок в списке {#listing-order}

Реестры инструментов, промптов и ресурсов основаны на `BTreeMap`, поэтому
`tools/list` возвращает записи **упорядоченными по имени**, и порядок
стабилен между вызовами. Именно это делает безопасной курсорную
[пагинацию](../mcp-client/basics.md#pagination) — при произвольном порядке
записи могли бы пропадать или дублироваться между страницами, — а ещё
позволяет промпт-кэшам LLM попадать по неизменившемуся списку инструментов.

## MCP-контекст {#mcp-context}

В более сложных сценариях — например, когда инструменту нужен доступ к ресурсам, объявленным на том же MCP-сервере, — можно внедрить [Context](https://docs.rs/neva/latest/neva/app/context/struct.Context.html) в обработчик инструмента:

```rust
#[tool(descr = "Fetches resource metadata")]
async fn read_resource(ctx: Context, res: Uri) -> Result<Content, Error> {
    let result = ctx.resource(res).await?;
    let resource = result.contents
        .into_iter()
        .next()
        .expect("No resource contents");
    Ok(Content::resource(resource))
}
```


## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/server) доступен здесь.
