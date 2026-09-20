#!/usr/bin/env python3
"""Verify filesystem and audit evidence for a SketchUp delivery.

This script verifies what files and audit data can prove. It deliberately
reports topology, projection, and form as unverified or evidence-provided;
file presence never becomes professional acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


def canonical_path(path: Path) -> str:
    return os.path.normcase(os.path.abspath(os.fspath(path)))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def status(state: str, evidence: list[str], details: list[str]) -> dict[str, Any]:
    return {"state": state, "evidence": evidence, "details": details}


def nonempty_file(path: Path | None, label: str, failures: list[str]) -> tuple[bool, list[str]]:
    if path is None:
        failures.append(f"{label} was not supplied")
        return False, []
    if not path.is_file():
        failures.append(f"{label} does not exist: {path}")
        return False, []
    size = path.stat().st_size
    if size <= 0:
        failures.append(f"{label} is empty: {path}")
        return False, []
    return True, [f"{label}: {path} ({size} bytes)"]


def audit_model_path(audit: dict[str, Any]) -> str:
    direct = audit.get("model_path")
    if isinstance(direct, str) and direct.strip():
        return direct
    source = audit.get("source")
    if isinstance(source, dict):
        nested = source.get("path")
        if isinstance(nested, str):
            return nested
    return ""


def has_nonempty_counts(audit: dict[str, Any]) -> bool:
    counts = audit.get("counts")
    if not isinstance(counts, dict):
        return False
    for value in counts.values():
        if isinstance(value, (int, float)) and value > 0:
            return True
    return False


def evidence_state(path: Path | None, label: str) -> dict[str, Any]:
    if path is None:
        return status("unverified", [], [f"No {label} evidence file supplied; automated filesystem checks cannot prove this layer."])
    if not path.is_file() or path.stat().st_size <= 0:
        return status("fail", [], [f"{label} evidence file is missing or empty: {path}"])
    return status("provided", [f"{label} evidence: {path} ({path.stat().st_size} bytes)"], ["Presence proves evidence was supplied, not its professional interpretation."])


def verify(model: Path, audit_path: Path, preview: Path | None, expected: Path, topology: Path | None, projection: Path | None, form: Path | None) -> dict[str, Any]:
    failures: list[str] = []
    execution_evidence: list[str] = []
    model_ok, model_rows = nonempty_file(model, "model", failures)
    execution_evidence.extend(model_rows)
    if model_ok:
        execution_evidence.append(f"sha256: {sha256(model)}")
    audit_ok, audit_rows = nonempty_file(audit_path, "audit", failures)
    readback_evidence = list(audit_rows)
    audit: dict[str, Any] | None = None
    if audit_ok:
        try:
            loaded = json.loads(audit_path.read_text(encoding="utf-8-sig"))
            if not isinstance(loaded, dict):
                raise ValueError("audit root is not an object")
            audit = loaded
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            failures.append(f"audit cannot be parsed: {exc}")
            audit_ok = False
    if audit_ok and audit is not None:
        if audit.get("ok") is False:
            failures.append("audit explicitly reports ok=false")
        if not has_nonempty_counts(audit):
            failures.append("audit has no nonempty entity counts")
        actual = audit_model_path(audit)
        if not actual:
            failures.append("audit has no active model path")
        elif canonical_path(Path(actual)) != canonical_path(expected):
            failures.append(f"audit model path mismatch: expected {expected}, got {actual}")
        else:
            readback_evidence.append(f"audit model path matches expected path: {expected}")
    preview_ok, preview_rows = nonempty_file(preview, "preview", failures)
    readback_evidence.extend(preview_rows)

    execution = status("pass" if model_ok else "fail", execution_evidence, [] if model_ok else failures.copy())
    readback_pass = audit_ok and preview_ok and not any("audit " in failure or "preview" in failure for failure in failures)
    readback = status("pass" if readback_pass else "fail", readback_evidence, [] if readback_pass else failures.copy())
    topology_status = evidence_state(topology, "topology")
    projection_status = evidence_state(projection, "projection")
    form_status = evidence_state(form, "form")
    hard_failure = execution["state"] == "fail" or readback["state"] == "fail" or topology_status["state"] == "fail" or projection_status["state"] == "fail" or form_status["state"] == "fail"
    return {
        "ok": not hard_failure,
        "ok_scope": "artifact_checks_only",
        "acceptance": "unverified",
        "reopen": status("unverified", [], ["Path agreement and file presence do not prove a reopen operation occurred."]),
        "model": str(model),
        "expected_path": str(expected),
        "layers": {"execution": execution, "topology": topology_status, "projection": projection_status, "form": form_status, "readback": readback},
        "failures": failures,
        "warnings": ["Evidence presence is provided, not pass. This checker does not interpret professional review or prove reopening."],
    }


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")


def self_test() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        model = root / "delivery.skp"
        audit = root / "audit.json"
        preview = root / "preview.png"
        model.write_bytes(b"sketchup-test")
        preview.write_bytes(b"png-test")
        write_json(audit, {"source": {"path": str(model)}, "counts": {"groups": 1, "faces": 6}})
        passed = verify(model, audit, preview, model, None, None, None)
        if not passed["ok"] or passed["layers"]["readback"]["state"] != "pass":
            print("[FAIL] valid delivery did not pass execution/readback")
            return 1
        supplied = verify(model, audit, preview, model, preview, preview, preview)
        assert supplied['acceptance'] == 'unverified'
        assert supplied['reopen']['state'] == 'unverified'
        assert all(supplied['layers'][k]['state'] == 'provided' for k in ('topology','projection','form'))
        assert evidence_state(root / 'absent.json', 'form')['state'] == 'fail'
        assert evidence_state(None, 'form')['state'] == 'unverified'
        write_json(audit, {"source": {"path": str(root / "wrong.skp")}, "counts": {"groups": 1}})
        failed = verify(model, audit, preview, model, None, None, None)
        if failed["ok"] or failed["layers"]["readback"]["state"] != "fail":
            print("[FAIL] mismatched audit path was accepted")
            return 1
    print("[OK] verify_model_delivery self-test passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify SketchUp file, audit, preview, and declared evidence")
    parser.add_argument("--model", type=Path, help="Saved .skp file")
    parser.add_argument("--audit", type=Path, help="JSON from audit_active_model.rb")
    parser.add_argument("--preview", type=Path, help="Nonempty visual preview file")
    parser.add_argument("--expected-path", type=Path, help="Expected reopened model path; defaults to --model")
    parser.add_argument("--topology-evidence", type=Path)
    parser.add_argument("--projection-evidence", type=Path)
    parser.add_argument("--form-evidence", type=Path)
    parser.add_argument("--report", type=Path, help="Output JSON report")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test:
        return self_test()
    if not arguments.model or not arguments.audit or not arguments.report:
        parser.error("--model, --audit, and --report are required unless --self-test is used")
    expected = arguments.expected_path or arguments.model
    result = verify(arguments.model, arguments.audit, arguments.preview, expected, arguments.topology_evidence, arguments.projection_evidence, arguments.form_evidence)
    write_json(arguments.report, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
