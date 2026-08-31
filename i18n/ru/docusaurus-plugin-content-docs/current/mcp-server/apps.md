---
sidebar_position: 20
---

# MCP Apps

**MCP Apps** ([SEP-1865](https://github.com/modelcontextprotocol/ext-apps)) даёт
инструменту лицо: HTML-документ, который хост рендерит в песочнице iframe и в
который передаёт результат инструмента. Это первое официальное расширение MCP,
объявляемое как `capabilities.extensions["io.modelcontextprotocol/ui"]`.

Включается фичей `apps` (входит в `server-full`).

```toml
[dependencies]
neva = { version = "0.5", features = ["server-macros", "apps"] }
```

## За что на самом деле отвечает сервер

Спецификация большая, но до сервера доходит меньшая её часть. У неё две
половины, и только одна из них — трафик MCP:

| Половина | Между кем | Транспорт | Ваш сервер |
|---|---|---|---|
| **Плоскость данных** | сервер ↔ клиент | JSON-RPC MCP | Обслуживает её — блок `_meta.ui` на инструменте и HTML-ресурс `ui://` |
| **Плоскость представления** | хост ↔ iframe | JSON-RPC поверх `postMessage` | Не видит никогда |

Всё, что называется `ui/*` — `ui/initialize`, `ui/notifications/tool-result`,
`ui/open-link`, контекст хоста, темизация — это трафик браузера между хостом и
iframe. Сервер на neva его не отправляет и не принимает, и neva его не
моделирует. **Ваш сервер отдаёт инструмент и HTML-документ; спектакль устраивает
хост.**

:::warning Инструмент с UI всё равно обязан отвечать текстом
Единственное поведенческое требование спецификации к обработчику: инструмент с
UI **ОБЯЗАН** вернуть осмысленный массив `content`. Модель читает `content`;
iframe — для людей, и не у каждого клиента он есть. Возвращайте фразу, а не
голое значение — приложение отрендерит ту же строку.
:::

:::note На сервере — только 2026-07-28
`with_apps()`, `add_ui_resource` и `map_ui_resource` вырезаются при
[`legacy-spec`](../legacy-spec): расширение едет в `capabilities.extensions`,
которому в прошлом поколении нет места. *Клиентская* половина работает в обоих
профилях.
:::

## Включение

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt
            .with_stdio()
            .with_apps())
        .run()
        .await;
}
```

[`with_apps()`](https://docs.rs/neva/latest/neva/app/options/struct.McpOptions.html#method.with_apps)
объявляет расширение и берёт настройки по умолчанию. Как и у Tasks, серверная
capability — **пустой объект**: спецификация определяет настройки только для
клиентского направления, так что серверу нечего сказать кроме «поддерживаю», и
метод не принимает замыкание.

Без него у хоста нет причин вообще смотреть на блоки `_meta.ui`.

## Две половины приложения

Всегда две, никогда одна:

1. **инструмент**, который делает работу и возвращает данные, как любой другой;
2. **ресурс `ui://`** с HTML, который это отрисовывает.

Инструмент несёт `_meta.ui.resourceUri`; хост забирает этот ресурс через
`resources/read` и открывает на нём iframe.

```rust
use neva::prelude::*;

/// Обратите внимание, что возвращается: фраза, а не голая метка времени.
/// Модель читает `content` независимо от того, есть UI или нет.
#[tool(descr = "The current time.", ui = "ui://clock/app.html")]
async fn get_time() -> String {
    format!("The time is {}.", now())
}

fn now() -> String {
    "12:00:00 UTC".into()
}

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.add_ui_resource("ui://clock/app.html", "clock", "<!doctype html>…")
        .with_title("Clock")
        .with_descr("A ticking clock")
        .with_prefers_border(true);

    app.run().await;
}
```

Это вся серверная часть. Макрос ставит на инструмент `_meta.ui.resourceUri`, а
[`add_ui_resource`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.add_ui_resource)
регистрирует обработчик чтения и подставляет MIME-тип
`text/html;profile=mcp-app`.

## Как отдать документ

### Фиксированный HTML — `add_ui_resource`

