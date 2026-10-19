#!/usr/bin/env python3
"""Package tracked application code and built dist, without live data or secrets."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

EXCLUDED_PARTS = {".git", "node_modules", ".venv", ".manus-logs", "__pycache__"}
DATA_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pkl", ".joblib", ".pem", ".key"}


def eligible(relative: Path) -> bool:
    return not any(part in EXCLUDED_PARTS for part in relative.parts) and not relative.name.startswith(".env") and relative.suffix not in DATA_SUFFIXES


def package(root: Path, sha: str, output: Path) -> None:
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("Invalid source commit")
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if actual != sha:
        raise ValueError("Checkout SHA differs from requested source commit")
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    paths = {Path(name) for name in tracked if name and eligible(Path(name))}
    paths.update(p.relative_to(root) for p in (root / "dist").rglob("*") if p.is_file())
    for required in ["dist/index.js", "dist/public/index.html", "package.json", "pnpm-lock.yaml", "requirements.txt"]:
        if Path(required) not in paths or not (root / required).is_file():
            raise ValueError(f"Required build file missing: {required}")
    output.parent.mkdir(parents=True, exist_ok=True)
    built_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    metadata = json.dumps({"sha": sha, "builtAt": built_at}, separators=(",", ":")).encode()
    with tarfile.open(output, "w:gz") as archive:
        for relative in sorted(paths):
            if not eligible(relative) or relative.is_absolute() or ".." in relative.parts:
                continue
            path = root / relative
            if path.is_symlink() or not path.is_file():
                raise ValueError("Deployment packages must contain regular files only")
            archive.add(path, arcname=relative.as_posix(), recursive=False)
        info = tarfile.TarInfo(".aurelia-release.json")
        info.size = len(metadata)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(metadata))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package(Path.cwd(), args.sha, args.output.resolve())
