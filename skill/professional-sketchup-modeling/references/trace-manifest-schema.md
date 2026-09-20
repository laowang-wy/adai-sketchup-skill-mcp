# SketchUp 来源溯源清单（trace-manifest）规范
Read for CAD-to-SU or image-based exact reconstruction before any geometry generation. This is the only accepted `trace_manifest.json` schema and its validator contract.


CAD 或有对象级权威布局的任务使用本清单；普通照片比例重建使用 projection_brief 与工作记录，不伪造 CAD 图层和句柄。清单不是源几何，校验通过后仍须按受管阶段建模。

写到 `[AI工作区]/<项目>/trace_manifest.json`，不要写在技能目录内。
UTF-8 **不带 BOM**——`json.load` 读到 BOM 直接 `Unexpected UTF-8 BOM` 报 rc=2。

## 根字段

| 字段 | 必填 | 内容 |
|---|---|---|
| `meta` | 是 | 校验器只强制 `title`、`source`（DWG/图片路径）；`units`（默认 `mm`）、`tolerance_mm` 建议填 |
| `source_layers` | 是 | 源 CAD 图层列表，每层含 `name`、`status`、`entity_count` |
| `mappings` | 是 | 每个 SU 对象的来源映射，见下方对象格式 |
| `additions` | 否 | 经用户批准新增、无对应源的对象（**缺 `approved_by` 直接 ERROR**）|
| `exclusions` | 否 | 来源中明确排除的图层或对象，每条须有 `layer` 和 `reason` |

`meta.tolerance_mm` 给了就必须 > 0，否则 ERROR；不给不报错。

## source_layers 对象

```json
{"name": "A-WALL-EXIST", "status": "mapped", "entity_count": 24}
```

`status` 取值：`mapped`（已在 mappings 中覆盖）、`excluded`（在 exclusions 中有据）、
`empty`（源图层为空，可忽略）。三者之外的值（含缺失）一律 ERROR。

**所有非空图层必须是 `mapped` 或 `excluded`，不允许留空 `status` 或遗漏。**

两条联动约束（容易漏，直接决定能否通过）：

- 图层写 `mapped`，`mappings` 里必须真有对象引用它 → 否则 **ERROR `COVERAGE_GAP`**
- 图层写 `excluded`，`exclusions` 里必须有一条 **`layer` 等于该图层名** → 否则 WARN

`entity_count` 省略或为 `0` 时，该图层跳过覆盖检查——**别用省略 `entity_count` 来绕过覆盖闸门**，
非空图层如实填数量。

## exclusions 对象

```json
{"layer": "A-GRID", "reason": "轴网仅供定位，不建模"}
```

键名是 **`layer`**（不是 `name`）。缺 `layer` 时校验器无法与 `source_layers` 对应，
会报 `EXCLUSION_NO_REASON`，即使你已经写了 `reason`。

## additions 对象

```json
{"su_name": "台阶_三级", "approved_by": "user", "reason": "照片可见但源图层无对应实体"}
```

`approved_by` **缺失即 ERROR**，`reason` 缺失为 WARN。参考图任务里凡是源中无据、
靠推断补出来的构件，都放这里并注明谁批准，不要混进 `mappings`。

## mappings 对象

```json
{
  "su_name":       "outer_wall_south",
  "su_kind":       "wall",
  "source_layer":  "A-WALL-EXIST",
  "source_handle": "2A1F",
  "confidence":    "explicit",
  "center_xy":     [3000.0, 100.0],
  "footprint_wh":  [6000.0, 200.0],
  "rotation_deg":  0.0,
  "contacts":      ["S"],
  "facing_target": null
}
```

| 字段 | 说明 |
|---|---|
**必填**（缺任一即 ERROR）：`su_kind`、`source_layer`、`confidence`、`center_xy`、`footprint_wh`。
`su_name` 重复也是 ERROR。其余字段可省略。

| 字段 | 说明 |
|---|---|
| `su_name` | SU 分组名，须唯一 |
| `su_kind` | 见下方枚举，**不在表内只报 WARN 不拦，但优先用已有值** |
| `source_layer` | 来自哪个 CAD 图层 |
| `source_handle` | CAD 实体句柄（`list_entities` 返回值），可省略或 `null`（参考图来源时）|
| `confidence` | `explicit`（源文件明确）/ `inferred`（推断）/ `user_confirmed`（用户确认），**其他值 ERROR** |
| `center_xy` | 平面中心点 `[x, y]`（mm），必须正好 2 个元素 |
| `footprint_wh` | 水平面包围盒 `[宽, 高]`（mm，按源旋转前），必须 2 个元素**且都为正数** |
| `rotation_deg` | 在 XY 平面的旋转角度（度，逆时针为正），须为数值 |
| `contacts` | 接触的墙面方向列表，**只允许 `N`/`S`/`E`/`W`**；`null` 或 `[]` 表示不接触 |
| `facing_target` | 朝向目标（电视/椅背等），`null` 表示无要求 |

`su_kind` 完整枚举：

```
wall door window opening
bed sofa chair dining_chair stool ottoman
cabinet wardrobe counter shelving
toilet basin shower bathtub
tv fridge washer stove sink fixture
table desk coffee_table dining_table
lamp other trace_only
```

建筑外立面构件（屋顶、檐口、台阶、阳台、柱、线脚）表里没有专用值，用 `other`。

