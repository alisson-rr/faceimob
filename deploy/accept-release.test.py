"""O pacote só pode escrever código da aplicação dentro da release."""
import io
from pathlib import Path
import runpy
import tarfile
import tempfile

unpack = runpy.run_path(str(Path(__file__).with_name("accept-release.py")))["unpack"]
required = ["dist/index.html", "supabase/config.toml", "supabase/functions/main/index.ts", "supabase/functions/functions.json"]
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for case, extra, link in [("valid", None, False), ("escape", "../outside", False), ("absolute", "/etc/cron.d/evil", False), ("compose", "deploy/compose.yml", False), ("link", "dist/link", True)]:
        archive = root / f"{case}.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name in required + ([extra] if extra else []):
                item = tarfile.TarInfo(name)
                if link and name == extra:
                    item.type = tarfile.SYMTYPE
                    item.linkname = "/etc"
                    tar.addfile(item)
                else:
                    item.size = 2
                    tar.addfile(item, io.BytesIO(b"ok"))
        try:
            unpack(archive, root / case)
        except ValueError:
            assert case != "valid"
        else:
            assert case == "valid", case
            assert (root / case / "dist/index.html").read_text() == "ok"
    assert not (root / "outside").exists()
print("Release boundary: valid package accepted; escapes, links and infrastructure rejected.")
