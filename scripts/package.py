"""Package the offline runtime and notices as Eagle's ZIP-based plugin format."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text())
files = ["manifest.json", "logo.png", "README.md", "CHANGELOG.md", "THIRD-PARTY-NOTICES.md"]
for folder in ["lib", "inspector", "vendor", "third-party", "docs"]:
    files += [str(p.relative_to(root)) for p in sorted((root / folder).rglob("*")) if p.is_file() and p.name != ".DS_Store"]
assert "vendor/taglib.wasm" in files and "vendor/metadata.cjs" in files
out = root / "release" / (manifest["name"] + ".eagleplugin")
out.parent.mkdir(exist_ok=True)
with ZipFile(out, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        # Fixed timestamps make the plugin reproducible from identical runtime files.
        from zipfile import ZipInfo
        info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
with ZipFile(out) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read("manifest.json"))["version"] == manifest["version"]
    assert set(archive.namelist()) == set(files)
assets = [out, out.parent / "taglib-corresponding-source-1.5.3.tar.gz"]
checksum = out.parent / "SHA256SUMS.txt"
checksum.write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest() + "  " + p.name + "\n" for p in assets if p.exists()))
print(f"{out} ({out.stat().st_size:,} bytes, {len(files)} files)")
print(checksum)
