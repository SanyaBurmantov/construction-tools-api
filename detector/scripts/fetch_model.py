"""Download a pinned model into DIR/<name>/ and verify every file's sha256.

    python scripts/fetch_model.py modernbert /models [file ...]

Without file names it fetches every file in models.json except model.onnx
(fp32, 140 MB): the image ships the int8 export, which is what runs on the
2.9 GB production box. Standard library only — it runs in the image build.
"""

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def main() -> None:
    name, target, *wanted = sys.argv[1:]
    spec = json.loads((HERE / "models.json").read_text("utf-8"))[name]
    files = wanted or [f for f in spec["files"] if f != "model.onnx"]
    out = Path(target) / name
    out.mkdir(parents=True, exist_ok=True)
    for file in files:
        expected = spec["files"][file]
        path = out / file
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            continue
        url = f"https://huggingface.co/{spec['repo']}/resolve/{spec['revision']}/{file}"
        digest = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=120) as response, open(path, "wb") as fh:
            while chunk := response.read(1 << 20):
                digest.update(chunk)
                fh.write(chunk)
        if digest.hexdigest() != expected:
            path.unlink()
            sys.exit(f"{file}: sha256 {digest.hexdigest()} != {expected}")
        print(f"{file}: ok")


if __name__ == "__main__":
    main()