可选字段（床/洁具等语义对象建议填写）：`headboard_side`、`screen_side`、`host_wall`。
`su_kind` 以 `bed` 开头而缺 `headboard_side`、`tv` 而缺 `screen_side`，都会报 WARN。

## 校验

```bat
"<私有python.exe>" "[技能工作目录]\scripts\validate_trace.py" "<trace_manifest.json绝对路径>"
```

退出码：`0` = 无 ERROR，`1` = 有 ERROR，`2` = 文件缺失 / JSON 格式错 / 根节点不是对象。
**所有 ERROR 修完再开始建模**；WARN 可以放行，但要在报告里说明接受原因。

加 `--json <路径>` 可把结构化报告落盘，便于对着 `code` 逐条修。

以下为主要 ERROR 类别，实际校验器输出为准：

| code | 触发条件 |
|---|---|
| `SCHEMA_*` | 缺 `meta`/`source_layers`/`mappings`，或 `meta` 缺 `title`/`source`，或 `tolerance_mm` ≤ 0 |
| `SL_STATUS` / `SL_DUP` / `SL_SCHEMA` | 图层 `status` 非法、名称重复、缺 `name` |
| `MAP_SCHEMA` / `MAP_DUP` | mapping 缺 5 个必填字段之一、`su_name` 重复 |
| `MAP_CONF` / `MAP_GEOM` / `MAP_CONTACTS` | `confidence` 非法、坐标不是 2 元素、`footprint_wh` 非正、`contacts` 含非法方向 |
| `COVERAGE_GAP` | 图层标 `mapped` 但没有对象引用它 |
| `ADD_NO_APPROVAL` | `additions` 条目缺 `approved_by` |


---

## Minimal Worked Example (trace-driven smoke test)

This is a synthetic wall/opening smoke example for validating a source-bound step, not a complete production delivery loop. It uses the proven `ai_wall` snippet (wall with a true opening) instead of a bare box, because openings are where naive geometry code fails.

**Step A — write the trace manifest** (UTF-8 *without* BOM; BOM makes the validator exit rc=2). Minimal passing form — all five required mapping fields present, every `mapped` layer referenced:

```json
{
  "meta": { "title": "smoke wall", "source": "synthetic", "units": "mm", "tolerance_mm": 5 },
  "source_layers": [
    { "name": "A-WALL", "status": "mapped", "entity_count": 1 }
  ],
  "mappings": [
    {
      "su_name": "smoke_south_wall",
      "su_kind": "wall",
      "source_layer": "A-WALL",
      "source_handle": null,
      "confidence": "explicit",
      "center_xy": [2000, 0],
      "footprint_wh": [4000, 240],
      "rotation_deg": 0,
      "contacts": [],
      "facing_target": null
    }
  ]
}
```

Save it to the project workspace (never inside the skill directory), e.g. `D:/temp/su_smoke/trace_manifest.json`. Full contract: [trace-manifest-schema.md](trace-manifest-schema.md). Offline validation without the MCP: `python scripts/validate_trace.py <path>` (exit 0 = no ERROR, 1 = ERROR, 2 = file/JSON broken).

Before the MCP commands, define the local caller once:

```powershell
$call = '<SKILL_ROOT>\scripts\call_sketchup_mcp.mjs'   # replace <SKILL_ROOT> with the installed folder that contains SKILL.md
```
**Step B — validate through the MCP** (this tool does not contact SketchUp):

```powershell
node $call --tool validate_trace_manifest --args '{"manifest_path":"D:/temp/su_smoke/trace_manifest.json"}'
```

Fix every ERROR before modeling; WARN may pass but must be acknowledged in the report.

**Step C — begin a managed CAD project, then build from the snippet library.** `scripts/smoke_wall.rb` implements the managed `PipClawManagedBuild` contract and contains the proven `ai_wall` snippet (4000mm wall, 900x2100 door, manifold self-check):

```powershell
node $call --tool sketchup_project_begin --args '{"mode":"cad","output_directory":"D:/temp/su_smoke/output","project_id":"TraceSmoke01"}'
node $call --tool sketchup_project_step --args '{"project_id":"TraceSmoke01","ruby_file":"<SKILL_ROOT>/scripts/smoke_wall.rb"}'
```

Inspect the automatically returned evidence and review it before any later geometry step. Production continue requires the bound [quality_review](managed-quality-review.md); this first-step example does not demonstrate all later phases or finished delivery.

**Step D — semantic readback against the manifest.** The script prints e.g. `SMOKE_READBACK {"name":"smoke_south_wall","manifold":true,"min_mm":[0.0,-120.0,0.0],"max_mm":[4000.0,120.0,2800.0]}`. Compare with the manifest: `footprint_wh [4000, 240]` must match `max-min` in X and Y within `tolerance_mm`, and `center_xy [2000, 0]` must match the bounding-box center. `manifold:false` or any mismatch = geometry failure; request managed revise and confirm rollback before fixing/rebuilding — do not paint over it with views.

**Step E — visual evidence:** open the managed returned views and confirm the door opening is a real through-hole, not a drawn rectangle. Supplement only missing views through supported evidence controls; do not export from the build script.

Legacy selftest_room.py is a different raw-write stack, not a production fallback. Numeric diagnostics never replace visual review; do not auto-approve unseen source evidence.
