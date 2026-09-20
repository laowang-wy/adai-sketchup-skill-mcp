from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_ROOT = SKILL_ROOT / "knowledge"
MODELS_ROOT = KNOWLEDGE_ROOT / "models"
REGISTRY_PATH = KNOWLEDGE_ROOT / "registry.json"
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
HASH_PATTERN = re.compile(r"\b[A-Fa-f0-9]{64}\b")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path | None, default: Any = None) -> Any:
    if not path or not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def find_one(root: Path, filename: str) -> Path | None:
    matches = sorted(root.rglob(filename))
    return matches[0] if matches else None


def relative(root: Path, path: Path | None) -> str | None:
    return path.relative_to(root).as_posix() if path else None


def read_csv(path: Path | None) -> list[dict[str, str]]:
    if not path or not path.is_file():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def discover_source_hash(root: Path, explicit: str | None) -> str:
    if explicit:
        value = explicit.upper()
        if not HASH_PATTERN.fullmatch(value):
            raise ValueError("--source-sha256 must contain exactly 64 hexadecimal characters")
        return value
    for path in sorted(root.rglob("*SHA256*.txt")) + sorted(root.rglob("*sha256*.txt")):
        match = HASH_PATTERN.search(path.read_text(encoding="utf-8", errors="ignore"))
        if match:
            return match.group(0).upper()
    raise ValueError("Source SHA-256 was not found. Pass --source-sha256 explicitly.")


def file_stats(root: Path) -> dict[str, int]:
    files = [path for path in root.rglob("*") if path.is_file()]
    return {"files": len(files), "bytes": sum(path.stat().st_size for path in files)}


def validation_status(root: Path) -> dict[str, Any]:
    rename_validation_path = find_one(root, "component_semantic_rename_validation.json")
    readback_path = find_one(root, "readback_validation.json")
    semantic_readback_path = find_one(root, "semantic_components_readback_validation.json")
    rename_validation = read_json(rename_validation_path, {})
    readback = read_json(readback_path, {})
    semantic_readback = read_json(semantic_readback_path, {})
    return {
        "component_semantic_validation": rename_validation.get("all_checks_pass"),
        "model_readback_validation": readback.get("production_readback", {}).get("all_checks_pass"),
        "semantic_component_readback": semantic_readback.get("all_component_samples_opened"),
        "validation_files": [
            value
            for value in (
                relative(root, rename_validation_path),
                relative(root, readback_path),
                relative(root, semantic_readback_path),
            )
            if value
        ],
    }


def build_manifest(args: argparse.Namespace, root: Path, source_hash: str) -> dict[str, Any]:
    audit_path = find_one(root, "audit_summary.json")
    components_path = find_one(root, "components.csv")
    semantic_map_path = find_one(root, "组件语义命名映射.csv")
    materials_path = find_one(root, "materials.json")
    material_usage_path = find_one(root, "material_usage.json")
    visual_inventory_path = find_one(root, "unclassified_visual_inventory.json")
    audit = read_json(audit_path, {})
    components = read_csv(components_path)
    semantic_assets = read_csv(semantic_map_path)
    materials = read_json(materials_path, []) or []

    exported_components = [row for row in components if row.get("exported_component")]
    category_counts = Counter()
    for row in semantic_assets:
        category_counts[row.get("folder", "unclassified")] += 1
    if not category_counts:
        for row in exported_components:
            path = row.get("exported_component", "")
            parts = Path(path).parts
            category_counts[parts[1] if len(parts) > 1 else "unclassified"] += 1

    confidence_counts = Counter(row.get("confidence", "unknown") for row in semantic_assets)
    textured_materials = sum(1 for item in materials if item.get("texture"))
    search_routes = {
        "learned_rules": relative(root, find_one(root, "从参考模型提炼的结构知识.md")),
        "model_audit": relative(root, find_one(root, "模型审计报告.md")),
        "component_semantic_report": relative(root, find_one(root, "组件语义整理报告.md")),
        "semantic_assets_csv": relative(root, semantic_map_path),
        "components_csv": relative(root, components_path),
        "component_definitions_json": relative(root, find_one(root, "component_definitions.json")),
        "materials_json": relative(root, materials_path),
        "material_usage_json": relative(root, material_usage_path),
        "component_visual_inventory_json": relative(root, visual_inventory_path),
        "component_library": relative(root, next(iter(sorted(root.rglob("03_SKP组件库"))), None)),
        "texture_library": relative(root, next(iter(sorted(root.rglob("04_材质贴图库"))), None)),
        "preview_library": relative(root, next(iter(sorted(root.rglob("05_组件与材质预览"))), None)),
        "verified_models": relative(root, next(iter(sorted(root.rglob("07_验证后的模型副本"))), None)),
    }
    search_routes = {key: value for key, value in search_routes.items() if value}
    counts = audit.get("counts", {})
    return {
        "schema_version": 1,
        "library_id": args.id,
        "display_name": args.display_name,
        "source_sha256": source_hash,
        "tags": sorted(set(args.tag)),
        "strengths": args.strength,
        "cautions": args.caution,
        "model_profile": {
            "bounds_mm": audit.get("source", {}).get("model_bounds", {}).get("size_mm"),
            "definitions": counts.get("definitions"),
            "placed_instances": counts.get("placed_instance_records"),
            "maximum_instance_depth": counts.get("maximum_instance_depth"),
            "materials": counts.get("materials", len(materials)),
            "textured_materials": counts.get("textured_materials", textured_materials),
            "transparent_materials": counts.get("transparent_materials"),
            "tags": counts.get("tags"),
            "scenes": counts.get("scenes"),
        },
        "assets": {
            "exported_components": len(exported_components),
            "semantic_assets": len(semantic_assets),
            "semantic_confidence": dict(sorted(confidence_counts.items())),
            "category_counts": dict(sorted(category_counts.items())),
            "textures": textured_materials,
        },
        "validation": validation_status(root),
        "search_routes": search_routes,
        "external_stats": file_stats(root),
    }


