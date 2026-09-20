from __future__ import annotations

import json
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_ROOT = SKILL_ROOT / "knowledge"
REGISTRY_PATH = KNOWLEDGE_ROOT / "registry.json"
FORBIDDEN_SUFFIXES = {".skp", ".skb", ".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".gif", ".zip"}


def main() -> None:
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    libraries = registry.get("libraries", [])
    ids = [item["library_id"] for item in libraries]
    errors: list[str] = []
    if len(ids) != len(set(ids)):
        errors.append("Duplicate library IDs")

    roots: set[Path] = set()
    for item in libraries:
        root = Path(item["external_root"]).resolve()
        profile_path = SKILL_ROOT / item["profile"]
        external_manifest = Path(item["external_manifest"])
        if root in roots:
            errors.append(f"Duplicate external root: {root}")
        roots.add(root)
        if not profile_path.is_file():
            errors.append(f"Missing profile: {profile_path}")
            continue
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        if item.get("availability") == "offline":
            if not item.get("availability_note"):
                errors.append(f"{item['library_id']}: offline library requires availability_note")
            continue
        if not root.is_dir():
            errors.append(f"Missing external root: {root}")
            continue
        if not external_manifest.is_file():
            errors.append(f"Missing external manifest: {external_manifest}")
            continue
        external = json.loads(external_manifest.read_text(encoding="utf-8"))
        expected_manifest = root / "library_manifest.json"
        if external_manifest.resolve() != expected_manifest.resolve():
            errors.append(f"{item['library_id']}: external manifest is not inside the registered root")
        if Path(profile.get("external_root", "")).resolve() != root:
            errors.append(f"{item['library_id']}: profile external_root does not match registry")
        if Path(profile.get("external_manifest", "")).resolve() != external_manifest.resolve():
            errors.append(f"{item['library_id']}: profile external_manifest does not match registry")
        for field in ("library_id", "source_sha256"):
            if profile.get(field) != item.get(field) or external.get(field) != item.get(field):
                errors.append(f"{item['library_id']}: inconsistent {field}")
        for route_name, relative_path in profile.get("search_routes", {}).items():
            if not (root / relative_path).exists():
                errors.append(f"{item['library_id']}: missing route {route_name}: {relative_path}")

    copied_assets = [
        path
        for path in KNOWLEDGE_ROOT.rglob("*")
        if path.is_file() and path.suffix.lower() in FORBIDDEN_SUFFIXES
    ]
    if copied_assets:
        errors.append("Large or binary assets were copied into the skill knowledge folder: " + ", ".join(map(str, copied_assets)))

    result = {"libraries": len(libraries), "errors": errors, "valid": not errors}
    print(json.dumps(result, ensure_ascii=False))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
