---
sidebar_position: 6
sidebar_label: Мост svir
---

# Как отдать инструменты модели

MCP-сервер описывает инструменты, модель их вызывает. Между ними — цикл,
который предлагает инструменты модели, выполняет её вызовы и возвращает
результаты. [svir](https://docs.rs/svir) — сторона модели в этом цикле:
описания инструментов, вызовы и результаты для function calling и трейт
[`Toolbox`](https://docs.rs/svir/latest/svir/trait.Toolbox.html), из которого
запрос берёт свои инструменты. Своего MCP у svir нет.

Фича `svir` — это мост: она реализует `Toolbox` поверх MCP, так что
инструменты сервера — удалённого или вашего собственного — можно отдать модели
как есть.

| Toolbox | Что предлагает | Вызов — это |
|---|---|---|
| [`RemoteTools::new(client)`](#a-remote-servers-tools) | Инструменты подключённого сервера | `tools/call` через клиента |
| [`App::into_toolbox()`](#your-own-tools-in-process) | Инструменты этого сервера; по MCP приложение ничего не обслуживает | Выполнение в этом процессе, через конвейер сервера |
| [`App::with_toolbox()`](#serving-and-calling-at-once) | То же, пока сервер продолжает обслуживать MCP | Выполнение в этом процессе |
| [`ctx.tools().toolbox()`](#a-tool-that-drives-a-model) | Внутри обработчика — остальные инструменты сервера, в тех пределах, в каких их может вызвать этот запрос | Выполнение в этом процессе |

Промпты и ресурсы — не инструменты: в MCP промпт выбирает пользователь, а
ресурс — приложение, поэтому они превращаются в [сообщения svir](#prompts-and-resources).
А на запрос сервера на сэмплирование можно [ответить моделью](#answering-sampling-with-a-model).

## Как включить мост {#enabling-the-bridge}

```toml
[dependencies]
neva = { version = "0.7", features = ["client-full", "svir"] }  # или server-full
svir = "0.1.4"
tokio = { version = "1", features = ["full"] }
```

`svir` не входит ни в один пресет — ни в `full`, ни в `server-full`, ни в
`client-full`. svir пока в версии `0.x`, и пресет, включающий его, превращал
бы каждый ломающий релиз svir в ломающий релиз neva.

neva подключает svir без его компонентов по умолчанию: типы и трейт `Toolbox`,
без HTTP-клиента. Модель вызывается напрямую через svir, поэтому добавьте svir в
свои зависимости — его компоненты по умолчанию приносят клиент и TLS.

`svir::Error`, которым завершается вызов модели, преобразуется в `Error` neva,
так что `?` передаёт его дальше. В преобразованном сообщении — собственное
описание сбоя от svir: сообщение сервера модели, в котором может фигурировать
учётная запись, остаётся в `source` ошибки svir и никогда не уходит MCP-узлу в
ответ.

## Инструменты удалённого сервера {#a-remote-servers-tools}

[`RemoteTools`](https://docs.rs/neva/latest/neva/svir/struct.RemoteTools.html)
принимает подключённый `Client` — сам клиент или `Arc` с ним, которым
пользуется остальная программа, — и предлагает инструменты сервера:

```rust
use neva::{Client, svir::RemoteTools};
use svir::Toolbox;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = Client::new()
        .with_options(|opt| opt.with_http(|http| http.bind("127.0.0.1:3000").with_endpoint("/mcp")));
    client.connect().await?;

    // Инструменты сервера, предложенные как `board_add_task` и т. д.
    let tools = RemoteTools::new(client).with_prefix("board_").load().await?;

    let model = svir::Client::openai("http://127.0.0.1:1234").build()?;
    let mut request = svir::Request::new("qwen3")
        .system("You keep the user's task board with the tools you have.")
        .tools(&tools)
        .user("Put three tasks on the board for the release, then show it to me.");

    // Отвечаем на вызовы модели, пока она не ответит пользователю.
    for _ in 0..8 {
        let done = model.complete(&request).await?;
        if done.calls.is_empty() {
            println!("{}", done.text);
            return Ok(());
        }
        // Каждый вызов — это `tools/call`; вызовы одного хода идут параллельно.
        let results = tools.call_all(&done.calls).await;
        request = request.assistant(done).tool_results(results);
    }

    Err("the model kept calling tools".into())
}
```

Описания инструментов — это **снимок**: `Toolbox::tools` синхронный, а список
приходит по сети постранично. `load()` делает первый снимок, а `refresh()`
обновляет его — например, когда сервер присылает
`notifications/tools/list_changed`. Вызвать можно только инструменты из
снимка: модели, назвавшей другой, сообщат, что такого инструмента нет.

`tools.client()` снова даёт доступ к клиенту — к остальному, что предлагает
сервер: его промптам и ресурсам.

## Что предлагать модели {#choosing-what-is-offered}

Какими инструментами может пользоваться модель, решаете вы, а не сервер:

```rust
let tools = RemoteTools::new(client)
    .filter(|tool| !tool.name.starts_with("admin_"))
    .rename(|name| name.replace('.', "_"))
    .with_prefix("gh_")
    .load()
    .await?;
```

* **`filter`** оставляет инструмент, только если его оставляет каждый фильтр.
  Каждый фильтр видит инструмент таким, каким его перечислил сервер, под
  серверным именем — где бы фильтр ни стоял среди переименований.
* **`rename`** предлагает инструмент под другим именем, а вызов уходит под тем,
  которое знает сервер. Переименования применяются по порядку, каждое — к
  имени, полученному от предыдущих. **`with_prefix`** — переименование,
  добавляющее префикс; так в одном запросе разводят инструменты двух серверов.

Имя функции, которое принимает API модели, — `[a-zA-Z0-9_-]{1,64}`, тогда как
MCP допускает ещё `.` и до 128 символов. Инструмент, чьё имя после
переименований не проходит, или два инструмента с одним именем **проваливают
снимок**, а не переименовываются за вашей спиной: молчаливое переименование
заставило бы модель вызывать инструмент по имени, на которое никто не
отзывается. Переименуйте его или отфильтруйте. Неудачный `refresh()` сохраняет
предыдущий снимок.

Некоторые инструменты не предлагаются никогда:

* инструмент, который можно вызвать только как задачу (`task_support = "required"`);
* с фичей `apps` — инструмент, который [MCP Apps](./mcp-server/apps#visibility-tools-the-app-calls-and-the-model-never-sees)
  скрывает от модели;
* при вызове в процессе — инструмент, требующий [ролей или разрешений](#what-an-in-process-call-holds),
  которых у вызывающего нет.

## Что сообщается модели {#what-the-model-is-told}

Для модели результат инструмента — строка, поэтому содержимое сводится в одну:

| Содержимое | Сообщается как |
|---|---|
| Текстовые блоки | Их текст, разделённый пустой строкой |
| Структурированное содержимое | JSON-текст — только если текстовых блоков нет: инструмент, возвращающий и то и другое, сериализует те же данные в текст |
| Встроенный текстовый или JSON-ресурс | Его текст или его JSON |
| Ссылка на ресурс | Её имя и URI |
| Изображение, аудио, бинарный ресурс | **Ошибка**, называющая то, что нельзя передать |

Результат, помеченный инструментом как ошибка, и вызов, отклонённый сервером,
сообщаются как ошибка с её текстом. Ничего не теряется молча: о том, что модель
принять не может, ей сообщают — и она может сказать об этом сама.

Аргументы модели уходят так, как их принимает `tools/call`. Вызов без
аргументов приходит примерно одинаково часто как `{}`, пустая строка или
`null`, и все три означают «без аргументов»; всё остальное, что не является
JSON-объектом, — ошибка модели, о которой ей и сообщают.

## Свои инструменты, в том же процессе {#your-own-tools-in-process}

Инструмент, написанный один раз через `#[tool]`, можно отдать модели без
MCP-транспорта посередине. [`App::into_toolbox`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.into_toolbox)
поглощает сервер и возвращает его инструменты как
[`LocalTools`](https://docs.rs/neva/latest/neva/svir/struct.LocalTools.html):

```rust
use neva::prelude::*;

#[tool(descr = "Adds two numbers")]
fn add(a: i64, b: i64) -> i64 {
    a + b
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = App::new();

    // По MCP ничего не обслуживается: настроенный здесь транспорт не стартует.
    let tools = app.into_toolbox().load().await?;

    let request = svir::Request::new("qwen3")
        .tools(&tools)
        .user("What is 2 + 40?");
    // ... тот же цикл, что и выше.
    let _ = request;
    Ok(())
}
```

Каждый вызов — это `tools/call`, выполняемый **через тот же конвейер**, что и
вызов по MCP. Его видят промежуточные обработчики сервера — авторизация,
ограничения частоты, аудит применяются к модели так же, как к любому другому
вызывающему, — а инструмент получает свой `Context` и внедрённые зависимости
(`Dc<T>`) так же, как по MCP. `filter`, `rename` и `with_prefix` работают как у
`RemoteTools`, а `refresh()` подхватывает инструменты, добавленные или
удалённые после снимка.

Чего нет, так это **узла на той стороне**. Инструмент, который запрашивает
ввод — получение данных, сэмплирование, корневые каталоги, — отклоняется сразу,
а не ждёт, а его уведомления о прогрессе и записи журнала уходят в никуда.

### Обслуживать и вызывать одновременно {#serving-and-calling-at-once}

[`App::with_toolbox`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.with_toolbox)
делает и то и другое: сервер работает как настроен, а toolbox вызывает те же
инструменты в этом процессе.

```rust
use neva::prelude::*;

#[tool(descr = "Adds two numbers")]
fn add(a: i64, b: i64) -> i64 {
    a + b
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let app = App::new().with_options(|opt| opt.with_default_http());

    let (app, tools) = app.with_toolbox();
    tokio::spawn(app.run());

    // Ждёт, пока `run` соберёт сервер.
    let tools = tools.load().await?;
    // Обслуживается по HTTP и предлагается модели здесь.
    let _ = tools;
    Ok(())
}
```

Toolbox привязывается к серверу, когда его собрал `run`, поэтому `load()` этого
ждёт. Он завершается ошибкой, если сервер удалён, так и не запустившись, или
остановился раньше.

## Инструмент, который управляет моделью {#a-tool-that-drives-a-model}

Внутри обработчика [`ctx.tools().toolbox()`](https://docs.rs/neva/latest/neva/app/context/api/struct.Tools.html#method.toolbox)
предлагает **остальные** инструменты сервера — это форма оркестратора,
инструмента, который передаёт задачу модели вместе со всем остальным сервером:

```rust
use neva::{di::Dc, prelude::*};
use svir::Toolbox;

#[tool(descr = "Plans the week, keeping the board up to date")]
async fn plan_week(ctx: Context, model: Dc<svir::Client>, focus: String) -> Result<String, Error> {
    // Все остальные инструменты сервера — в тех пределах, в каких их может вызвать этот запрос.
    let tools = ctx.tools().toolbox().load().await?;

    let mut request = svir::Request::new("qwen3")
        .tools(&tools)
        .user(format!("Plan my week around {focus}."));

    for _ in 0..8 {
        let done = model.complete(&request).await?;
        if done.calls.is_empty() {
            return Ok(done.text);
        }
        let results = tools.call_all(&done.calls).await;
        request = request.assistant(done).tool_results(results);
    }

    Err(Error::new(ErrorCode::InternalError, "the model kept calling tools"))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let model = svir::Client::openai("http://127.0.0.1:1234").build()?;

    App::new()
        .with_options(|opt| opt.with_default_http())
        .add_singleton(model)
        .run()
        .await;
    Ok(())
}
```

Два ограничения не дают такому инструменту вызывать себя бесконечно:

* **Инструмент, в котором взят toolbox, исключается.** Модель, вызвавшая
  `plan_week` изнутри `plan_week`, начала бы весь цикл заново внутри всё ещё
  идущего вызова. Инструмент, которому рекурсия нужна намеренно, оставляет себя
  через `with_caller()`.
* **Вызовы в процессе вкладываются не глубже четырёх уровней.** `a` вызывает
  `b`, который снова вызывает `a`: исключение вызывающего останавливает прямую
  петлю, глубина ограничивает остальное. Вызов за пределом не выполняется, а
  модели объясняют почему. `with_max_depth(n)` меняет предел для этого toolbox.

Глубина считается по цепочке, каким бы toolbox ни делались вызовы: toolbox из
`App::into_toolbox`, сохранённый и вызванный внутри обработчика, считается
таким же глубоким, как взятый из `Context` обработчика. В задаче, которую
обработчик запускает отдельно, глубину знает только toolbox из `Context`.

### Что несёт вызов в процессе {#what-an-in-process-call-holds}

Toolbox из `ctx.tools().toolbox()` несёт **claims текущего запроса**:
инструмент, до которого эти claims не дотягиваются, не предлагается, а
проверки сервера видят их при каждом вызове. Toolbox из `App::into_toolbox` или
`App::with_toolbox` взят вне какого-либо запроса и claims не несёт, поэтому
инструмент, требующий [ролей или разрешений](./mcp-server/http#управление-доступом-на-основе-ролей),
он не предлагает вовсе.

## Промпты и ресурсы {#prompts-and-resources}

[`prompt_messages`](https://docs.rs/neva/latest/neva/svir/fn.prompt_messages.html)
превращает промпт в сообщения, которыми он открывает разговор, а
[`resource_parts`](https://docs.rs/neva/latest/neva/svir/fn.resource_parts.html)
превращает ресурс в части, которые к разговору прикрепляются:

```rust
use neva::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = Client::new().with_options(|opt| opt.with_default_http());
    client.connect().await?;

    // Разговор открывается собственным промптом сервера.
    let prompt = client.prompts().get("plan_week", [("focus", "the release")]).await?;
    let request = neva::svir::prompt_messages(prompt)?
        .into_iter()
        .fold(svir::Request::new("qwen3"), svir::Request::message);

    // Ресурс, прикреплённый к вопросу.
    let notes = client.resources().read("file:///notes.md").await?;
    let question = neva::svir::resource_parts(notes)?
        .into_iter()
        .fold(svir::Message::user("Summarise these notes."), svir::Message::with);

    let _request = request.message(question);
    client.disconnect().await?;
    Ok(())
}
```

Промпт сохраняет роли, а идущие подряд сообщения одной роли становятся одним
ходом. Текст остаётся текстом, изображение — изображением, встроенный ресурс
прикрепляется так же, как его прикрепляет `resource_parts`, а ссылка на ресурс
— это её имя и URI. Текст ресурса становится текстовым файлом, названным по его
URI, — так модель узнаёт, откуда он взялся, — и его JSON тоже; бинарное
изображение — изображением. Аудио и прочее бинарное содержимое — **ошибка**, а
не молчаливый пропуск. Описание промпта предназначено пользователю, а не
модели, и опускается.

## Ответ на сэмплирование моделью {#answering-sampling-with-a-model}

Сервер, запрашивающий у клиента сэмпл, хочет ровно того, что делает svir.
[`sampling_request`](https://docs.rs/neva/latest/neva/svir/fn.sampling_request.html)
превращает `sampling/createMessage` в запрос к модели, а
[`sampling_result`](https://docs.rs/neva/latest/neva/svir/fn.sampling_result.html)
превращает ответ модели в сэмпл, который получает сервер:

```rust
use neva::prelude::*;
use neva::types::sampling::CreateMessageRequestParams;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let model = svir::Client::openai("http://127.0.0.1:1234").build()?;

    let mut client = Client::new().with_options(|opt| opt.with_default_http());

    // Сэмплирование устарело в MCP 2026-07-28 (см. страницу «Сэмплирование»).
    #[allow(deprecated)]
    client.map_sampling(move |params: CreateMessageRequestParams| {
        let model = model.clone();
        async move {
            let request = neva::svir::sampling_request("qwen3", params)?;
            // Недоступная модель проваливает сэмпл, а не клиента.
            let done = model.complete(&request).await?;
            neva::svir::sampling_result(&request, done)
        }
    });

    client.connect().await?;
    let result = client.tools().call("summarize_report", [("topic", "EMEA")]).await?;
    println!("{:?}", result.content);
    client.disconnect().await?;
    Ok(())
}
```

Обработчик [может завершиться ошибкой](./mcp-client/sampling#a-handler-that-can-fail):
в MCP 2026-07-28 ошибкой завершается вызов, который запросил сэмпл, а под
`legacy-spec` ошибка становится ответом серверу.

Что переносится: системный промпт, сообщения, инструменты, `maxTokens` и
`temperature`. Роли сохраняются; блок `tool_use` — это вызов в ходе ассистента,
а каждый `tool_result` — отдельное сообщение инструмента, сведённое так же, как
ответ инструмента сводится для модели. `toolChoice: none` убирает инструменты.

Аудио, стоп-последовательности и `toolChoice: required` передать нельзя — это
**ошибка**. То, что спецификация оставляет клиенту, опускается:
`includeContext`, `modelPreferences` — модель выбираете вы — и `metadata`
провайдера.

Сэмпл — это текст модели, а за ним блок `tool_use` на каждый вызов, каждый со
своим идентификатором, чтобы `tool_result`, который пришлёт сервер, его нашёл.
Причина остановки — `toolUse`, если модель вызвала инструмент, а иначе следует
тому, почему она остановилась: `endTurn`, `maxTokens` или `contentFilter`.

## Обучение на примерах

[`examples/svir`](https://github.com/RomanEmreis/neva/tree/main/examples/svir) —
доска задач, написанная один раз через `#[tool]` и `#[prompt]` и отданная
модели двумя способами: по MCP с вызовами из клиента через `RemoteTools` или в
том же процессе через `App::into_toolbox`. Подойдёт любой OpenAI-совместимый
сервер модели — LM Studio, llama.cpp, vLLM, облачный эндпоинт.

О стороне модели — потоковой передаче, слоях, собственном `Toolbox` — см.
[документацию svir](https://romanemreis.github.io/svir-docs/).