Один вызов регистрирует обработчик чтения `ui://`, проставляет MIME-тип и
возвращает `&mut` для остальной настройки. Возвращённая ссылка **живёт всю
цепочку**: ресурс материализуется при старте сервера, а не при возврате из
вызова, поэтому билдер, вызванный позже, тоже учитывается.

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.add_ui_resource("ui://weather/dashboard", "dashboard", "<!doctype html>…")
        .with_title("Weather dashboard")
        .with_descr("Today's forecast")
        .with_csp(UiCsp::new()
            .with_connect_domains(["https://api.openweathermap.org"]))
        .with_permissions(UiPermissions::new().with_geolocation())
        .with_prefers_border(true);

    app.run().await;
}
```

| Билдер | Что задаёт |
|---|---|
| `with_title` / `with_descr` | Человекочитаемые заголовок и описание |
| `with_csp` | Источники, которые нужны приложению — см. [Блок безопасности](#блок-безопасности) |
| `with_permissions` | Разрешения браузера, которые iframe *запрашивает* |
| `with_domain` | Просит хост отдавать приложение с выделенного origin песочницы |
| `with_prefers_border` | Нужны ли приложению видимая рамка и фон |
| `with_ui` | Заменяет весь блок `_meta.ui` целиком — запасной путь для блока, собранного в другом месте |

### Сгенерированный HTML — ресурс `ui://` как любой другой

Когда разметка вычисляется — читается с диска, шаблонизируется, собирается в
момент чтения — регистрируйте её так же, как любой ресурс. **Схема `ui://` и
есть то, что помечает его как приложение**, дальше макрос всё делает сам:
подставляет MIME-тип `text/html;profile=mcp-app` и проверяет блок `ui_meta` на
этапе компиляции.

```rust
use neva::prelude::*;

/// Один документ на все отчёты.
#[resource(
    uri = "ui://report/view",
    title = "Report",
    descr = "Renders whichever report the tool just returned",
    ui_meta = r#"{
        "csp": { "resourceDomains": ["https://cdn.jsdelivr.net"] },
        "prefersBorder": false
    }"#
)]
async fn report_view() -> TextResourceContents {
    TextResourceContents::new("ui://report/view", "<!doctype html>…")
}

/// Половина с данными. Идентификатор едет в *результате*, а не в URI ресурса.
#[tool(descr = "Show a report.", ui = "ui://report/view")]
async fn show_report(id: String) -> String {
    format!("Report {id}: all green.")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio().with_apps())
        .run()
        .await;
}
```

Ни `_meta.ui`, ни MIME-тип на возвращаемом содержимом не заданы. Для чтения
`ui://` сервер подставляет и то и другое: блок из атрибута опускается на элемент
содержимого — единственное место, куда смотрит поток, идущий от инструмента, — а
MIME-тип приложения проставляется, потому что
[`TextResourceContents::new`](https://docs.rs/neva/latest/neva/types/struct.TextResourceContents.html#method.new)
иначе отдал бы `text/plain`, который не рендерит ни один хост.

Верните собственный блок через `TextResourceContents::with_ui(..)`, если он
меняется от ответа к ответу. Он **заменяет** блок атрибута целиком, а не
сливается с ним — таков приоритет, который спецификация задаёт хосту.

Без макросов то же самое делает
[`map_ui_resource`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_ui_resource):
он проставляет MIME-тип шаблона и регистрирует настоящий шаблон, поэтому тот
появляется в `resources/templates/list`:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.map_ui_resource("ui://report/{id}", "report", |id: String| async move {
        TextResourceContents::new(
            format!("ui://report/{id}"),
            format!("<!doctype html><title>Report {id}</title>"),
        )
        .with_mime(APP_MIME_TYPE)
    });

    app.run().await;
}
```

:::warning URI, на который указывает инструмент, не может быть шаблоном
Хост забирает `_meta.ui.resourceUri` **буквально** — никто не подставляет в него
аргументы инструмента, — поэтому `ui://report/{id}` будет прочитан как литерал и
отрендерит отчёт для `{id}`.

Это не пробел в спецификации, а её замысел: документ — статическая, кэшируемая,
проверяемая половина, а данные приезжают в iframe как результат инструмента.
**Один документ, все отчёты.** Привяжите инструмент к конкретному URI, а
идентификатор пусть едет в результате. О шаблонной привязке сервер предупреждает
на старте.
:::

## Привязка инструмента

Через макрос:

```rust
#[tool(descr = "Current weather", ui = "ui://weather/dashboard")]
async fn get_weather(city: String) -> String {
    format!("Sunny in {city}.")
}
```

