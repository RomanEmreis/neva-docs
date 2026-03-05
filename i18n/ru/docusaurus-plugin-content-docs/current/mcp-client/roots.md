---
sidebar_position: 5
---

# Корневые каталоги

Model Context Protocol (MCP) предоставляет стандартизированный способ для клиентов предоставлять серверам файловые «корневые каталоги». [Корневые каталоги](https://modelcontextprotocol.io/specification/draft/client/roots) определяют границы, в пределах которых серверы могут работать в файловой системе, позволяя им понять, к каким директориям и файлам у них есть доступ. Серверы могут запрашивать список корневых каталогов у поддерживающих клиентов и получать уведомления при изменении этого списка.

## Настройка корневых каталогов

Можно указать один или несколько корневых каталогов, которые будут предоставлены серверу.
Корневые каталоги можно добавлять до или после подключения клиента.
* Корневые каталоги, добавленные **до** `connect()`, отправляются при первоначальном рукопожатии.
* Корневые каталоги, добавленные **после** `connect()`, требуют возможности `roots.listChanged`.

### Добавление корневых каталогов
```rust
use neva::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let mut client = Client::new()
        .with_options(|opt| opt
            .with_stdio(
                "cargo",
                ["run", "--manifest-path", "./neva-mcp-server/Cargo.toml"]));

    // Добавляем корневые каталоги, доступные при первоначальном рукопожатии
    client.add_root("file:///home/user/projects/my_project", "My Project");

    client.connect().await?;

    // Динамически добавляем дополнительные корневые каталоги после подключения
    client.add_roots([
        ("file:///home/user/projects/another_project", "My Another Project"),
        ("file:///home/user/projects/one_more_project", "One More Project"),
    ]);

    // Вызов инструмента, чтение ресурса ....

    client.disconnect().await
}
```

## Уведомление сервера об изменении списка корневых каталогов

Если корневые каталоги добавляются или удаляются **после** подключения клиента, включите
возможность `roots.listChanged`, чтобы сервер мог получать уведомления об изменениях.
```rust
let mut client = Client::new()
    .with_options(|opt| opt
        .with_roots(|roots| roots.with_list_changed())
        .with_stdio(
            "cargo",
            ["run", "--manifest-path", "./neva-mcp-server/Cargo.toml"]));
```

Включайте `roots.listChanged` только если:
* Корневые каталоги изменяются после `connect()`
* Сервер рассчитывает на динамическое получение обновлений корневых каталогов

Если все корневые каталоги известны заранее, эта возможность не требуется.

## Доступ к корневым каталогам на сервере

На стороне сервера корневые каталоги, предоставленные клиентом, доступны через
`Context` запроса. Корневые каталоги могут быть получены при первоначальном рукопожатии или
динамически обновляться через возможность `roots.listChanged`.

Для доступа к текущему списку корневых каталогов внедрите [`Context`](https://docs.rs/neva/latest/neva/app/context/struct.Context.html)
в обработчик инструмента:

```rust
#[tool]
async fn roots_request(mut ctx: Context) -> Result<(), Error> {
    let list = ctx.list_roots().await?;

    // Каждый корневой каталог содержит URI и человекочитаемое имя
    for root in list.roots {
        tracing::info!(uri = %root.uri, name = %root.name);
    }

    Ok(())
}
```

## Обучение на примерах
Полный [пример](https://github.com/RomanEmreis/neva/tree/main/examples/roots) доступен здесь.
