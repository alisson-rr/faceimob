"""Monta fontes não ignoradas + dist; nunca inclui .env ou backups."""
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib
from pathlib import Path

output = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    paths = ["supabase/functions", "supabase/migrations", "supabase/config.toml", "supabase/templates"]
    tracked = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", *paths]).decode().split("\0")
    for name in filter(None, tracked):
        dest = root / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(name, dest)
    shutil.copytree("dist", root / "dist")
    functions = root / "supabase/functions"
    config = tomllib.loads((root / "supabase/config.toml").read_text(encoding="utf-8"))
    manifest = {p.name: config.get("functions", {}).get(p.name, {}).get("verify_jwt", True)
                for p in functions.iterdir() if p.is_dir() and (p / "index.ts").exists() and not p.name.startswith("_")}
    (functions / "main").mkdir()
    shutil.copyfile("deploy/functions-main.ts", functions / "main/index.ts")
    (functions / "functions.json").write_text(json.dumps(manifest), encoding="utf-8")
    with tarfile.open(output, "w:gz") as archive:
        for item in root.iterdir():
            archive.add(item, arcname=item.name)
print(f"Release criada: {output.name}; {len(manifest)} funções")
