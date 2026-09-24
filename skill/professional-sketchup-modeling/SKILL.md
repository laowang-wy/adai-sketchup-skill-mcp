---
name: professional-sketchup-modeling
description: Build editable SketchUp architecture from images, CAD, text or existing SKP with source-based geometry, proven construction methods and real visual review.
---

# ADAI SketchUp 建模

依据用户资料创建或修改准确、可编辑的 SketchUp 模型，持续推进到可核验交付。代理负责观察来源、选择构造方法、生成几何和看图纠错；MCP 负责事务、文档绑定、对象范围、证据、恢复和保存。工具成功、几何合法、视觉相符和文件交付分别判断。

## 1. 先得到可执行方法，再按需读取经验

用户要求决定范围；不要把历史脚本、案例尺寸或旧会话当成本次事实。参考文件不是开工前的阅读清单，也不要因为包里存在文件就全库加载。

先调用 `sketchup_project_begin`。它应把当前来源观察、可执行建筑方法、关键参数、常见错误、检查视角和下一步动作压缩成 `construction_brief`；先执行这张短卡，不要为了寻找方法而自行 `list → match → read`。中式楼阁、塔、黄鹤楼和明确歇山任务，短卡应直接给出 `si_shan` 或同等适用方法及 `preset → compile → step` 动作。

只有短卡明确缺少当前问题所需的方法，或执行中遇到具体疑点时，才定向读取一份对应参考：图片来源不清读图片对照；CAD 单位或语义不清读 CAD 参考；重复构件失真读组件参考；曲面接缝或放样不清读曲面参考；Ruby 边界不清读受管 API/Ruby 片段；运行结果未知读恢复规则。读取后复用同版本内容，不在每阶段重复读取。

随包保留的 `cad-to-su-fidelity.md`、`semantic-validation.md`、`hierarchical-component-workflow.md` 和 `curved-architecture-rules.md` 是按问题调用的后备方法，不是所有任务的必读项。经验卡按“怎么认 → 怎么建 → 哪些参数重要 → 常见错误 → 怎么看 → 不行怎么办”使用；程序负责把适用部分先放进短卡，代理负责建筑判断和实际看图。

## 2. 建模前确认来源和运行环境

先实际打开图片、CAD 或模型证据。透视像素不能直接当真实尺寸；用已知构件、重复模数、图注或用户尺寸推导比例，并分开写可见事实、推导、假设和未知。看不到图时不得猜图或声称已完成视觉检查。

先调用 `sketchup_runtime(action=startup)`，只读取一次精炼短卡；再用 `status`、`ping` 和 `model summary` 核对真实进程、文档和已有项目。多实例先 `instances` 再 `select_instance`；目标不唯一、实例变化或结果未知时停下重选，不重试、不猜测。保护未保存工作，绝对路径打开或切换文档。

随后调用 `sketchup_project_begin`。返回卡应直接给出当前来源观察、可执行建筑方法、关键参数、常见错误、检查视角和下一步动作。正常建模不要求代理先自己 `list → match → read` 才能得到方法；没有匹配方法时才由代理说明原因并选择受管自定义 Ruby。

## 3. 旧版已验证的可执行路线

普通新建的动作顺序保持：

```text
sketchup_project_begin（已有项目先 status）
→ 按返回卡观察来源并选择当前方法
→ 写入 ruby_file 或使用返回的生成器文件
→ sketchup_project_step
→ 实际打开对应视图和 review_sheet
→ sketchup_project_review(revise | continue)
→ 下一项，直到 ready_to_finish
→ sketchup_project_finish
```

中式楼阁、塔、黄鹤楼或明确歇山任务，若返回 `si_shan`，必须优先执行现成路线：

1. 逐张查看来源，记录主体宽深比、层间退台、檐底标高、正脊、山面、侧坡、翼角上扬和廊下开敞；先用相对比例，不编造绝对尺寸。
2. 调用 `sketchup_ancient_tool(action=preset,family=roof,preset_id=si_shan)`，只调整返回参数中的 `width/depth/rise/eave_height/setback/corner_lift` 以对应来源。
3. 调用 `sketchup_ancient_tool(action=compile,family=recipe,parameters=returned_preset,output_directory=<新的绝对目录>)`；校验已经包含在 compile 内。
4. 只使用返回的 `ruby_file` 调用 `sketchup_project_step`，不要把长 Ruby 代码贴在聊天中，也不要把匹配方法改写成盒体代理。
5. step 返回后看正面、侧面、斜视和檐下视图；先修完整主形、屋脊/檐线、翼角、廊下负空间，再组织楼层重复、斗拱、瓦和栏板。

