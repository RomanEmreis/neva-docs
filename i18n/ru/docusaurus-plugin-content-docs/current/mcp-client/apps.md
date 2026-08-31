---
sidebar_position: 13
---

# MCP Apps

Клиентская половина [MCP Apps](../mcp-server/apps): объявить, что эта сторона
умеет рендерить приложение, а потом прочитать, у каких инструментов оно есть,
какие из них может видеть модель и чего просит блок безопасности документа.

Включается фичей `apps` (входит в `client-full`).

```toml
[dependencies]
neva = { version = "0.5", features = ["client", "apps"] }
```

:::info Клиент на neva — не браузер
Трафик `ui/*` — рукопожатие, доставка результата инструмента, темизация — идёт
между **хостом** и его iframe внутри браузера. neva его не моделирует. Что она
даёт — это ту часть, которая нужна хосту от MCP-библиотеки: объявить расширение,
найти инструменты с лицом, забрать HTML и знать, какие инструменты может видеть
модель. Рендеринг — ваш.
:::

## Объявление capability

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio("cargo", ["run", "--manifest-path", "./server/Cargo.toml"])
            .with_apps());

    client.connect().await?;
    client.disconnect().await
}
```

[`with_apps()`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_apps)
объявляет `io.modelcontextprotocol/ui` с единственным типом содержимого, который
определяет спецификация, — `text/html;profile=mcp-app`. Сервер смотрит на это,
прежде чем предлагать инструмент с UI вместо чисто текстового.

`mimeTypes` **обязателен** по спецификации — клиент, не назвавший ни одного, не
объявил поддержку, — поэтому метод его заполняет, а не объявляет пустой объект,
как это делает серверная сторона.

Чтобы назвать другой набор, используйте
[`with_app_mime_types`](https://docs.rs/neva/latest/neva/client/options/struct.McpOptions.html#method.with_app_mime_types):

```rust
use neva::prelude::*;

fn main() {
    let client = Client::new()
        .with_options(|opt| opt.with_app_mime_types([APP_MIME_TYPE]));
    let _ = client;
}
```

Первая редакция спецификации определяет только этот тип; остальные
зарезервированы.

:::warning Объявляйте, только если здесь что-то рендерит
Объявление расширения — это обещание **рендерить**. Делайте его, когда процесс
встраивает webview, показывающий HTML, или когда он сам является хостом,
передающим документ дальше, — но не ради чтения метаданных, которое работает и
без объявления.
:::

### Куда это отправляется, а куда нет

Объявление едет на рукопожатии `initialize`, внутри `capabilities.extensions`.
Это покрывает каждое соединение в сборке с
[`legacy-spec`](../legacy-spec) и запасной путь в сборке 2026-07-28.

Серверу, который говорит на MCP 2026-07-28, клиент на neva сейчас не объявляет
**ничего**: это поколение
[заменило рукопожатие на discovery](../spec-2026-07-28#discovery-вместо-рукопожатия)
и возит capabilities в `_meta` каждого запроса — канал, для расширений пока не
подключённый. Отслеживается в
[#122](https://github.com/RomanEmreis/neva/issues/122).

Ничему на этой странице это не мешает: чтение метаданных из `tools/list` и
`resources/read` не требует согласования. Значит это лишь то, что сервер пока не
может *менять* свой ответ в зависимости от того, умеете ли вы рендерить.

:::note Новое в 0.5.6
`ClientCapabilities::extensions` больше не привязан к поколению протокола, так
что легаси-`initialize` может его нести. Изменение аддитивное; его двойник в
`ServerCapabilities` остаётся только для 2026-07-28.
:::

## Поиск инструментов с лицом

[`Tool::ui()`](https://docs.rs/neva/latest/neva/types/struct.Tool.html#method.ui)
читает блок `_meta.ui` обратно:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio("cargo", ["run", "--manifest-path", "./server/Cargo.toml"])
            .with_apps());

    client.connect().await?;

    let tools = client.list_tools(None).await?;

    for tool in tools.tools.iter() {
        // Текстовый ответ есть у каждого инструмента; лицо — не у каждого.
        let Some(ui) = tool.ui() else {
            println!("{}: no UI", tool.name);
            continue;
        };

        let audience = if tool.is_model_visible() {
            "model + app"
        } else {
            "app only"
        };
        println!("{}: {} -> {:?}", tool.name, audience, ui.resource_uri);
    }

    client.disconnect().await
}
```

