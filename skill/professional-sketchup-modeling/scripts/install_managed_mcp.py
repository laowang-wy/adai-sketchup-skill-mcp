#!/usr/bin/env python3
"""Register the bundled managed SketchUp MCP in the current host, safely.

The package already knows its own layout, so this entry never scans disks. It
resolves the launch entry from, in order: an explicit --entry, the sibling MCP
folder, the standard install root, or the binding the MCP itself wrote.
It writes the dedicated [mcp_servers.sketchup-mcp] section only, backs up the
previous config, and reports the three separate states instead of guessing.

  python install_managed_mcp.py --check
  python install_managed_mcp.py --install
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
SERVER = "sketchup-mcp"


def package_entry_parents():
    """Directories that legitimately hold this package's launch entry."""
    return {str(PACKAGE.parent / "sketchup-managed-mcp"), str(PACKAGE.parent.parent)}


VERSION = "0.5.26"
OWN_SOURCES = ("explicit", "sibling_package", "one_click_layout", "runtime_support_layout", "standard_install_root")


def resolve_entry(explicit):
    """Return (entry, tried, source) from known package layouts only; never scans disks.

    Own-layout candidates come first so an older machine-wide install cannot
    hijack resolution of the package that is actually running.
    """
    candidates = []
    if explicit:
        given = Path(explicit)
        if not given.is_absolute() or not given.is_file():
            return None, ["EXPLICIT_ENTRY_NOT_FOUND: %s" % explicit], None
        candidates.append((given, "explicit"))
    candidates.append((PACKAGE.parent / "sketchup-managed-mcp" / "launch.cjs", "sibling_package"))
    candidates.append((PACKAGE.parent.parent / "mcp" / "sketchup-managed-mcp" / "launch.cjs", "one_click_layout"))
    candidates.append((PACKAGE.parent.parent / "launch.cjs", "runtime_support_layout"))
    home = os.environ.get("USERPROFILE")
    if home:
        candidates.append((Path(home) / ".pipclaw" / "mcp" / ("sketchup-managed-mcp-" + VERSION) / "launch.cjs",
                           "standard_install_root"))
    appdata = os.environ.get("APPDATA")
    if appdata:
        binding = Path(appdata) / "SketchUpLiveMCP" / "mcp-client.json"
        if binding.is_file():
            try:
                bound = json.loads(binding.read_text(encoding="utf-8")).get("entry", "")
            except (OSError, ValueError):
                bound = ""
            if bound:
                candidates.append((Path(bound), "mcp_client_binding"))
    for candidate, source in candidates:
        if candidate and candidate.is_absolute() and candidate.is_file():
            return candidate, [str(x) for x, _ in candidates], source
    return None, [str(x) for x, _ in candidates], None


def entry_package_version(entry):
    """Version declared by the manifest next to the resolved launch entry."""
    try:
        manifest = json.loads((entry.parent / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    version = manifest.get("version")
    return version if isinstance(version, str) else None


def resolve_config(explicit):
    if explicit:
        return Path(explicit)
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        return Path(codex_home) / "config.toml"
    appdata = os.environ.get("APPDATA")
    return Path(appdata) / "pipclaw" / "codex-home" / "config.toml" if appdata else None


def default_bridge_dir():
    appdata = os.environ.get("APPDATA")
    return Path(appdata) / "SketchUpLiveMCP" / "bridge" if appdata else None


def run(entry, config, bridge_dir, install):
    command = [sys.executable, str(HERE / "enable_host_mcp.py"), "--section", SERVER, "--config", str(config)]
    if install:
        command += ["--enable", "--entry", str(entry), "--cwd", str(entry.parent)]
        if bridge_dir is not None:
            command += ["--bridge-dir", str(bridge_dir)]
    else:
        command += ["--status"]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    try:
        return json.loads(result.stdout or "{}")
    except ValueError:
        return {"ok": False, "error": "HOST_ENABLE_OUTPUT_UNREADABLE", "stdout": (result.stdout or "")[:500],
                "stderr": (result.stderr or "")[:500]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--entry")
    ap.add_argument("--config")
    ap.add_argument("--bridge-dir")
    ap.add_argument("--install", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    entry, tried, source = resolve_entry(args.entry)
    config = resolve_config(args.config)
    if entry is None:
        print(json.dumps({"ok": False, "state": "MCP_NOT_INSTALLED", "tried": tried,
                          "next": "Import the matching recovery MCP package and pass its absolute launch.cjs path with --entry."},
                         ensure_ascii=False, indent=2))
        return 2
    if entry_package_version(entry) != VERSION:
        print(json.dumps({"ok": False, "state": "PACKAGE_VERSION_MISMATCH", "expected": VERSION,
                          "actual": entry_package_version(entry), "entry": str(entry),
                          "host_section_written": False}))
        return 2
    if config is None:
        print(json.dumps({"ok": False, "state": "CONFIG_NOT_FOUND", "host_section_written": False}))
        return 2
    bridge = Path(args.bridge_dir) if args.bridge_dir else default_bridge_dir()
    outcome = run(entry, config, bridge, args.install)
    same_package_section = outcome.get("after", outcome) if isinstance(outcome, dict) else {}
    payload = {
        "ok": bool(outcome.get("ok")),
        "package_installed": True,
        "entry": str(entry),
        "entry_source": source,
        "entry_package_version": entry_package_version(entry),
        "entry_belongs_to_this_package": source in OWN_SOURCES,
        "entry_parent_is_package": str(entry.parent) in package_entry_parents(),
        "host_section_written": bool(args.install and outcome.get("ok")),
        "host_config": str(config) if config else None,
        "enabled": same_package_section.get("enabled"),
        "verdict": same_package_section.get("verdict"),
        "backup": outcome.get("backup"),
        "session_tools_visible": "unknown_requires_new_session",
        "next": "Restart PipClaw/Codex; open a NEW session; confirm sketchup_project_step appears in the tool list. Read only the relevant source when diagnosing a concrete runtime failure.",
    }
    if source not in OWN_SOURCES or payload["entry_package_version"] != VERSION:
        payload["warning"] = ("resolved entry from %s with package version %s; this script ships %s. "
                              "Pass --entry <launch.cjs> if that install is not the intended %s package."
                              % (source or "no candidate", payload["entry_package_version"] or "unknown",
                                 VERSION, VERSION))
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
