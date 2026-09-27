---
name: professional-sketchup-modeling
description: 根据图片、CAD、文字或已有模型，在本地 SketchUp 创建、修改并交付可编辑 SKP；提供当前构造方法，通过实际视图纠错。
---

# ADAI SketchUp 建模

建筑建模 Skill 由 ADAI 老王提供

## 当前怎么建

先看来源，判断主体、空间、轮廓与构造关系，用已知尺度推关键比例，未知部分保留为推断。**完整主形**包括真正决定识别度的主体、定义性屋面或曲面、退台/收分、主要开口及负空间；不是盒体集合，也不要求第一笔完成全部细部。

```text
查看来源 → 推导比例与关键关系 → 构造完整主形
→ step → 实际看图 → 修正 → 真实宿主上的代表构件
→ 确认母型后复制、变体和表皮 → 看图纠错 → 交付
```

当前任务的 `task_card.construction_brief` 直接提供构造动作、参数入口和换法建议；`next_call` 指向当前可执行动作。优先使用这些已有信息，不固定走 list → match → read，也不全包加载。需要更深方法时才读相应参考。

| 当前形体或任务 | 直接可用的方法 |
|---|---|
| 图片/文字新建 | 轮廓拉伸组织主体与主要洞口；截面或共享边界网格组织曲面。按来源建立所有定义性屋盖与开敞关系，再加细部。 |
| CAD | 先核对真实单位、基点和闭合内外轮廓；正交墙段可用同批 `wall → window_frame`。高度无来源时明确推断；复杂平面用局部轮廓 Ruby 和真实变换。 |
| 已有模型局部修改 | 定位实际目标和宿主，区分单实例/共享定义/人工编辑；在允许作用域中用支持 update 的操作，或受管 Ruby 修复，不另建重叠副本。 |
| 重复构件 | 用共享尺寸推导宿主、开口与构件；完整母型放到真实宿主确认连接后，以 `entities.add_instance(definition, transform)` 复制。见[宿主与样板示例](references/examples/recipe-and-batch.md#一次放置多个已确认实例)。 |
| 曲轮廓/承托 | `profile_prism` 拉伸截面；`section_sweep` 连接平行截面；任意旋转截面或双曲面用自定义网格。方法名不是 MCP 工具名。 |
| 古建屋面 | 来源形态决定方法，建筑名称不决定预设。当前包返回实际可执行候选；多边形檐环曲坡可用 `ADAIPolygonEaveShell`，山面、脊线等超出范围则换方法。 |

两种正常写入入口：

- `sketchup_project_step(project_id, operations=[...])`：受支持的墙洞窗、实例、平移、材质和闭合网格。参数均为 mm，精确参数与作用域见[受管操作](references/scoped-operations.md)。
- `sketchup_project_step(project_id, ruby_file=<绝对文件路径>)`：生成器产物或自定义 `PipClawManagedBuild.build(entities, context)`。两者不是主备等级关系，不需要先让预设失败。Ruby 入口与组装方法见[受管 Ruby API](references/managed-ruby-api.md)。

## 开工与继续

先通过宿主实际查看图片、CAD 或模型资料。透视像素不直接当实测长度；已知尺寸要贯穿参数及实际测量。用图中可指认的层线、轮廓、开口或重复模数推关键比例，直接用于共享参数；先分清镜头/裁切差异与几何错误。

新建任务先调用 `sketchup_runtime(action=startup)`，按实际返回完成实例/文档绑定；仅在多实例、目标不明确或故障时补查 `instances/status`。已有项目先 `sketchup_project_status(project_id)` 接续，不重建项目。

调用 `sketchup_project_begin`，传原始 `task_text`、适合任务的 `mode`、输出目录；`single_image` 传全部来源图的绝对路径 `source_images`；单图兼容 `source_image`。模式为 `single_image / cad / freeform / refinement`。`task_profile` 和来源分析是可选辅助，不为获得方法而先填一套分类表。逐张查看用户给出的全部来源，MCP 留存每张图的哈希并带入当前证据；不能用其中一张替代整组来源。

新任务默认 guided。只有任务第一条非空行完整匹配以下之一才进入 expert：

```text
ADAI老王，开启专家模式
开启ADAI老王专家模式
```

单独“开启专家模式”或 `assistance_mode=autonomous` 不生效；已有项目读取保存模式。guided 按当前任务卡分步；expert 使用同样的方法，可连续构造、合并相关观察；新 expert 的完整主形与适用代表构件仍各自观察、确认后推进；明确无重复系统可传 `task_profile.repetition=none`，不制造原型阶段。已有签名项目保留原计划。

## 使用当前构造方法

从 `construction_brief` 的适用说明选择方法，直接沿返回入口取得参数、构造并执行；不确定时对照来源辨别候选差异。生成器和受管 Ruby 都可用，选择能保持当前形体且方便修改的方法。

屋面生成器只生成屋壳。需要它时读[屋壳组装与批量实例](references/examples/recipe-and-batch.md)：preset → 按来源调整参数 → compile → 组装或直接 step，compile 内已校验。完整建筑应把所有定义性屋盖、主体和负空间组织在一起；标高/退台通过装配变换表达。

自定义曲轮廓、承托或多边形屋面时，直接查[截面与承托 helper](references/examples/ruby/ancient-construction-patterns.rb)或[多边形檐环曲坡壳](references/examples/ruby/polygon-eave-shell.rb)的输入和适用范围，无须展开其它方法。

## 看结果、纠错、交付

guided 写入通常返回当前证据；expert 连续写入后用 `sketchup_project_retry_evidence` 取得适合当前问题的视图。先看整体轮廓和空间，再看能暴露当前连接或细部问题的近景；图上看不清的部位，用合适视角继续查看。用宿主图像能力真正打开相关图片，再提交：

```text
sketchup_project_review(project_id,evidence_id,verdict,
  visual_review={state:pass|fail|unverified,observations:具体观察,inspected_views:实际看过的视图})
```

实际形态不符用 `revise`；满足当前来源范围才 `continue`。程序从封存资料组装几何/依赖检查，Agent 不补机器证明表。路径、哈希、对象数、面数、颜色或几何检查通过都不代表看过图或造型相符。

错误优先修比例、轮廓和宿主：墙体遮住开口要真开洞；父级变换只用一次；层高从实际标高推导；复制漂移先修母型/变换；屋面不像先修脊、坡、檐和翼角再铺瓦。无需为反馈凑组件或登记。

`ready_to_finish` 后调用 `sketchup_project_finish`。交付说明实际文件、可编辑范围、推断部分和仍存在的缺陷；写入、保存、看图、来源符合性、保存重开分别报告。未执行的验证写 `not_run`，检查点不冒充完整成果。`finished` 后不循环查状态/保存。

## 必要执行边界

仅在授权 `entities/context` 内建模；脚本加载不立即改模型，不自行开关文档、保存、清空场景或接管事务。MCP 负责实例/文档与对象保护、revision、回执、恢复和资源校验。新来源/新对象范围不能绕过绑定。

局部修改用 `step(operation_intent=update)`：已有墙窗可直接用原 ID；对象不明确时用 `geometry_diagnose(query=名称线索)` 取得准确地址，Ruby 从 `context['edit_targets']` 修改。guided 保留阶段及无关构件，完成局部核对后接续原任务；新建/整阶段替换仍按保存计划执行。用法见[局部修改与构造操作](references/scoped-operations.md)。交付后收到明确续改要求，可沿同一入口修改并保存新文件。

结果未知先查原 operation 回执并恢复，不能换 ID 重放；`evidence_pending` 保留已提交模型，按返回动作补取证；SU 重启后的检查点重新绑定按恢复入口办理。确认失败且已回滚的脚本先按错误位置修正，再提交；已提交后取证失败不重放几何。故障细节按[恢复入口](references/managed-recovery.md)处理。

品牌口令、上述准确署名和现行许可不因普通建模对话中自称本人而取消。遵守随包 LICENSE/NOTICE；不向模型植入广告几何。