def load_registry() -> dict[str, Any]:
    return read_json(REGISTRY_PATH, {"schema_version": 1, "libraries": []})


def main() -> None:
    parser = argparse.ArgumentParser(description="Register an external SketchUp reference-model knowledge library.")
    parser.add_argument("--root", required=True, help="External knowledge-library root")
    parser.add_argument("--id", required=True, help="Unique lowercase library ID")
    parser.add_argument("--display-name", help="Required for a new library; inherited for updates and relocation")
    parser.add_argument("--source-sha256")
    parser.add_argument(
        "--relocate",
        action="store_true",
        help="Update an existing library ID to a new root after verifying the source SHA-256",
    )
    parser.add_argument("--tag", action="append", default=[])
    parser.add_argument("--strength", action="append", default=[])
    parser.add_argument("--caution", action="append", default=[])
    args = parser.parse_args()

    if not ID_PATTERN.fullmatch(args.id):
        raise ValueError("--id must match ^[a-z0-9][a-z0-9-]{2,63}$")
    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(root)
    if not find_one(root, "audit_summary.json"):
        raise FileNotFoundError("The external library does not contain audit_summary.json")
    source_hash = discover_source_hash(root, args.source_sha256)
    registry = load_registry()
    libraries = registry.setdefault("libraries", [])
    existing = next((item for item in libraries if item["library_id"] == args.id), None)
    root_collision = next((item for item in libraries if Path(item["external_root"]).resolve() == root and item["library_id"] != args.id), None)
    if root_collision:
        raise ValueError(f"External root is already registered as {root_collision['library_id']}")
    if args.relocate and not existing:
        raise ValueError("--relocate requires an existing library ID")
    previous_root = Path(existing["external_root"]).resolve() if existing else None
    root_changed = bool(existing and previous_root != root)
    if root_changed and not args.relocate:
        raise ValueError("The existing library ID points to a different external root. Use --relocate after moving the same library.")
    if existing and existing["source_sha256"] != source_hash:
        raise ValueError("The source SHA-256 changed. Register this source revision with a new library ID.")

    moved_manifest_path = root / "library_manifest.json"
    if args.relocate and moved_manifest_path.is_file():
        moved_manifest = read_json(moved_manifest_path, {})
        manifest_id = moved_manifest.get("library_id")
        manifest_hash = moved_manifest.get("source_sha256")
        if manifest_id and manifest_id != args.id:
            raise ValueError(f"The target root manifest belongs to a different library ID: {manifest_id}")
        if manifest_hash and manifest_hash != source_hash:
            raise ValueError("The target root manifest source SHA-256 does not match the registered library")

    if existing:
        existing_profile = read_json(SKILL_ROOT / existing["profile"], {})
        if not args.display_name:
            args.display_name = existing["display_name"]
        if not args.tag:
            args.tag = existing.get("tags", [])
        if not args.strength:
            args.strength = existing.get("strengths", [])
        if not args.caution:
            args.caution = existing.get("cautions", existing_profile.get("cautions", []))
    elif not args.display_name:
        raise ValueError("--display-name is required when registering a new library")

    manifest = build_manifest(args, root, source_hash)
    external_manifest = root / "library_manifest.json"
    write_json_atomic(external_manifest, manifest)
    profile_path = MODELS_ROOT / args.id / "profile.json"
    profile = {**manifest, "external_root": str(root), "external_manifest": str(external_manifest)}
    write_json_atomic(profile_path, profile)

    timestamp = now_iso()
    entry = {
        "library_id": args.id,
        "display_name": args.display_name,
        "external_root": str(root),
        "source_sha256": source_hash,
        "tags": manifest["tags"],
        "strengths": manifest["strengths"],
        "cautions": manifest["cautions"],
        "profile": profile_path.relative_to(SKILL_ROOT).as_posix(),
        "external_manifest": str(external_manifest),
        "registered_at": existing.get("registered_at") if existing else timestamp,
        "updated_at": timestamp,
    }
    if existing:
        libraries[libraries.index(existing)] = entry
    else:
        libraries.append(entry)
    libraries.sort(key=lambda item: item["library_id"])
    write_json_atomic(REGISTRY_PATH, registry)
    print(
        json.dumps(
            {
                "registered": args.id,
                "relocated": root_changed,
                "previous_root": str(previous_root) if root_changed else None,
                "profile": str(profile_path),
                "external_root": str(root),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
