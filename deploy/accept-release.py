#!/usr/bin/python3
"""Única operação privilegiada permitida à conta do Actions."""
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tempfile


def unpack(archive, destination):
    with tarfile.open(archive) as tar:
        members = []
        total = 0
        for item in tar:
            path = PurePosixPath(item.name)
            allowed = (path.parts[:1] == ("dist",) or
                       path.parts[:2] in (("supabase", "functions"), ("supabase", "migrations"), ("supabase", "templates")) or
                       item.name == "supabase/config.toml" or
                       (item.isdir() and item.name == "supabase"))
            if path.is_absolute() or ".." in path.parts or not allowed or not (item.isfile() or item.isdir()):
                raise ValueError("Conteúdo não permitido no pacote")
            total += item.size
            if total > 300 * 1024 * 1024 or len(members) >= 10000:
                raise ValueError("Pacote excede o limite")
            item.mode = 0o755 if item.isdir() else 0o644
            members.append(item)
        required = {"dist/index.html", "supabase/config.toml", "supabase/functions/main/index.ts", "supabase/functions/functions.json"}
        if not required.issubset({m.name for m in members if m.isfile()}):
            raise ValueError("Pacote incompleto")
        tar.extractall(destination, members=members, filter="data")


if __name__ == "__main__":
    import fcntl
    if os.getuid() != 0 or len(sys.argv) != 2 or not re.fullmatch(r"[a-f0-9]{40}", sys.argv[1]):
        sys.exit("Uso restrito: accept-release.py SHA")
    root = Path("/opt/faceimob")
    if not (root / "READY").is_file():
        sys.exit("Migração inicial ainda não validada")
    sha = sys.argv[1]
    target = root / "releases" / sha
    with (root / "accept.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not target.exists():
            with tempfile.TemporaryDirectory(dir=root / "releases") as tmp:
                staging = Path(tmp) / "release"
                staging.mkdir(mode=0o755)
                unpack(root / "incoming" / f"{sha}.tar.gz", staging)
                staging.rename(target)
    os.execv("/usr/bin/bash", ["bash", "/usr/local/lib/faceimob/release.sh", sha])
