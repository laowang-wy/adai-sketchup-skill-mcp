#!/usr/bin/env python3
"""Safely create or enable the dedicated SketchUp MCP host section."""
import argparse
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

DEFAULT_SERVER = "sketchup-mcp"

def default_config():
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        return Path(codex_home) / "config.toml"
    appdata = os.environ.get("APPDATA")
    return Path(appdata) / "pipclaw" / "codex-home" / "config.toml" if appdata else None

def strip_strings(text):
    """Blank string and comment bodies so bracket counting cannot be fooled."""
    if '"""' in text or "'''" in text:
        return text
    out = []
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == "\\" and quote == "\"":
                out.append(" ")
                i += 2
                continue
            if ch == "\n":
                out.append("\n")
                i += 1
                continue
            if ch == quote:
                quote = None
            out.append(" ")
            i += 1
            continue
        if ch in ("\"", "'"):
            quote = ch
            out.append(" ")
            i += 1
            continue
        if ch == "#":
            end = text.find("\n", i)
            end = len(text) if end == -1 else end
            out.append(" " * (end - i))
            i = end
            continue
        out.append(ch)
        i += 1
    return "".join(out)


BACKSLASH = chr(92)
TOML_ESCAPES = set('btnfr"' + BACKSLASH)
HEX_DIGITS = set("0123456789abcdefABCDEF")


def has_triple_quotes(text):
    return ('"""' in text) or (chr(39) * 3 in text)


def escapes_sound(text):
    """Reject invalid escape sequences and unterminated strings.

    A single unescaped backslash in a TOML basic string (for example
    "C:\\Models\\x") invalidates the whole file, which the host shows as
    "every MCP server disappeared".
    """
    i = 0
    quote = None
    while i < len(text):
        ch = text[i]
        if quote == chr(39):
            if ch == chr(39):
                quote = None
            elif ch == "\n":
                return False
            i += 1
            continue
        if quote == '"':
            if ch == "\n":
                return False
            if ch == BACKSLASH:
                nxt = text[i + 1] if i + 1 < len(text) else ""
                if nxt in TOML_ESCAPES:
                    i += 2
                    continue
                if nxt in ("u", "U"):
                    width = 4 if nxt == "u" else 8
                    digits = text[i + 2:i + 2 + width]
                    if len(digits) == width and all(d in HEX_DIGITS for d in digits):
                        i += 2 + width
                        continue
                return False
            if ch == '"':
                quote = None
            i += 1
            continue
        if ch == "#":
            end = text.find("\n", i)
            i = len(text) if end == -1 else end
            continue
        if ch in ('"', chr(39)):
            quote = ch
            i += 1
            continue
        i += 1
    return quote is None


def structurally_sound(text, section=None):
    """Fallback check when tomllib is unavailable (Python < 3.11).

    Verifies bracket balance outside strings and that every table header closes
    on its own line. section=None checks the file body only, so the original
    host config can be validated before a new section is appended.
    """
    if not has_triple_quotes(text) and not escapes_sound(text):
        return False
    bare = strip_strings(text)
    if bare.count("[") != bare.count("]"):
        return False
    for line in bare.splitlines():
        stripped = line.strip()
        if not stripped.startswith("["):
            continue
        if not stripped.endswith("]"):
            return False
        inner = stripped[1:-1]
        if inner.startswith("["):
            inner = inner[1:]
        if inner.endswith("]"):
            inner = inner[:-1]
        if "[" in inner or "]" in inner:
            return False
    if section is None:
        return True
    return section_span(text, section) is not None


def parse_entry(raw_args):
    """Return the single launch entry from a TOML args line, or the raw text."""
    if not raw_args:
        return None
    candidate = raw_args.strip()
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1].strip()
    for quote in ("\"", "'"):
        if candidate.startswith(quote) and candidate.endswith(quote) and len(candidate) > 1:
            candidate = candidate[1:-1]
            break
    if candidate.startswith("\"") and candidate.endswith("\""):
        try:
            candidate = json.loads(candidate)
        except ValueError:
            pass
    elif "\\\\" in candidate:
        candidate = candidate.replace("\\\\", "\\")
    return candidate


def section_span(text, section):
    header = re.compile(r"^\s*\[mcp_servers\.%s\]\s*$" % re.escape(section), re.M)
    match = header.search(text)
    if not match:
        return None
    nxt = re.compile(r"^\s*\[", re.M).search(text, match.end())
    return match.start(), nxt.start() if nxt else len(text)

def parse_toml(text):
    try:
        import tomllib
        tomllib.loads(text)
        return "ok"
    except ImportError:
        return "not_checked_no_tomllib"
    except Exception as exc:
        return "PARSE_FAILED: %s" % exc


def validate_host_text(text):
    """Return (ok, detail) using tomllib when present, structural check otherwise."""
    parse = parse_toml(text)
    if parse == "ok":
        return True, parse
    if parse.startswith("PARSE_FAILED"):
        return False, parse
    if not structurally_sound(text):
        version = ".".join(str(part) for part in sys.version_info[:3])
        return False, ("PARSE_FAILED: structural damage detected by the fallback validator "
                       "(tomllib unavailable on Python %s)" % version)
    return True, parse

