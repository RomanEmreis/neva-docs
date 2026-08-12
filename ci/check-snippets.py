#!/usr/bin/env python3
"""Compile the Rust snippets in docs/ that are marked for checking.

Docusaurus ignores unknown words in a code fence's metastring and does not
render them, so the marker lives there:

    ```rust compile
    ```rust compile-fragment
    ```rust compile features="server-full client-full"

Only marked blocks are checked. This is deliberate: plenty of snippets on the
site reference illustrative helpers that do not exist (`load(&id)`,
`charge_card()`, `my_redis_store`, ...), and stubbing those generically would
cost more than it catches. Mark a block once you have made it self-contained.

Modes
-----
compile
    The block is a complete set of items. Compiled as-is; `fn main() {}` is
    appended when the block has no `fn main` of its own.

compile-fragment
    The block is a run of statements meant to sit inside a tool handler. The
    `use` lines are hoisted to file scope and the rest is wrapped in

        async fn __snippet(mut ctx: Context, city: String) -> Result<String, Error>

    with a trailing `Ok(String::new())`, so fragments may use `ctx`, `city`,
    `?` and `return Err(...)`.

Features
--------
The feature set matters: `neva::types` re-exports the sampling types only
under `client`/`legacy-spec`, so a *server* page compiled with `full` would
hide a missing `use neva::types::sampling::...` that a real reader hits. The
default therefore follows the page's own audience:

    docs/mcp-server/**  ->  server-full
    docs/mcp-client/**  ->  client-full
    everything else     ->  full

Override per block with `features="..."` in the metastring.

Snippets that need different feature sets are compiled in separate crates,
since Cargo unifies features across a workspace.

Checking a tree where every block should compile
------------------------------------------------
`skill/` is the Agent Skill, read by a model rather than rendered, so its
markdown stays free of markers and the default is inverted instead:

    --default-mode compile --default-features full

Every `rust` fence is then checked, and a block that cannot be
self-contained opts out with an HTML comment on the line before it:

    <!-- snippet: skip -->
    <!-- snippet: compile-fragment -->
    <!-- snippet: features="client-full" -->

The comment form also works in docs/ and wins over the metastring.

Usage: python3 ci/check-snippets.py [--docs-dir docs] [--keep]
                                    [--default-mode {none,compile,compile-fragment}]
                                    [--default-features FEATURES]
Env:   NEVA_VERSION (default "0.5")
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FENCE = re.compile(r"^```rust([^\n]*)\n(.*?)^```", re.S | re.M)
# An optional directive on the line immediately above a fence. Wins over the
# metastring, and is how a marker-free tree (skill/) opts a block out.
DIRECTIVE = re.compile(r"<!--\s*snippet:([^>]*?)-->\s*\n\Z", re.S)
NEVA_VERSION = os.environ.get("NEVA_VERSION", "0.5")

FRAGMENT_HEAD = (
    "#[allow(unused, deprecated)]\n"
    "async fn __snippet(mut ctx: Context, city: String) -> Result<String, Error> {\n"
)
FRAGMENT_TAIL = "    Ok(String::new())\n}\nfn main() {}\n"


def default_features(path: Path) -> str:
    parts = path.as_posix()
    if "/mcp-server/" in parts:
        return "server-full"
    if "/mcp-client/" in parts:
        return "client-full"
    return "full"


def parse_meta(meta: str) -> tuple[str | None, str | None]:
    """Return (mode, features) from a fence metastring or a directive body."""
    mode = None
    for candidate in ("compile-fragment", "compile", "skip"):
        if re.search(rf"(^|\s){re.escape(candidate)}(\s|$)", meta):
            mode = candidate
            break
    features = None
    m = re.search(r'features="([^"]+)"', meta)
    if m:
        features = m.group(1)
    return mode, features


def directive_before(text: str, start: int) -> tuple[str | None, str | None]:
    """Read a `<!-- snippet: ... -->` sitting directly above the fence."""
    m = DIRECTIVE.search(text, 0, start)
    return parse_meta(m.group(1)) if m else (None, None)


def render(mode: str, body: str) -> str:
    if mode == "compile":
        if re.search(r"^\s*(async\s+)?fn main\s*\(", body, re.M):
            return body
        return body + "\nfn main() {}\n"
    uses, rest = [], []
    for line in body.splitlines():
        (uses if line.startswith("use ") else rest).append(line)
    indented = "\n".join(("    " + l) if l.strip() else l for l in rest)
    return "\n".join(uses) + "\n" + FRAGMENT_HEAD + indented + "\n" + FRAGMENT_TAIL


def collect(
    docs_dir: Path,
    fallback_mode: str = "none",
    fallback_features: str | None = None,
) -> list[dict]:
    snippets = []
    for md in sorted(docs_dir.rglob("*.md")):
        text = md.read_text(encoding="utf-8")
        for idx, m in enumerate(FENCE.finditer(text)):
            mode, features = parse_meta(m.group(1))
            d_mode, d_features = directive_before(text, m.start())
            mode = d_mode or mode or (fallback_mode if fallback_mode != "none" else None)
            if mode is None or mode == "skip":
                continue
            line = text.count("\n", 0, m.start()) + 1
            snippets.append(
                {
                    "name": f"{md.stem}_{idx}".replace("-", "_"),
                    "origin": f"{md}:{line}",
                    "features": d_features
                    or features
                    or fallback_features
                    or default_features(md),
                    "source": render(mode, m.group(2)),
                }
            )
    return snippets


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs-dir", default="docs", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the scratch crates")
    ap.add_argument(
        "--default-mode",
        default="none",
        choices=("none", "compile", "compile-fragment"),
        help="mode for blocks carrying no marker (default: skip them)",
    )
    ap.add_argument(
        "--default-features",
        default=None,
        help="features for blocks naming none (default: by directory)",
    )
    args = ap.parse_args()

    snippets = collect(args.docs_dir, args.default_mode, args.default_features)
    if not snippets:
        print("no snippets marked for compilation — nothing to check")
        return 0

    by_features: dict[str, list[dict]] = {}
    for s in snippets:
        by_features.setdefault(s["features"], []).append(s)

    print(f"checking {len(snippets)} snippet(s) in {len(by_features)} crate(s)\n")
    root = Path(tempfile.mkdtemp(prefix="neva-snippets-"))
    failed = []

    try:
        for features, group in sorted(by_features.items()):
            crate = root / re.sub(r"[^a-z0-9]+", "_", features)
            (crate / "src" / "bin").mkdir(parents=True)
            feature_list = ", ".join(f'"{f}"' for f in features.split())
            (crate / "Cargo.toml").write_text(
                "[package]\n"
                'name = "snippets"\n'
                'version = "0.0.0"\n'
                'edition = "2024"\n\n'
                "[dependencies]\n"
                f'neva = {{ version = "{NEVA_VERSION}", features = [{feature_list}] }}\n'
                'tokio = { version = "1", features = ["full"] }\n'
                'tracing = "0.1"\n'
                'tracing-subscriber = "0.3"\n'
                'serde = { version = "1", features = ["derive"] }\n'
                'serde_json = "1"\n\n'
                # detach from any enclosing workspace
                "[workspace]\n",
                encoding="utf-8",
            )
            for s in group:
                (crate / "src" / "bin" / f"{s['name']}.rs").write_text(
                    f"// from {s['origin']}\n{s['source']}", encoding="utf-8"
                )
                print(f"  [{features}] {s['origin']}")

            proc = subprocess.run(
                ["cargo", "build", "--manifest-path", str(crate / "Cargo.toml")],
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                failed.append(features)
                print(f"\n--- FAILED: features = {features} ---")
                print(proc.stderr)
            else:
                # warnings are worth surfacing but are not a gate
                warns = [l for l in proc.stderr.splitlines() if l.startswith("warning")]
                if warns:
                    print("    (warnings)")
                    for w in warns[:10]:
                        print(f"      {w}")
    finally:
        if args.keep:
            print(f"\nscratch crates kept at {root}")
        else:
            shutil.rmtree(root, ignore_errors=True)

    if failed:
        print(f"\nFAIL — {len(failed)} crate(s) did not compile: {', '.join(failed)}")
        return 1
    print(f"\nOK — all {len(snippets)} snippet(s) compiled")
    return 0


if __name__ == "__main__":
    sys.exit(main())
