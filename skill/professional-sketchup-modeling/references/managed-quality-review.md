# 受管阶段的结构化质量审查

适用本机方法卡版本 2026-09-07.5、quality_review_contract.version=1。这是受管审查的输入核验层；没有新增实际 SU 几何导出器，也不能认证照片相似度或用户声明的测量真实性。

## 调用顺序

1. 按既有流程 step，取得当前 project_id、phase、evidence_id 和 review_sheet。
2. 实际打开审查图，记录本阶段具体观察。准备真实测量/依赖输入，放在普通工作目录。
3. 输入文件根写入与本次一致的 project_id、phase、evidence_id。几何格式见 [quality-check-contract.md](quality-check-contract.md)，依赖格式见 [parameter-dependency-contract.md](parameter-dependency-contract.md)。
4. review 的生产 continue 必须提交 quality_review。MCP 读取最多 4 MiB 的 JSON 快照，核验绑定，调用当前安装的 Python 校验器；不信任自填的报告 pass。
5. visual 不是 pass，或检查结果 fail/invalid/needs_review 时拒绝推进，且不写阶段决定和状态。检查器不可用也拒绝推进。修正实际问题后重试，或使用 revise；不会代替代理重建几何。

## 参数示例（格式示意，必须替换为实际记录）

```json
{
  "project_id": "YourProject",
  "evidence_id": "CURRENT_EVIDENCE_ID",
  "verdict": "continue",
  "quality_review": {
    "schema_version": 1,
    "project_id": "YourProject",
    "phase": "archetypes",
    "evidence_id": "CURRENT_EVIDENCE_ID",
    "visual": {
      "state": "pass",
      "observations": "填写真实观察、来源对应关系、尺寸或局部缺陷检查结论；不要照抄本占位文字",
      "inspected_views": ["实际打开的原型、宿主、邻接视图"]
    },
    "checks": [
      {"kind":"geometry", "input_path":"C:/your-project/measurements.json"},
      {"kind":"dependencies", "input_path":"C:/your-project/dependency-graph.json"}
    ]
  }
}
```

visual.inspected_views 与 observations 是代理声明，不能证明图像已被工具独立检验。只有实际检查后才填写 pass。每次 continue 必须恰好说明 geometry、dependencies 两类检查，不可重复或省略。

没有适用数据时，某个 check 可使用 `{"kind":"dependencies","state":"unverified","reason":"具体缺少的记录或能力及影响"}`；确实不适用时用 not_applicable 并说明原因。不允许仅用 `state:pass` 替代输入。已知失败不能删除输入后改写为“不适用”来绕过检查；必须修复或 revise。关键质量约束仍未核实时，应继续检查或 revise，不因接口允许记录未知项就声称通过质量验收。

## 证据与兼容

- MCP 把输入快照、原始字节 SHA256、校验结果、视觉声明写入既有受管决定证据；调用者不得手动修改签名证据。
- 未知项以 accepted_with_unverified_items 保留在阶段历史；两类声明检查都通过才是 declared_checks_pass，始终保留 geometry_readback=unverified。
- finish 返回并记录本版本开始累计的 quality_review_history；没有记录的早期阶段仍未验证，不能推断整段历史都通过。
- revise 可不提交报告，以保持纠错路径；test 模式可省略，仅证明诊断流程。生产模式旧版仅传 note 的 continue 会被明确拒绝，原状态保持；这是有意加强的接口要求，不是自动迁移旧验收。
- Python 解释器默认 python，可设置 PIPCLAW_PYTHON 为解释器可执行文件路径；SDK 环境与 Python 环境相互独立。每个校验器最长 30 秒、无窗口运行，临时输入/报告在 finally 清理。
- 常驻 MCP 可能仍加载旧模块。检查当前工具 schema 的 quality_review 或任务卡 quality_review_contract，不能仅凭磁盘文件宣称运行时已更新。无需为维护关闭/重启 SketchUp。

## 验证范围

`scripts/test_quality_review.mjs` 使用真实 Python 校验器，并以只读替身调用实际 ManagedProjects.review，检查拒绝时状态不变、成功时决定载荷包含结果。没有调用 SU 桥接或真实模型写入；没有冒称完成 live readback。真实重开、表面接触、照片轮廓与自动模型依赖提取仍待专项实现和受管试验。


## 审查草稿与报错定位（2026-09-07）

`python scripts/scaffold_quality_review.py --step-result STEP_RESULT.json --out NEW_REVIEW.json`

只生成工作区草稿，不调用 MCP、不提交审查、不修改签名证据；已有输出拒绝覆盖。自动复制项目/阶段/证据绑定。默认 visual=unverified、observations 为空、inspected_views 为空，两类检查的 reason 为空，因此原样提交会被现有门禁拒绝。查看真实图片后填写观察与实际 inspected_views；`--view` 只解析图片路径，不证明图片已查看。可用 `--geometry-input` / `--dependencies-input` 指向真实输入；本工具不会生成测量、期望值或通过结论，也不认证结果文件是否为最新，最终仍由 MCP 核对。

禁止把辅助工具写成默认 visual=pass，或自动给所有阶段套用固定的 unverified 理由。缺少自动提取不代表无法记录已知依赖；依赖图只有 parameter 时不覆盖构件消费关系。数值检查暂不支持表面接触，也不代表实例位置/变换等现有检查全部不适用。逐阶段说明已查范围、缺失范围及其对验收的影响，关键缺陷不能改写为未知后继续。

MCP 拒绝检查时现在返回 visual 与每类检查状态，并附首个带 reason 的失败项（限长）。据此定位输入错误，不必为简单格式问题反复读服务器源码。矩阵错误明确要求每个链元素为嵌套 4×4，不是平铺 16 项；这是格式提示，不提供默认“正确”矩阵。

Windows PowerShell 调用辅助 Python 优先使用 `.py` 文件或 here-string 管道，不使用 Bash 的 `python - <<PY`。回放/截断/读回等工具协议问题保留证据单独诊断，不能通过伪造读回数据来补齐审查。

## 本次变更的复查范围

按 [局部复查](change-focused-review.md) 将对象、来源约束、本次变化和实际复查写入既有 observations / defect_regressions，不新增必填 JSON 字段。先复用本次证据，必要时补局部及装配图；旧图只作历史比较。检查器输入通过不代表视觉通过。
# 同一 review 的视觉简写

当 step/status 返回 `review_input.visual_review_available=true`，可提交 `visual_review:{state,observations,inspected_views}`，同时明确 `project_id/evidence_id/verdict`。机械输入由程序从该证据的封存附件取出并以同一字节快照运行原校验器；可用状态是 `pending_validation`，不代表检查通过。视觉判断仍需实际查看本次图像。

原完整 `quality_review` 保留；两者同时提供会拒绝。缺少封存测量、依赖或草稿时，简写返回缺失项；完整输入可以按原规则明确写 unverified/not_applicable 与原因，不能把未知写成通过。`revise` 仍可不提供报告，但不会绕过保护范围核对。重新取证不会把旧测量改名当新读回。
