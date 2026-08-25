---
sidebar_position: 6
---

import useBaseUrl from '@docusaurus/useBaseUrl';

# Agent Skill

A packaged [Agent Skill](https://agentskills.io/specification) that teaches
a coding assistant to write neva correctly — the same material as this site,
reorganised for a model rather than a reader.

<a href={useBaseUrl('/neva-skill.zip')} download className="button button--primary button--lg">Download neva-skill.zip</a>

Source: [`skill/neva`](https://github.com/RomanEmreis/neva-docs/tree/main/skill/neva).

## Why you might want it

Assistants are confidently wrong about MCP in Rust, and for a structural
reason: MCP **2026-07-28** broke compatibility with everything before it,
while nearly all the MCP material a model has seen — including every other
SDK — describes the previous generation. So the failure mode is not a
forgotten method name. It is an assistant writing an `initialize`
handshake, reaching for `ping`, opening an SSE `GET` stream, or treating
`ctx.elicit` as a plain await in a handler that charges a card.

The skill front-loads exactly those traps, then routes to detail on demand.

## What is in it

| File | Covers |
|---|---|
| `SKILL.md` | Establishing the version and profile, the non-negotiables, minimal server and client, routing |
| `references/server.md` | Tools, prompts, resources, schemas, argument names, content types, DI, middleware, logging, subscriptions, cross-instance fan-out |
| `references/client.md` | Connecting, calling, structured results, batching, subscribing, answering input requests, tasks |
| `references/mrtr.md` | The re-run model, `memo` / `once` / `on_commit`, elicitation modes, tasks |
| `references/http.md` | Transports, TLS, JWT and OAuth 2.1 (both sides, DPoP, CIMD, grants), DNS-rebinding, shutdown, custom engines, feature flags, multi-instance deploy |
| `references/troubleshooting.md` | Error codes, symptom → cause, everything removed in this generation |
| `references/legacy.md` | The `legacy-spec` profile and the 0.4.x → 0.5.x upgrade |

`SKILL.md` stays short on purpose: an entrypoint an agent always reads, and
six references it loads only when the task needs one.

## Install

The SKILL.md format is a shared standard, so installation is the same
everywhere: unzip and **copy the `neva/` directory into the tool's skills
folder**, keeping the folder name — it has to match the `name` in the
frontmatter.

| Tool | Personal | Per project |
|---|---|---|
| Claude Code | `~/.claude/skills/neva/` | `.claude/skills/neva/` |
| opencode | `~/.config/opencode/skills/neva/` | `.opencode/skills/neva/` |
| Codex CLI | `~/.codex/skills/neva/` | `.codex/skills/neva/` |

```bash
unzip neva-skill.zip
mkdir -p ~/.claude/skills && cp -r neva ~/.claude/skills/
```

Restart the assistant afterwards — skills are discovered at startup.

opencode also reads `.claude/skills/` and `.agents/skills/`, so a single
copy inside a project can serve more than one tool.

### Anything else

Any assistant that can read a file will do. Point it at `SKILL.md` and let
it follow the links, or add a line to the project's `AGENTS.md`:

```markdown
For Rust MCP work with the `neva` crate, read `.agents/skills/neva/SKILL.md`
and the reference file it routes you to.
```

## The code in it compiles

Every Rust snippet in the skill is compiled against the published `neva`
crate in this repository's CI — 70-plus of them — so what an assistant
copies out of it builds. That is the whole point of shipping a skill rather
than a prose summary: an assistant that pastes a plausible-looking API is
worse than one that pastes a verified one.

To run the check yourself after editing:

```bash
python3 ci/check-snippets.py --docs-dir skill --default-mode compile --default-features full
```

## Version

The skill tracks neva **0.5.5** / MCP **2026-07-28**, with the legacy
generation documented separately. The frontmatter records both, so an
assistant can tell whether the skill matches the crate in front of it:

```yaml
metadata:
  neva-version: "0.5.5"
  mcp-protocol: "2026-07-28"
```
