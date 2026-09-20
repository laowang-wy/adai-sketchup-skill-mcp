#!/usr/bin/env python3
"""ADAI SketchUp 底座 - 经验包 ZIP 安全解包器。

经验包是纯文本/图片，不应该带可执行内容和路径穿越。本脚本只使用标准库，
在解包前逐条校验，任何可疑条目直接拒绝，不做"尽量解一部分"。

用法: safe-unzip.py <archive.zip> <dest_dir>
输出: 单行 JSON {"ok": true|false, "files": n, "error": "..."}
"""
import json
import stat
import sys
import zipfile
from pathlib import Path

MAX_ENTRIES = 200
MAX_TOTAL = 8 * 1024 * 1024
MAX_SINGLE = 2 * 1024 * 1024
MAX_PROVIDER = 32 * 1024 * 1024
MAX_RATIO = 200


def fail(message):
    print(json.dumps({"ok": False, "files": 0, "error": message}, ensure_ascii=False))
    return 1


def safe_relative(name):
    raw = name.replace("\\", "/")
    if raw.startswith("/") or (len(raw) > 1 and raw[1] == ":"):
        raise ValueError("absolute path in archive: " + name)
    parts = [p for p in raw.split("/") if p not in ("", ".")]
    if any(":" in p or p.endswith((".", " ")) or p.split(".")[0].upper() in {"CON","PRN","AUX","NUL",*["COM"+str(i) for i in range(1,10)],*["LPT"+str(i) for i in range(1,10)]} for p in parts):
        raise ValueError("invalid Windows path: " + name)
    if any(p == ".." for p in parts):
        raise ValueError("path traversal in archive: " + name)
    if not parts:
        raise ValueError("empty entry name")
    return Path(*parts)


def main():
    if len(sys.argv) != 3:
        return fail("usage: safe-unzip.py <archive.zip> <dest_dir>")
    archive = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    if archive.suffix.lower() != ".zip" or not archive.is_file():
        return fail("not a readable .zip: " + str(archive))

    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    count = 0
    total = 0
    providers = 0
    seen = set()
    try:
        with zipfile.ZipFile(archive) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ENTRIES:
                return fail("too many entries: %d > %d" % (len(infos), MAX_ENTRIES))
            for info in infos:
                if info.is_dir():
                    continue
                mode = (info.external_attr >> 16) & 0xFFFF
                if mode and stat.S_ISLNK(mode):
                    return fail("symbolic link in archive: " + info.filename)
                if info.compress_size and info.file_size > info.compress_size * MAX_RATIO:
                    return fail("suspicious compression ratio: " + info.filename)
                rel = safe_relative(info.filename)
                key = str(rel).casefold()
                if key in seen:
                    return fail("duplicate archive entry: " + info.filename)
                seen.add(key)
                provider = rel.name == "provider.exe"
                providers += int(provider)
                if providers > 1:
                    return fail("multiple providers")
                if info.file_size > (MAX_PROVIDER if provider else MAX_SINGLE):
                    return fail("entry too large: " + info.filename)
                total += 0 if provider else info.file_size
                if total > MAX_TOTAL:
                    return fail("archive too large")
                rel = safe_relative(info.filename)
                target = (root / rel).resolve()
                if root not in target.parents:
                    return fail("entry escapes destination: " + info.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as fh, open(target, "wb") as out:
                    while True:
                        chunk = fh.read(65536)
                        if not chunk:
                            break
                        out.write(chunk)
                count += 1
    except zipfile.BadZipFile:
        return fail("not a valid zip file")
    except ValueError as exc:
        return fail(str(exc))

    print(json.dumps({"ok": True, "files": count, "error": ""}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