已有匹配方法时，不为了少一次调用而改走自定义 Ruby；只有方法确实不能表达来源关键形体时，才说明边界并换方法。`si_shan` 的角部抬升冲突优先降低 `corner_lift`，不要退回平板或任意棱柱。

## 4. 每次只推进一个尺度，但允许回到前面修正

内部阶段字段保留兼容性；Agent看到的第一项是“完整主形”，不是“几个盒子”。guided 按当前卡逐步提交；autonomous 可以合并相关建筑系统、连续组织构造和授权返修，但两种模式使用同一建筑判断和同一构造方法。

| 当前尺度 | 当前应完成的可见结果 | 发现错误时 |
|---|---|---|
| 完整主形 | 主体轮廓、定义性屋面、退台/收分、主要负空间、开敞关系和主要标高 | 回到主形或来源比例；不能用窗格、材质或登记掩盖 |
| 代表构件 | 一个真实宿主上的完整开间、构件族和转角条件 | 先修原型、接触、厚度和方向，不批量复制 |
| 确认重复 | 使用已确认定义的真实实例，检查首、中、末、对侧和转角 | 修当前复制或回到代表构件；不独立重画造成漂移 |
| 来源变体 | 首层、端头、转角、屋顶或入口等有来源依据的差异 | 只改授权范围，保护无关对象和共享定义 |
| 表皮与细部 | 来源可见的窗墙、栏杆、檐口、节点、材质和收口 | 先修表皮关系和遮挡，不用统一网格或颜色替代 |
| 最终交付 | 主要来源视角、编辑层级、关键连接和交付文件都可核对 | 保留未知和缺陷，不能以文件存在代替质量判断 |

已建正确模型不回退；后续发现需要组件时，可以回到代表构件尺度追加，保留已经确认的主形和对象。

## 5. 五个高频错误要在构造时避免

- 体量挡住窗和廊：主形阶段就组织真实开口和负空间，不以前移玻璃掩盖。
- 细件被父级变换拉歪：完整父级变换只作用一次，正身和转角分别核对。
- 低层墙体偏矮：由梁底和设计间隙逐层推导墙顶，不用统一限高封死通廊。
- 复制后尺寸或方向漂移：先看原型、宿主和接缝，再复制；原型计入总出现关系。
- 屋顶细了却不像：先确定脊线、坡面、剖面、檐线和翼角，再铺瓦和装饰。

不要用对象数量、登记名称、面数、bbox、材质颜色或“几何检查通过”替代建筑形态判断。

## 6. 检查、纠错和恢复

每次 step 后用与来源对应的视角检查当前问题：整体看正面、侧面和斜视；古建再看檐下、正身/转角、下/中/上；重复构件看首/中/末和对侧。每轮只记录最多三个真正影响下一步的偏差、来源依据、修改参数和上一轮是否改善。

第一次 review 前读取[结构化审查](references/managed-quality-review.md)。生产 `continue` 提交绑定当前 `project_id/phase/evidence_id` 的 `quality_review`，说明实际视觉观察以及 geometry/dependencies 检查；缺数据写 `unverified` 和原因，不能伪造通过。形态不符就返修，不能补登记绕过。

结果未知先查原 `operation_id`、项目状态和桥接。`evidence_pending` 只调用 `sketchup_project_retry_evidence`，不重放几何；已提交但取证失败保留提交事实和累计成果；`recovery_required` 按恢复规则处理，不手改签名、状态或历史证据。

## 7. Ruby、模式和交付

Ruby 必须落盘，使用 `PipClawManagedBuild.build(entities, context)`；脚本不保存模型、不切换文档、不改引擎状态、不嵌套事务。能由程序可靠完成的对象定位、重复构造、回执和恢复由 MCP 负责，代理把精力放在来源理解、构造选择和看图纠错。

只有 `finish` 返回 `finished`、实际 `.skp` 存在且对应证据可核对时才报告交付。汇报来源事实、推定部分、主要缺陷、未验证项和文件路径；真实 SketchUp 或视觉未执行时明确写 `not_run`，不以离线测试冒充建筑完成。
