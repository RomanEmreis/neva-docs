---
sidebar_position: 6
---

import useBaseUrl from '@docusaurus/useBaseUrl';

# Agent Skill

Готовый [Agent Skill](https://agentskills.io/specification), который учит
кодового ассистента писать на neva правильно, — тот же материал, что и на
этом сайте, но переупакованный под модель, а не под читателя.

<a href={useBaseUrl('/neva-skill.zip')} download className="button button--primary button--lg">Скачать neva-skill.zip</a>

Исходники: [`skill/neva`](https://github.com/RomanEmreis/neva-docs/tree/main/skill/neva).

## Зачем это нужно {#why-you-might-want-it}

Ассистенты уверенно ошибаются в MCP на Rust, и причина структурная: MCP
**2026-07-28** сломал совместимость со всем, что было до него, а почти весь
материал по MCP, который модель видела, — включая все прочие SDK — описывает
предыдущее поколение. Поэтому типичная ошибка — не забытое имя метода. Это
ассистент, который пишет рукопожатие `initialize`, тянется к `ping`,
открывает SSE-поток `GET` или считает `ctx.elicit` обычным `await` в
обработчике, который списывает деньги с карты.

Скилл выносит ровно эти ловушки вперёд, а за подробностями отправляет в
нужный файл.

## Что внутри {#what-is-in-it}

| Файл | О чём |
|---|---|
| `SKILL.md` | Определение версии и профиля, список ловушек, минимальные сервер и клиент, маршрутизация |
| `references/server.md` | Инструменты, промпты, ресурсы, схемы, имена аргументов, типы контента, DI, middleware, логи, подписки, рассылка между экземплярами |
| `references/client.md` | Подключение, вызовы, структурированные результаты, батчи, подписки, ответы на input-запросы, задачи |
| `references/mrtr.md` | Модель повторного выполнения, `memo` / `once` / `on_commit`, режимы elicitation, задачи |
| `references/http.md` | Транспорты, TLS, JWT и OAuth 2.1 (обе стороны, DPoP, CIMD, grants), DNS-rebinding, остановка сервера, свои движки, фича-флаги, развёртывание на нескольких экземплярах |
| `references/troubleshooting.md` | Коды ошибок, «симптом → причина», всё удалённое в этом поколении |
| `references/legacy.md` | Профиль `legacy-spec` и переход с 0.4.x на 0.5.x |

`SKILL.md` намеренно короткий: это точка входа, которую агент читает всегда,
и шесть справочников, которые он подгружает только под задачу.

## Установка {#install}

Формат SKILL.md — общий стандарт, поэтому установка везде одинаковая:
распаковать и **скопировать каталог `neva/` в папку скиллов инструмента**,
сохранив имя каталога — оно обязано совпадать с полем `name` во frontmatter.

| Инструмент | Персонально | В проекте |
|---|---|---|
| Claude Code | `~/.claude/skills/neva/` | `.claude/skills/neva/` |
| opencode | `~/.config/opencode/skills/neva/` | `.opencode/skills/neva/` |
| Codex CLI | `~/.codex/skills/neva/` | `.codex/skills/neva/` |

```bash
unzip neva-skill.zip
mkdir -p ~/.claude/skills && cp -r neva ~/.claude/skills/
```

После этого перезапустите ассистента — скиллы обнаруживаются при старте.

opencode дополнительно читает `.claude/skills/` и `.agents/skills/`, так что
одной копии внутри проекта может хватить сразу на несколько инструментов.

### Всё остальное {#anything-else}

Подойдёт любой ассистент, умеющий читать файлы. Укажите ему на `SKILL.md` и
дайте пройти по ссылкам — или добавьте строку в `AGENTS.md` проекта:

```markdown
For Rust MCP work with the `neva` crate, read `.agents/skills/neva/SKILL.md`
and the reference file it routes you to.
```

## Код в нём компилируется {#the-code-in-it-compiles}

Каждый Rust-сниппет скилла собирается против опубликованного крейта `neva` в
CI этого репозитория — больше семидесяти штук, — поэтому то, что ассистент
оттуда копирует, действительно компилируется. В этом и смысл скилла вместо
пересказа: ассистент, вставляющий правдоподобный API, хуже того, который
вставляет проверенный.

Запустить проверку самому после правок:

```bash
python3 ci/check-snippets.py --docs-dir skill --default-mode compile --default-features full
```

## Версия {#version}

Скилл описывает neva **0.5.5** / MCP **2026-07-28**, легаси-поколение
вынесено отдельно. Обе версии записаны во frontmatter, чтобы ассистент мог
понять, соответствует ли скилл крейту перед ним:

```yaml
metadata:
  neva-version: "0.5.5"
  mcp-protocol: "2026-07-28"
```