Или на инструменте, зарегистрированном вручную, через
[`with_ui`](https://docs.rs/neva/latest/neva/types/struct.Tool.html#method.with_ui):

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio().with_apps());

    app.map_tool("get_weather", |city: String| async move {
        format!("Sunny in {city}.")
    })
        .with_arg_names(["city"])
        .with_ui("ui://weather/dashboard");

    app.run().await;
}
```

### Видимость: инструменты, которые вызывает приложение, а модель не видит

Дашборду часто нужна кнопка обновления — инструмент, который вызывает iframe и
которому нечего делать в списке инструментов агента. Об этом говорит
`visibility`:

```rust
#[tool(
    descr = "Re-read the clock.",
    ui = "ui://clock/app.html",
    visibility = ["app"]
)]
async fn refresh_clock() -> String {
    format!("The time is {}.", now())
}
```

Области — `"model"` и `"app"`; отсутствие `visibility` означает обе, это
значение по умолчанию из спецификации.

:::warning Соблюдение — забота хоста, а не сервера
Инструмент только для приложения перечисляется в `tools/list` как любой другой.
Из списка инструментов агента его убирает **хост**, читая `_meta.ui.visibility`.
Это подсказка для UI, а не контроль доступа: если инструмент не должен
вызываться недоверенным клиентом, закройте его через
[`with_roles`](./oauth#роли-и-права) или middleware — ровно так же, как без UI.
:::

## Блок безопасности

`_meta.ui` на ресурсе — это то, что хост превращает в Content-Security-Policy и
атрибут `allow` у iframe.

| Поле | Тип | Что означает |
|---|---|---|
| `csp.connectDomains` | `string[]` | Источники, к которым приложение может делать `fetch` или открывать сокет |
| `csp.resourceDomains` | `string[]` | Источники, откуда оно может грузить скрипты, стили, изображения и шрифты |
| `csp.frameDomains` | `string[]` | Источники, которые оно может встраивать во вложенный фрейм |
| `csp.baseUriDomains` | `string[]` | Источники, допустимые в элементе `<base>` |
| `permissions` | camera, microphone, geolocation, clipboardWrite | Разрешения браузера, которые нужно *запросить* |
| `domain` | `string` | Выделенный origin песочницы — **формат задаёт хост**, смотрите его документацию |
| `prefersBorder` | `bool` | Нужны ли приложению видимая рамка и фон |

Три вещи, которые стоит знать:

* **Отсутствие блока — это ограничительное умолчание.** Приложение, не
  объявившее ничего, не получает никакого внешнего доступа — безопасное
  умолчание и правильное для самодостаточного документа.
* **Сюда входят все источники, включая ваши собственные.** Приложение работает в
  песочнице без своего origin-сервера, поэтому назвать нужно и то место, откуда
  берутся его собственные скрипты и стили.
* **`permissions` — это запрос, а не выдача.** Хост может их проигнорировать, так
  что в документе проверяйте наличие возможности, а не предполагайте её.

В форме билдера это [`UiCsp`](https://docs.rs/neva/latest/neva/types/struct.UiCsp.html)
и [`UiPermissions`](https://docs.rs/neva/latest/neva/types/struct.UiPermissions.html);
в форме атрибута — JSON-литерал в `ui_meta`, проверяемый при компиляции.

## Что макросы ловят при компиляции

`_meta` — открытая карта: опечатка в ключе спокойно сериализуется, а потом
игнорируется всеми хостами — блок безопасности, который молча ничего не делает.
Макросы закрывают эту дыру, пока литералы ещё под рукой:

| Вы пишете | Вы получаете |
|---|---|
| `ui = "app.html"` | `ui` должен быть URI `ui://` — схема и есть то, что помечает ресурс как приложение |
| `visibility = ["agent"]` | Неизвестная область видимости, ожидалось одно из: model, app |
| `ui_meta = r#"{ "prefers_border": true }"#` | Неизвестный ключ `prefers_border` — на проводе ключи в camelCase |
| `ui_meta = r#"{ "csp": { "connect_domains": [] } }"#` | Неизвестный ключ в `ui_meta.csp` |
| `ui_meta = r#"{ "csp": [] }"#` | `ui_meta.csp` должен быть объектом |
| `#[resource(uri = "ui://x", mime = "text/html")]` | Ресурс `ui://` отдаётся как `text/html;profile=mcp-app` и никак иначе |
| `ui_meta` на ресурсе не с `ui://` | Блок что-то значит только на ресурсе `ui://`; в остальных местах хосты его игнорируют |

:::info Новое в 0.5.6: неизвестные атрибуты отклоняются
`#[tool]`, `#[resource]`, `#[resources]`, `#[prompt]` и `#[handler]` теперь
**отклоняют** незнакомый атрибут вместо того, чтобы его игнорировать. Мотивирующий
случай ровно с этой страницы: опечатка в `visibility` публиковала агенту
инструмент, предназначенный только для приложения. Если существующий вызов
макроса вдруг перестал компилироваться — этот атрибут никогда ничего не делал.
:::

