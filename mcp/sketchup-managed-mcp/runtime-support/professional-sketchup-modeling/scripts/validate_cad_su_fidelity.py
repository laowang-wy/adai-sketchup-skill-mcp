#!/usr/bin/env python3
"""Validate a CAD-to-SketchUp source trace manifest."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


DEFAULT_TOLERANCES = {
    "position_mm": 5.0,
    "size_mm": 10.0,
    "rotation_deg": 0.5,
}


def angular_error(first: float, second: float) -> float:
    difference = abs(first - second) % 360.0
    return min(difference, 360.0 - difference)


def bbox_metrics(source: list[float], target: list[float]) -> tuple[float, float]:
    source_center = ((source[0] + source[2]) / 2.0, (source[1] + source[3]) / 2.0)
    target_center = ((target[0] + target[2]) / 2.0, (target[1] + target[3]) / 2.0)
    position_error = math.dist(source_center, target_center)
    source_size = (source[2] - source[0], source[3] - source[1])
    target_size = (target[2] - target[0], target[3] - target[1])
    size_error = max(abs(source_size[0] - target_size[0]), abs(source_size[1] - target_size[1]))
    return position_error, size_error


def validate_manifest(data: dict[str, Any]) -> dict[str, Any]:
    tolerances = {**DEFAULT_TOLERANCES, **data.get("tolerances", {})}
    errors: list[str] = []
    warnings: list[str] = []
    metrics = {
        "max_position_error_mm": 0.0,
        "max_size_error_mm": 0.0,
        "max_rotation_error_deg": 0.0,
    }

    layers = data.get("source_layers")
    objects = data.get("source_objects")
    additions = data.get("target_additions")
    if not isinstance(layers, list):
        errors.append("source_layers must be a list")
        layers = []
    if not isinstance(objects, list):
        errors.append("source_objects must be a list")
        objects = []
    if not isinstance(additions, list):
        errors.append("target_additions must be a list")
        additions = []

    seen_layers: set[str] = set()
    for index, layer in enumerate(layers):
        label = f"source_layers[{index}]"
        name = str(layer.get("name", "")).strip()
        if not name:
            errors.append(f"{label} has no name")
            continue
        if name in seen_layers:
            errors.append(f"duplicate source layer: {name}")
        seen_layers.add(name)
        count = layer.get("entity_count")
        if not isinstance(count, int) or count < 0:
            errors.append(f"{label} has invalid entity_count")
        disposition = layer.get("disposition")
        if disposition == "mapped":
            targets = layer.get("target_groups")
            if count and (not isinstance(targets, list) or not targets):
                errors.append(f"mapped nonempty layer {name} has no target_groups")
        elif disposition == "excluded":
            if not str(layer.get("reason", "")).strip():
                errors.append(f"excluded layer {name} has no reason")
            if layer.get("user_approved") is not True:
                errors.append(f"excluded layer {name} lacks explicit user approval")
        else:
            errors.append(f"layer {name} has invalid disposition: {disposition!r}")

    mapped_handles: set[str] = set()
    for index, item in enumerate(objects):
        label = f"source_objects[{index}]"
        handle = str(item.get("source_handle", "")).strip()
        layer = str(item.get("source_layer", "")).strip()
        kind = str(item.get("kind", "")).strip()
        if not handle or not layer or not kind:
            errors.append(f"{label} requires source_handle, source_layer, and kind")
            continue
        if handle in mapped_handles:
            errors.append(f"duplicate source handle: {handle}")
        mapped_handles.add(handle)
        if layer not in seen_layers:
            errors.append(f"object {handle} references unlisted source layer {layer}")

        status = item.get("status")
        if status == "excluded":
            if not str(item.get("reason", "")).strip() or item.get("user_approved") is not True:
                errors.append(f"excluded object {handle} requires reason and user_approved=true")
            continue
        if status != "mapped":
            errors.append(f"object {handle} has invalid status: {status!r}")
            continue
        if not str(item.get("target_group", "")).strip():
            errors.append(f"mapped object {handle} has no target_group")

        source_bbox = item.get("source_bbox_mm")
        target_bbox = item.get("target_bbox_mm")
        if not (
            isinstance(source_bbox, list)
            and isinstance(target_bbox, list)
            and len(source_bbox) == 4
            and len(target_bbox) == 4
        ):
            errors.append(f"mapped object {handle} requires 4-value source and target bboxes")
        else:
            position_error, size_error = bbox_metrics(source_bbox, target_bbox)
            metrics["max_position_error_mm"] = max(metrics["max_position_error_mm"], position_error)
            metrics["max_size_error_mm"] = max(metrics["max_size_error_mm"], size_error)
            if position_error > float(tolerances["position_mm"]):
                errors.append(f"object {handle} position error {position_error:.3f}mm exceeds tolerance")
            if size_error > float(tolerances["size_mm"]):
                errors.append(f"object {handle} size error {size_error:.3f}mm exceeds tolerance")

        source_rotation = item.get("source_rotation_deg")
        target_rotation = item.get("target_rotation_deg")
        if source_rotation is None or target_rotation is None:
            errors.append(f"mapped object {handle} requires source and target rotation")
        else:
            rotation_error = angular_error(float(source_rotation), float(target_rotation))
            metrics["max_rotation_error_deg"] = max(metrics["max_rotation_error_deg"], rotation_error)
            if rotation_error > float(tolerances["rotation_deg"]):
                errors.append(f"object {handle} rotation error {rotation_error:.3f}deg exceeds tolerance")

        source_anchor = item.get("source_anchor")
        target_anchor = item.get("target_anchor")
        if kind in {"bed", "door", "window", "cabinet", "fixture"}:
            if not source_anchor or not target_anchor:
                errors.append(f"{kind} object {handle} requires source_anchor and target_anchor")
            elif source_anchor != target_anchor:
                errors.append(f"object {handle} semantic anchor mismatch")
        elif source_anchor != target_anchor:
            warnings.append(f"object {handle} has different optional semantic anchors")

    for index, addition in enumerate(additions):
        name = str(addition.get("target_group", "")).strip() or f"target_additions[{index}]"
        if addition.get("source_handle"):
            continue
        if addition.get("user_approved") is not True:
            errors.append(f"unapproved target addition: {name}")
        if not str(addition.get("reason", "")).strip():
            errors.append(f"target addition {name} has no reason")

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "metrics": {key: round(value, 4) for key, value in metrics.items()},
        "counts": {
            "source_layers": len(layers),
            "source_objects": len(objects),
            "target_additions": len(additions),
        },
    }


def self_test() -> int:
    valid = {
        "source_layers": [
            {"name": "A-WALL-NEW", "entity_count": 2, "disposition": "mapped", "target_groups": ["02_New_Walls"]},
            {"name": "A-FURN", "entity_count": 1, "disposition": "mapped", "target_groups": ["05_Furniture"]},
        ],
        "source_objects": [
            {
                "source_handle": "BED1",
                "source_layer": "A-FURN",
                "kind": "bed",
                "status": "mapped",
                "target_group": "Primary_Bed",
                "source_bbox_mm": [0, 0, 1800, 2100],
                "target_bbox_mm": [0, 0, 1800, 2100],
                "source_rotation_deg": 90,
                "target_rotation_deg": 90,
                "source_anchor": "headboard_west_wall",
                "target_anchor": "headboard_west_wall",
            }
        ],
        "target_additions": [],
    }
    invalid = json.loads(json.dumps(valid))
    invalid["source_layers"][0]["target_groups"] = []
    invalid["source_objects"][0]["target_rotation_deg"] = 0
    invalid["target_additions"] = [{"target_group": "Unrequested_Lamp", "reason": "decor"}]
    valid_result = validate_manifest(valid)
    invalid_result = validate_manifest(invalid)
    if not valid_result["ok"] or invalid_result["ok"] or len(invalid_result["errors"]) < 3:
        print(json.dumps({"valid": valid_result, "invalid": invalid_result}, indent=2))
        return 1
    print("self-test passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", nargs="?", help="Path to the CAD-to-SU trace manifest")
    parser.add_argument("--output", help="Optional JSON validation report path")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.manifest:
        parser.error("manifest is required unless --self-test is used")
    manifest_path = Path(args.manifest)
    data = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    result = validate_manifest(data)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    print(text)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
