---
sidebar_position: 3
---

# Формы обработчиков

Любая точка регистрации в neva — инструменты, промпты, ресурсы, списки
ресурсов, автодополнение, собственные обработчики запросов, а также
клиентские обработчики sampling и elicitation — принимает обработчик в одной
из **двух форм**:

```rust compile
use neva::prelude::*;

// Асинхронная: возвращает future, который сервер ожидает.
#[tool(descr = "Здоровается, но не сразу")]
async fn greet_later(name: String) -> String {
    format!("Привет, {name}!")
}

// Синхронная: возвращает само значение.
#[tool(descr = "Здоровается")]
fn greet(name: String) -> String {
    format!("Привет, {name}!")
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .run()
        .await;
}
```

Форма определяется по сигнатуре — объявлять ничего не нужно. Публикуемая схема,
слоты аргументов и ответ в обоих случаях одинаковы, так что выбор касается
только того, как выполняется тело.

## Как выбрать форму

Вопрос не в том, короткая ли функция, а в том, **что тело делает с потоком,
который ему выдали**.

| Тело | Пишем | Выполняется |
|---|---|---|
| **Ожидает** что-то — HTTP-вызов, асинхронный драйвер БД, другого MCP-участника через `Context` | `async fn` или замыкание, возвращающее `async`-блок | На рантайме, уступая управление на каждом `await` |
| **Считает** по данным, которые уже на руках — арифметика, форматирование, поиск в map, фильтрация `Vec` | обычный `fn` | Inline, на том же потоке рантайма, который принял запрос |
| **Блокируется** — `std::fs`, синхронный драйвер БД или HTTP, `Command::output`, долгие вычисления | обычный `fn`, зарегистрированный через [`blocking`](#nevablocking) | На blocking-пуле Tokio |

Вторая строка — самая дешёвая: ни спавна задачи, ни точки уступки, ни
опроса. Третья существует потому, что синхронный обработчик, который
**действительно** блокируется, удерживает воркер рантайма на всё время
работы, и этот воркер в это время не опрашивает ничего другого.

:::warning `blocking` на коротком теле — это пессимизация
Передача `a + b` на другой поток стоит куда дороже самого сложения. Берите
`blocking` тогда, когда тело реально блокируется, а не просто потому, что
оно синхронное.
:::

## Где принимаются обе формы

Обе формы работают в любой точке регистрации, на обеих сторонах протокола:

| Сторона | Принимают обе формы |
|---|---|
| Сервер, методы | [`App::map_tool`](https://docs.rs/neva/latest/neva/app/struct.App.html#method.map_tool), `map_prompt`, `map_resource`, `map_resources`, `map_completion`, `map_handler`, `map_ui_resource` |
| Сервер, конструкторы | [`Tool::new`](https://docs.rs/neva/latest/neva/types/tool/struct.Tool.html#method.new), [`Prompt::new`](https://docs.rs/neva/latest/neva/types/prompt/struct.Prompt.html#method.new) |
| Сервер, макросы | `#[tool]`, `#[prompt]`, `#[resource]`, `#[resources]`, `#[completion]`, `#[handler]`, а также макросы `map_tool!` / `map_prompt!` |
| Клиент | [`Client::map_sampling`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.map_sampling), [`Client::map_elicitation`](https://docs.rs/neva/latest/neva/client/struct.Client.html#method.map_elicitation), `#[sampling]`, `#[elicitation]` |

С замыканиями всё так же:

```rust compile
use neva::prelude::*;

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio());

    // Синхронное замыкание — возвращает значение.
    app.map_tool("add", |a: i32, b: i32| a + b)
        .with_arg_names(["a", "b"]);

    // Асинхронное замыкание — возвращает future.
    app.map_tool("add_later", |a: i32, b: i32| async move { a + b })
        .with_arg_names(["a", "b"]);

    app.run().await;
}
```

Напомним: **голое замыкание** публикует `arg0`, `arg1`, … — Rust не
сохраняет имена его параметров. Форма обработчика тут ничего не меняет,
поэтому оба вызова выше называют аргументы явно. См.
[Имена аргументов](./tools#startup-validation).

## `neva::blocking`

[`blocking`](https://docs.rs/neva/latest/neva/fn.blocking.html) оборачивает
синхронный обработчик так, чтобы тот выполнялся на blocking-пуле Tokio, а не
на потоке рантайма, принявшем запрос. Обёртка принимается в любой точке
регистрации, так что одного адаптера хватает на все:

```rust compile
use neva::{prelude::*, blocking};

#[tokio::main]
async fn main() {
    let mut app = App::new()
        .with_options(|opt| opt.with_stdio());

    app.map_tool("read_file", blocking(|path: String| {
        std::fs::read_to_string(path).unwrap_or_default()
    }))
    .with_arg_names(["path"]);

    app.run().await;
}
```

`blocking` принимает **синхронный** обработчик. Асинхронному нечего
выгружать — он и так уступает управление, — поэтому такой вызов отвергается
на этапе компиляции.

### Атрибут `blocking`

Каждый атрибутный макрос принимает флаг `blocking`, который применяет ту же
обёртку за вас. Работает во всех восьми: `#[tool]`, `#[prompt]`,
`#[resource]`, `#[resources]`, `#[completion]`, `#[handler]`, `#[sampling]`
и `#[elicitation]`.

```rust compile
use neva::prelude::*;

#[tool(descr = "Читает текстовый файл", blocking)]
fn read_file(path: String) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .run()
        .await;
}
```

На `async fn` атрибут — **ошибка компиляции**, по той же причине, что и
функциональная форма: выгружать с рантайма нечего.

### Две особенности, о которых стоит знать

* **Паника пробрасывается**, а не проглатывается. Паника внутри обработчика
  попадает в ожидающую задачу ровно так же, как если бы обработчик выполнился
  inline, — выгрузка не должна менять поведение паникующего обработчика.
* **Выгруженная задача не отменяется вместе с запросом.** Начавшись, она
  доходит до конца, а её результат отбрасывается. Блокирующее тело нельзя
  прервать снаружи, поэтому обработчику, который должен уметь остановиться
  раньше, нужен собственный флаг.

## Ошибки работают так же

Синхронный обработчик возвращает `Result` ровно так же, как асинхронный, и
модель ошибок не меняется: у инструмента `Err` становится *ошибкой
инструмента* — успешным ответом с `is_error: true`, — а у ресурса или
промпта это JSON-RPC-ошибка, заваливающая запрос. См.
[Обработку ошибок](./error-handling).

```rust compile
use neva::prelude::*;

#[tool(descr = "Делит два числа")]
fn divide(a: f64, b: f64) -> Result<f64, Error> {
    if b == 0.0 {
        return Err(Error::new(ErrorCode::InvalidParams, "деление на ноль"));
    }
    Ok(a / b)
}

#[tokio::main]
async fn main() {
    App::new()
        .with_options(|opt| opt.with_stdio())
        .run()
        .await;
}
```

## `neva::marker` — форма как тип {#nevamarker}

Две формы невозможно различить через `where`-условие: реализации для них
пересеклись бы, а когерентность это запрещает. Поэтому форма едет
**маркером на уровне типов** —
[`neva::marker::Async`](https://docs.rs/neva/latest/neva/marker/struct.Async.html)
или [`marker::Immediate`](https://docs.rs/neva/latest/neva/marker/struct.Immediate.html)
— в трейтах обработчиков:

```rust
pub trait ToolHandler<Args, M = marker::Async>: HandlerFn<Args, M> { … }
```

У маркера есть **значение по умолчанию**, и он выводится из обработчика в
точке регистрации. На практике в коде обработчиков он не появляется, а
ограничение вида `ToolHandler<Args>` значит ровно то же, что и до появления
синхронных обработчиков.

Обработчик под `blocking(..)` тоже несёт `marker::Immediate` — это синхронный
обработчик с другой стратегией выполнения, а не третья форма.

Вызову, который выписывает дженерики вручную, придётся указать и маркер —
`app.map_tool::<_, _, (String,), _>("greet", greet)`. Тем, кто оставляет работу
выводу типов — а так их обычно и пишут, — не нужно ничего.

## Что дальше

* [Инструменты](./tools) — схемы, имена аргументов, типы содержимого
* [Обработка ошибок](./error-handling) — что значит `Err` для каждого вида обработчика
* [Внедрение зависимостей](./di) — инъекция сервисов в обработчик любой формы
* [Elicitation](./elicitation) — почему точка elicit заставляет обработчик *перезапускаться*
