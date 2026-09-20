#!/usr/bin/env python3
"""Create a deterministic side-by-side source/candidate sheet for AI visual inspection.

This script proves which files were compared and makes proportion comparison easier.
It intentionally does not decide architectural similarity; the agent must open the sheet.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except ImportError as exc:
    raise SystemExit("Pillow is required: python -m pip install Pillow") from exc


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def fit_panel(image: Image.Image, width: int, height: int) -> tuple[Image.Image, tuple[int, int, int, int]]:
    scale = min(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (width, height), "#202328")
    x = (width - resized.width) // 2
    y = (height - resized.height) // 2
    panel.paste(resized, (x, y))
    return panel, (x, y, x + resized.width, y + resized.height)


def add_grid(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], offset_x: int = 0) -> None:
    x0, y0, x1, y1 = box
    x0 += offset_x
    x1 += offset_x
    for fraction in (0.25, 0.5, 0.75):
        x = round(x0 + (x1 - x0) * fraction)
        y = round(y0 + (y1 - y0) * fraction)
        draw.line((x, y0, x, y1), fill="#ffcc3388", width=2)
        draw.line((x0, y, x1, y), fill="#ffcc3388", width=2)
    draw.rectangle((x0, y0, x1 - 1, y1 - 1), outline="#ffffff", width=2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--panel-width", type=int, default=800)
    parser.add_argument("--panel-height", type=int, default=900)
    args = parser.parse_args()

    for field, path in (("source", args.source), ("candidate", args.candidate)):
        if not path.is_file():
            print(json.dumps({"ok": False, "error": f"{field} file not found", "path": str(path)}, ensure_ascii=False))
            return 2
    if args.source.resolve() == args.candidate.resolve():
        print(json.dumps({"ok": False, "error": "source and candidate must be different files"}, ensure_ascii=False))
        return 2
    if args.panel_width < 320 or args.panel_height < 320:
        print(json.dumps({"ok": False, "error": "panel dimensions must be >= 320"}, ensure_ascii=False))
        return 2

    source = load(args.source)
    candidate = load(args.candidate)
    header = 58
    gap = 12
    left, left_box = fit_panel(source, args.panel_width, args.panel_height)
    right, right_box = fit_panel(candidate, args.panel_width, args.panel_height)
    sheet = Image.new("RGB", (args.panel_width * 2 + gap, args.panel_height + header), "#111318")
    sheet.paste(left, (0, header))
    sheet.paste(right, (args.panel_width + gap, header))
    draw = ImageDraw.Draw(sheet, "RGBA")
    font = ImageFont.load_default()
    draw.text((16, 18), "SOURCE REFERENCE", fill="white", font=font)
    draw.text((args.panel_width + gap + 16, 18), "CURRENT SKETCHUP EXPORT", fill="white", font=font)
    add_grid(draw, tuple(v + (header if i % 2 else 0) for i, v in enumerate(left_box)))
    shifted_right = tuple(v + (header if i % 2 else args.panel_width + gap) for i, v in enumerate(right_box))
    add_grid(draw, shifted_right)
    draw.line((args.panel_width + gap // 2, 0, args.panel_width + gap // 2, sheet.height), fill="#ff5555", width=3)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output)
    report = {
        "ok": True,
        "source": {"path": str(args.source.resolve()), "sha256": sha256(args.source), "width": source.width, "height": source.height},
        "candidate": {"path": str(args.candidate.resolve()), "sha256": sha256(args.candidate), "width": candidate.width, "height": candidate.height},
        "review_sheet": {"path": str(args.output.resolve()), "sha256": sha256(args.output), "width": sheet.width, "height": sheet.height},
        "warning": "This packet proves file identity only. The agent must open the review sheet and judge architectural similarity.",
    }
    report_path = args.report or args.output.with_suffix(".json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(json.dumps({"ok": True, "output": str(args.output), "report": str(report_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
