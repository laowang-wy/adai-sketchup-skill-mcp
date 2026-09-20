#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""校验 SketchUp 来源溯源清单（trace_manifest.json）。

只用标准库，不需要 pip 安装。

用法:
    python validate_trace.py <trace_manifest.json> [--json 报告输出路径]

退出码: 0 = 无 ERROR, 1 = 有 ERROR, 2 = 文件/格式无法读取
"""
import argparse
import json
import sys

# Windows 控制台默认 GBK；错误信息含中文，先统一到 UTF-8 输出。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

REQUIRED_ROOT = ["meta", "source_layers", "mappings"]
OPTIONAL_ROOT = ["additions", "exclusions"]

VALID_STATUS   = {"mapped", "excluded", "empty"}
VALID_CONF     = {"explicit", "inferred", "user_confirmed"}
VALID_CONTACTS = {"N", "S", "E", "W"}
VALID_KIND = {
    "wall", "door", "window", "opening",
    "bed", "sofa", "chair", "dining_chair", "stool", "ottoman",
    "cabinet", "wardrobe", "counter", "shelving",
    "toilet", "basin", "shower", "bathtub",
    "tv", "fridge", "washer", "stove", "sink", "fixture",
    "table", "desk", "coffee_table", "dining_table",
    "lamp", "other", "trace_only",
}


class Report:
    def __init__(self):
        self.errors = []
        self.warns  = []

    def error(self, code, msg):
        self.errors.append({"code": code, "message": msg})

    def warn(self, code, msg):
        self.warns.append({"code": code, "message": msg})

    @property
    def ok(self):
        return not self.errors


# ── schema ──────────────────────────────────────────────────────────────────

def check_schema(plan, rep):
    for key in REQUIRED_ROOT:
        if key not in plan:
            rep.error("SCHEMA_MISSING", "缺少必填根字段 `%s`" % key)
    meta = plan.get("meta")
    if not isinstance(meta, dict):
        rep.error("SCHEMA_META", "`meta` 必须是对象"); return
    for key in ("title", "source"):
        if key not in meta:
            rep.error("SCHEMA_META", "`meta` 缺少 `%s`" % key)
    tol = meta.get("tolerance_mm")
    if tol is not None and float(tol) <= 0:
        rep.error("SCHEMA_META", "`meta.tolerance_mm` 必须大于 0")


# ── source_layers ────────────────────────────────────────────────────────────

def check_source_layers(plan, rep):
    layers = plan.get("source_layers")
    if not isinstance(layers, list):
        rep.error("SL_TYPE", "`source_layers` 必须是数组"); return

    seen_names = set()
    mapped_names = set()
    excluded_names = set()

    for item in layers:
        if not isinstance(item, dict):
            rep.error("SL_ITEM", "`source_layers` 中有非对象项"); continue
        name = item.get("name")
        if not name:
            rep.error("SL_SCHEMA", "`source_layers` 某项缺少 `name`"); continue
        if name in seen_names:
            rep.error("SL_DUP", "source_layer 名称重复: `%s`" % name); continue
        seen_names.add(name)

        status = item.get("status")
        if status not in VALID_STATUS:
            rep.error("SL_STATUS",
                      "图层 `%s` 的 status `%s` 非法，应为 %s"
                      % (name, status, "/".join(sorted(VALID_STATUS))))
        elif status == "mapped":
            mapped_names.add(name)
        elif status == "excluded":
            excluded_names.add(name)

        ec = item.get("entity_count")
        if ec is not None and int(ec) < 0:
            rep.error("SL_COUNT", "图层 `%s` 的 entity_count 不能为负" % name)

    # 检查 mappings 里引用的图层是否都出现在 source_layers
    for m in plan.get("mappings") or []:
        sl = m.get("source_layer")
        if sl and sl not in seen_names:
            rep.warn("SL_MISSING_REF",
                     "mapping `%s` 引用了 source_layers 中不存在的图层 `%s`"
                     % (m.get("su_name", "?"), sl))

    return seen_names, mapped_names, excluded_names


# ── mappings ─────────────────────────────────────────────────────────────────

def check_mappings(plan, rep):
    mappings = plan.get("mappings")
    if not isinstance(mappings, list):
        rep.error("MAP_TYPE", "`mappings` 必须是数组"); return

    if not mappings:
        rep.warn("MAP_EMPTY", "`mappings` 为空，没有任何对象被映射")

    seen = set()
    for m in mappings:
        if not isinstance(m, dict):
            rep.error("MAP_ITEM", "`mappings` 中有非对象项"); continue

        name = m.get("su_name", "?")
        if name in seen:
            rep.error("MAP_DUP", "`mappings` 中 su_name 重复: `%s`" % name)
        seen.add(name)

        # 必填字段
        for key in ("su_kind", "source_layer", "confidence", "center_xy", "footprint_wh"):
            if key not in m:
                rep.error("MAP_SCHEMA",
                          "mapping `%s` 缺少必填字段 `%s`" % (name, key))

        kind = m.get("su_kind")
        if kind and kind not in VALID_KIND:
            rep.warn("MAP_KIND",
                     "mapping `%s` 的 su_kind `%s` 不在已知列表中（新类型请手动确认）"
                     % (name, kind))

        conf = m.get("confidence")
        if conf and conf not in VALID_CONF:
            rep.error("MAP_CONF",
                      "mapping `%s` 的 confidence `%s` 非法，应为 %s"
                      % (name, conf, "/".join(sorted(VALID_CONF))))

        # center_xy
        cxy = m.get("center_xy")
        if cxy is not None:
            if not (isinstance(cxy, list) and len(cxy) == 2):
                rep.error("MAP_GEOM",
                          "mapping `%s` 的 center_xy 必须是 [x, y]" % name)

        # footprint_wh
        fwh = m.get("footprint_wh")
        if fwh is not None:
            if not (isinstance(fwh, list) and len(fwh) == 2):
                rep.error("MAP_GEOM",
                          "mapping `%s` 的 footprint_wh 必须是 [宽, 高]" % name)
            else:
                if float(fwh[0]) <= 0 or float(fwh[1]) <= 0:
                    rep.error("MAP_GEOM",
                              "mapping `%s` 的 footprint_wh 必须为正数" % name)

        # rotation
        rot = m.get("rotation_deg")
        if rot is not None:
            try:
                float(rot)
            except (TypeError, ValueError):
                rep.error("MAP_GEOM",
                          "mapping `%s` 的 rotation_deg 必须是数值" % name)

        # contacts
        contacts = m.get("contacts")
        if contacts is not None and contacts != []:
            if not isinstance(contacts, list):
                rep.error("MAP_CONTACTS",
                          "mapping `%s` 的 contacts 必须是数组或 null" % name)
            else:
                for c in contacts:
                    if c not in VALID_CONTACTS:
                        rep.error("MAP_CONTACTS",
                                  "mapping `%s` contacts 含非法方向 `%s`"
                                  % (name, c))

        # 床类对象必须有 headboard_side
        if kind and kind.startswith("bed"):
            if not m.get("headboard_side"):
                rep.warn("MAP_BED_HEAD",
                         "床对象 `%s` 未指定 `headboard_side`，难以验证朝向" % name)

        # 电视类对象建议有 screen_side
        if kind == "tv" and not m.get("screen_side"):
            rep.warn("MAP_TV_SCREEN",
                     "电视 `%s` 未指定 `screen_side`，难以验证朝屏方向" % name)


# ── coverage gate ─────────────────────────────────────────────────────────────

def check_coverage(plan, rep):
    """所有非空源图层必须是 mapped 或 excluded，不允许遗漏。"""
    layers = plan.get("source_layers") or []
    mappings_layers = {m.get("source_layer") for m in plan.get("mappings") or [] if m.get("source_layer")}
    exclusion_layers = {e.get("layer") for e in plan.get("exclusions") or [] if e.get("layer")}

    for item in layers:
        if not isinstance(item, dict):
            continue
        name   = item.get("name")
        status = item.get("status")
        ec     = item.get("entity_count", 0)
        if status == "empty" or (ec == 0):
            continue
        if status == "mapped" and name not in mappings_layers:
            rep.error("COVERAGE_GAP",
                      "图层 `%s` 标记为 mapped 但 mappings 里没有任何对象引用它"
                      % name)
        if status == "excluded" and name not in exclusion_layers:
            rep.warn("EXCLUSION_NO_REASON",
                     "图层 `%s` 标记为 excluded 但 exclusions 里没有对应条目和原因"
                     % name)


# ── additions ─────────────────────────────────────────────────────────────────

def check_additions(plan, rep):
    for add in plan.get("additions") or []:
        if not isinstance(add, dict):
            continue
        name = add.get("su_name", "?")
        if not add.get("approved_by"):
            rep.error("ADD_NO_APPROVAL",
                      "新增对象 `%s` 缺少 `approved_by`（必须记录谁批准了此新增）"
                      % name)
        if not add.get("reason"):
            rep.warn("ADD_NO_REASON",
                     "新增对象 `%s` 缺少 `reason` 说明" % name)


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="校验 SketchUp trace manifest JSON")
    ap.add_argument("manifest", help="trace_manifest.json 路径")
    ap.add_argument("--json", dest="out", help="报告 JSON 输出路径")
    args = ap.parse_args()

    try:
        with open(args.manifest, "r", encoding="utf-8") as fh:
            plan = json.load(fh)
    except FileNotFoundError:
        print("[FATAL] 找不到文件: %s" % args.manifest)
        return 2
    except json.JSONDecodeError as exc:
        print("[FATAL] JSON 格式错误: %s" % exc)
        return 2

    if not isinstance(plan, dict):
        print("[FATAL] 根节点必须是对象")
        return 2

    rep = Report()
    check_schema(plan, rep)
    check_source_layers(plan, rep)
    check_mappings(plan, rep)
    check_coverage(plan, rep)
    check_additions(plan, rep)

    n_map  = len(plan.get("mappings")  or [])
    n_sl   = len(plan.get("source_layers") or [])
    n_add  = len(plan.get("additions") or [])
    n_excl = len(plan.get("exclusions") or [])

    result = {
        "ok": rep.ok,
        "manifest": args.manifest,
        "counts": {"source_layers": n_sl, "mappings": n_map,
                   "additions": n_add, "exclusions": n_excl},
        "errors": rep.errors,
        "warnings": rep.warns,
    }

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=2)

    for e in rep.errors:
        print("[ERROR] %s: %s" % (e["code"], e["message"]))
    for w in rep.warns:
        print("[WARN ] %s: %s" % (w["code"], w["message"]))

    print("\n统计: source_layers=%d  mappings=%d  additions=%d  exclusions=%d"
          % (n_sl, n_map, n_add, n_excl))
    print("结论: %s (%d ERROR, %d WARN)"
          % ("通过" if rep.ok else "未通过", len(rep.errors), len(rep.warns)))
    return 0 if rep.ok else 1


if __name__ == "__main__":
    sys.exit(main())