def report(config, section):
    if config is None or not config.is_file():
        return {"ok": False, "error": "CONFIG_NOT_FOUND", "config": str(config) if config else None,
                "next": "Run the one-click installer or pass --config <host config>."}
    text = config.read_text(encoding="utf-8-sig")
    valid, detail = validate_host_text(text)
    if not valid:
        return {"ok": False, "config": str(config), "error": "CONFIG_IS_NOT_VALID_TOML", "detail": detail,
                "next": "Restore the host config from the timestamped backup next to it; do not enable against damaged TOML."}
    span = section_span(text, section)
    if span is None:
        return {"ok": False, "config": str(config), "error": "SERVER_SECTION_MISSING",
                "next": "The installer will create the dedicated section; do not read MCP source code.",
                "installed_does_not_mean_enabled": True}
    body = text[span[0]:span[1]]
    enabled = re.search(r"^\s*enabled\s*=\s*(true|false)[ \t]*(?:#[^\n]*)?$", body, re.M)
    args = re.search(r"^\s*args\s*=\s*(.+)$", body, re.M)
    raw_args = args.group(1).strip() if args else None
    return {"ok": True, "config": str(config), "section": section,
            "enabled": bool(enabled and enabled.group(1) == "true"),
            "entry": parse_entry(raw_args),
            "args_raw": raw_args,
            "toml_parse": parse_toml(text),
            "verdict": "enabled" if enabled and enabled.group(1) == "true" else "installed_but_not_enabled",
            "installed_does_not_mean_enabled": True,
            "next": "Restart the host and open a NEW session; confirm sketchup_* tools are listed."}

def set_line(body, key, value):
    pattern = re.compile(r"^\s*%s\s*=.*$" % re.escape(key), re.M)
    line = "%s = %s" % (key, value)
    match = pattern.search(body)
    if match:
        # Splice instead of re.sub: re.sub unescapes backslashes in the
        # replacement and would turn a valid \\ path into an invalid \ one.
        return body[:match.start()] + line + body[match.end():]
    header_end = body.find("\n")
    return body[:header_end + 1] + line + "\n" + body[header_end + 1:]

def env_block(section, bridge_dir):
    return ("[mcp_servers.%s.env]\n"
            "SKETCHUP_BRIDGE_MODE = \"file\"\n"
            "SKETCHUP_BRIDGE_DIR = %s\n"
            "SKETCHUP_BRIDGE_TIMEOUT_MS = \"30000\"\n\n"
            % (section, json.dumps(str(bridge_dir), ensure_ascii=False)))


def enable(config, section, entry, cwd, bridge_dir=None):
    if config is None:
        return {"ok": False, "error": "CONFIG_NOT_FOUND", "next": "Pass --config or use the one-click installer."}
    config = Path(config)
    if config.exists():
        text = config.read_text(encoding="utf-8-sig")
        valid, detail = validate_host_text(text)
        if not valid:
            return {"ok": False, "error": "CONFIG_IS_NOT_VALID_TOML", "detail": detail, "config": str(config),
                    "next": "Restore the host config from the timestamped backup next to it; refusing to append to damaged TOML."}
    else:
        config.parent.mkdir(parents=True, exist_ok=True)
        text = ""
        parse = "ok"
    target = Path(entry) if entry else None
    if target is None or not target.is_absolute() or not target.is_file():
        return {"ok": False, "error": "ENTRY_NOT_FOUND", "entry": entry,
                "next": "Pass the absolute launch.cjs of the installed package."}
    workdir = Path(cwd) if cwd else target.parent
    if not workdir.is_absolute() or not workdir.is_dir():
        return {"ok": False, "error": "CWD_NOT_FOUND", "cwd": str(workdir)}
    span = section_span(text, section)
    if span is None:
        suffix = "" if not text or text.endswith("\n") else "\n"
        block = ("%s\n[mcp_servers.%s]\nenabled = true\ncommand = \"node\"\nargs = [%s]\ncwd = %s\n\n"
                 % (suffix, section, json.dumps(str(target), ensure_ascii=False), json.dumps(str(workdir), ensure_ascii=False)))
        candidate = text + block
    else:
        start, end = span
        body = text[start:end]
        body = set_line(body, "enabled", "true")
        body = set_line(body, "command", json.dumps("node"))
        body = set_line(body, "args", "[" + json.dumps(str(target), ensure_ascii=False) + "]")
        body = set_line(body, "cwd", json.dumps(str(workdir), ensure_ascii=False))
        candidate = text[:start] + body + text[end:]
    if bridge_dir is not None and ("[mcp_servers.%s.env]" % section) not in candidate:
        candidate = candidate.rstrip("\n") + "\n\n" + env_block(section, bridge_dir).rstrip("\n") + "\n"
    parsed = parse_toml(candidate)
    if parsed.startswith("PARSE_FAILED"):
        return {"ok": False, "error": "REFUSED_INVALID_RESULT", "detail": parsed}
    if parsed.startswith("not_checked"):
        if not structurally_sound(candidate, section):
            return {"ok": False, "error": "REFUSED_STRUCTURAL_DAMAGE"}
    config.parent.mkdir(parents=True, exist_ok=True)
    backup = None
    if config.exists():
        backup = config.with_suffix(config.suffix + ".backup-" + time.strftime("%Y%m%d-%H%M%S"))
        shutil.copy2(config, backup)
    tmp = config.with_suffix(config.suffix + ".tmp")
    tmp.write_text(candidate, encoding="utf-8", newline="\n")
    os.replace(tmp, config)
    result = report(config, section)
    result.update({"ok": True, "backup": str(backup) if backup else None,
                   "after": report(config, section),
                   "next": "Restart PipClaw/Codex and open a NEW session; verify sketchup_project_step is visible."})
    return result

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config")
    ap.add_argument("--section", default=DEFAULT_SERVER)
    ap.add_argument("--entry")
    ap.add_argument("--cwd")
    ap.add_argument("--bridge-dir")
    ap.add_argument("--enable", action="store_true")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()
    config = Path(args.config) if args.config else default_config()
    result = (enable(config, args.section, args.entry, args.cwd, Path(args.bridge_dir) if args.bridge_dir else None)
              if args.enable else report(config, args.section))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1

if __name__ == "__main__":
    sys.exit(main())