| Метод | Отвечает на вопрос |
|---|---|
| `tool.ui()` | Блок `UiToolMeta` — `resource_uri` и `visibility` — либо `None` для обычного инструмента |
| `tool.is_model_visible()` | Может ли агент видеть и вызывать этот инструмент? |
| `tool.is_app_visible()` | Может ли его вызывать iframe? |

Оба предиката дают `true` для инструмента вообще без метаданных MCP Apps и для
того, у которого `visibility` опущен: тогда действует умолчание спецификации
`["model", "app"]`. Только явный `visibility`, из которого область исключена,
делает соответствующий предикат `false`.

`ui()` намеренно снисходителен в одну сторону и строг в другую. Он принимает и
**устаревший плоский** ключ `_meta["ui/resourceUri"]` — этого спецификация ждёт
от читателя (вложенный блок имеет приоритет, если есть оба), — а некорректный
блок читается как отсутствующий, а не роняет весь `tools/list`. Предикаты
видимости этой снисходительности **не** разделяют: явный `visibility`, который не
удалось разобрать, **запрещает**, так что испорченный блок никогда не протолкнёт
инструмент для приложения в список агента.

:::warning Фильтрация — ваша задача
Сервер перечисляет инструменты только для приложения в `tools/list` как любые
другие: метаданные и есть весь механизм. Хост **НЕ ДОЛЖЕН** класть в список
инструментов агента тот, для которого `is_model_visible()` вернул `false`. За вас
этого никто не сделает.
:::

## Получение документа

Это тот самый `resources/read`, который хост делает перед открытием iframe:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio("cargo", ["run", "--manifest-path", "./server/Cargo.toml"])
            .with_apps());

    client.connect().await?;

    let tools = client.list_tools(None).await?;

    if let Some(uri) = tools
        .get("get_time")
        .and_then(|tool| tool.ui())
        .and_then(|ui| ui.resource_uri)
    {
        let result = client.read_resource(uri).await?;
        for contents in result.contents.iter() {
            println!(
                "{} [{}] {} bytes",
                contents.uri(),
                contents.mime().unwrap_or("?"),
                contents.text().map(str::len).unwrap_or_default()
            );
            // Блок, который хост превращает в CSP и атрибут `allow`.
            println!("  _meta.ui: {:?}", contents.ui());
        }
    }

    client.disconnect().await
}
```

Чтение `ui://` всегда возвращается как `text/html;profile=mcp-app`. Блок
`_meta.ui` несёт `csp`, `permissions`, `domain` и `prefersBorder` — что означает
каждое поле, см. в
[Блоке безопасности](../mcp-server/apps#блок-безопасности).

:::warning Отсутствие — не разрешение
Отсутствующий `_meta.ui` или отсутствующий `csp` внутри него — это
**ограничительное** умолчание: никакого внешнего доступа. Не читайте его как «не
задано, значит можно» — это переворачивает замысел спецификации и отдаёт
недоверенному документу сеть.
:::

:::note Новое в 0.5.6
Методы доступа
[`ResourceContents`](https://docs.rs/neva/latest/neva/types/enum.ResourceContents.html)
— `uri`, `text`, `blob`, `json`, `mime`, `title`, `annotations` — теперь доступны
и в клиентской сборке. Раньше они были только серверными, из-за чего клиенту
приходилось разбирать варианты перечисления руками. *Билдеры* остаются
серверными.
:::

## Что дальше

* [MCP Apps на сервере](../mcp-server/apps) — как отдавать инструмент и документ
* [Инструменты](./tools) — вызов инструментов и структурированные результаты
* [Ресурсы](./resources) — общий механизм `resources/read`
* [`examples/apps`](https://github.com/RomanEmreis/neva/tree/main/examples/apps) —
  рабочая пара, клиент и сервер