Две ошибки, которые макросам не поймать, проверяются на старте и логируются как
предупреждения: инструмент указывает на ресурс `ui://`, который **никто не
обслуживает** (запрос `resources/read` у хоста упадёт, и инструмент отрисуется
без UI), и `resourceUri` содержит шаблонный сегмент. `Tool::with_ui` — путь без
макросов — единственное место, где может проскочить и схема не `ui://`, поэтому
о ней там тоже предупреждают.

## Перечисление ресурсов `ui://`

По умолчанию ресурс `ui://` отвечает на `resources/read` и **не попадает** в
`resources/list`. Спецификация это разрешает: хост находит приложения через
`_meta.ui.resourceUri` инструмента, а UI-шаблон — не то, что просматривает
пользователь.

Включайте, когда хотите дать хостам возможность изучить блок безопасности каждого
приложения при подключении: зарегистрируйте расширение напрямую вместо обёртки
`with_apps()`:

```rust
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio())
        .with_extension(AppsExtension::new().with_listed_resources());

    app.add_ui_resource("ui://clock/app.html", "clock", "<!doctype html>…")
        .with_title("Clock");

    app.run().await;
}
```

Переключатель читается при старте сервера, поэтому применяется к каждому
`add_ui_resource` независимо от порядка вызовов билдера.

## Авторизация

Ресурс, зарегистрированный через `add_ui_resource`, **не несёт требований к ролям
или правам**: на [защищённом OAuth сервере](./oauth) его прочтёт любой, кто до
него дотянется.

Обычно это правильно. Документ — шаблон, который хост как раз должен заранее
забрать и проверить при подключении, а данные для него приходят из инструмента, у
которого `with_roles` есть. Если ограничивать нужно саму разметку, регистрируйте
её через `map_ui_resource` и вешайте требование на возвращённый
`ResourceTemplate`. Требование прямо на `add_ui_resource`
[отслеживается в #123](https://github.com/RomanEmreis/neva/issues/123).

## Сторона View

Документ — сам по себе MCP-клиент, говорящий JSON-RPC поверх `postMessage`, и
открывается он как любой клиент. Порядок здесь не украшение: хост **НЕ ДОЛЖЕН**
отправлять View ничего, пока не увидит `ui/notifications/initialized`, а это
уведомление идёт только после завершённого `ui/initialize`. Пропустите одно из
них — и соответствующий спецификации хост придержит результат инструмента,
оставив документ на заглушке.

```html
<script>
  // Регистрируется до конца рукопожатия: хост может прислать результат сразу,
  // как увидит `initialized`, и слушатель, добавленный позже, его пропустит.
  on("ui/notifications/tool-result", (result) => {
    document.getElementById("out").textContent = result?.content?.[0]?.text;
  });

  await request("ui/initialize", {
    appInfo: { name: "Clock", version: "0.1.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: "2026-01-26",
  });
  notify("ui/notifications/initialized");
</script>
```

На практике вручную это не пишут — браузерный SDK
([`@modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps))
делает рукопожатие и отдаёт `ontoolresult`, `callServerTool` и
`getHostContext`. Здесь всё расписано потому, что это та половина, которую
Rust-автор никогда не видит в своём коде — и потому легко забывает поставить.

Обратите внимание на версию протокола: `2026-01-26` относится к спецификации
**MCP Apps**, а не к MCP.

## Что ещё не сделано в 0.5.6

| Пробел | Issue |
|---|---|
| Обработчик пока не может спросить, умеет ли вызывающая сторона рендерить UI, и значит не может менять от этого свой `content`. Отвечайте хорошим текстом всегда — спецификация этого и требует | [#122](https://github.com/RomanEmreis/neva/issues/122) |
| Серверу, говорящему на MCP 2026-07-28, клиент на neva не объявляет никаких расширений: в этом поколении нет рукопожатия, на котором их можно передать | [#122](https://github.com/RomanEmreis/neva/issues/122) |
| `add_ui_resource` не принимает требований к ролям или правам | [#123](https://github.com/RomanEmreis/neva/issues/123) |

## Что дальше

* [MCP Apps на клиенте](../mcp-client/apps) — объявление capability и чтение
  метаданных
* [Инструменты](./tools) — всё, чем является инструмент, с UI и без
* [Ресурсы](./resources) — общий механизм ресурсов, на котором едет `ui://`
* [`examples/apps`](https://github.com/RomanEmreis/neva/tree/main/examples/apps) —
  рабочие сервер и клиент, включая View с полным рукопожатием
