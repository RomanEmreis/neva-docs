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

Usage: python3 ci/check-snippets.py [--docs-dir docs] [--keep]
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
    """Return (mode, features) from a fence metastring."""
    mode = None
    for candidate in ("compile-fragment", "compile"):
        if re.search(rf"(^|\s){re.escape(candidate)}(\s|$)", meta):
            mode = candidate
            break
    features = None
    m = re.search(r'features="([^"]+)"', meta)
    if m:
        features = m.group(1)
    return mode, features


def render(mode: str, body: str) -> str:
    if mode == "compile":
        if re.search(r"^\s*fn main\s*\(", body, re.M):
            return body
        return body + "\nfn main() {}\n"
    uses, rest = [], []
    for line in body.splitlines():
        (uses if line.startswith("use ") else rest).append(line)
    indented = "\n".join(("    " + l) if l.strip() else l for l in rest)
    return "\n".join(uses) + "\n" + FRAGMENT_HEAD + indented + "\n" + FRAGMENT_TAIL


def collect(docs_dir: Path) -> list[dict]:
    snippets = []
    for md in sorted(docs_dir.rglob("*.md")):
        text = md.read_text(encoding="utf-8")
        for idx, m in enumerate(FENCE.finditer(text)):
            mode, features = parse_meta(m.group(1))
            if mode is None:
                continue
            line = text.count("\n", 0, m.start()) + 1
            snippets.append(
                {
                    "name": f"{md.stem}_{idx}".replace("-", "_"),
                    "origin": f"{md}:{line}",
                    "features": features or default_features(md),
                    "source": render(mode, m.group(2)),
                }
            )
    return snippets


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs-dir", default="docs", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the scratch crates")
    args = ap.parse_args()

    snippets = collect(args.docs_dir)
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
