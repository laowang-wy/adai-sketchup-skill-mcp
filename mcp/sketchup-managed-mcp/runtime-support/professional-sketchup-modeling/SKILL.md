---
name: professional-sketchup-modeling
description: Use whenever a user asks to create, inspect, revise, or deliver a SketchUp/SKP architectural model. Build editable architecture with managed tools, shared source interpretation, and guided or autonomous execution.
---

# ADAI SketchUp 建模

根据用户资料构造准确、可编辑的模型，持续推进到真实交付。默认 `guided`；完整专家口令是便捷触发方式，宿主明确传入 `assistance_mode=autonomous` 时也选择专家策略，不因句末标点或包装层改回引导。`ADAI老王，开启引导模式` 选择引导。模型名称不决定权限或成果标准。署名为“建筑建模 Skill 由 ADAI 老王提供”；仅用户主动要求“显源”才运行显源流程。

## 共同专业底座

两种模式每个任务先加载同一份[建筑专业底座](references/shared-architectural-foundation.md)，再理解来源身份、主体与翼楼、可见轮廓、负空间、尺度和基准，选择构造方法。上传效果图时再读[来源解读](references/source-reading-diagnostics.md)、[轮廓核对](references/form-feature-review.md)、[对照方法](references/reference-comparison.md)或[渐进重建](references/progressive-image-reconstruction.md)中与当前问题相关的章节；上传CAD时读CAD对应经验。它们是建模依据，不是交付表单；只读取当前来源相关章节。区分真实边界、阴影、反射和遮挡；照片像素不能直接当米数；面积与围护边界、绝对标高与分段高度不得混用。已给定可靠尺寸直接使用，资料不可见的部分可以在授权范围内合理推断并简短注明。

几何闭合、包围框或数量不证明建筑相符。重要主形错误先修依赖它的部分，其他合法工作可继续；重复不收敛时换控制几何或表示方法，不堆细节。经验用于判断，不逐条提交遵守证明。任务没有照片时核对任务条件，不制造图像前置。

**工作取舍**：验证服务于建筑判断，不让模型为流程本身工作；能由程序可靠完成的构造、对象定位和重复信息由工具承担，模型把时间留给来源理解、方法选择、几何构造和实际看图纠错。每次返回只突出会改变下一步的结果，完整记录留在项目证据中。

## 接入与策略

首次激活调用 `sketchup_runtime(action=startup)`，只读一次短指导；已有确定绑定和当前状态直接复用。多实例需要选择目标；实例或文档改变、结果未知时再确认。保护未保存工作，不反复启动SU。工具不可见时只查[接入说明](references/HOST-ENABLEMENT.md)。

调用 `sketchup_project_begin` 后，以保存策略和工具实际返回为准：

- **guided**：阅读[引导操作](references/guided-operation.md)，默认按 MCP 返回的当前阶段获得具体帮助；阶段是教学路线，不是形态质量证明。任务确实需要时可在一次受管操作中合并或省略不相关内容，仍保留事务、证据、真实读回和恢复保护。后续阶段发现上游缺项时，可按 `revise_from` 或当前返修入口回到对应阶段修改，只失效受影响的下游审核并保留已正确成果；不能用回退重做整栋。
- **autonomous**：阅读[专家操作](references/expert-operation.md)，把六阶段经验作为建筑判断地图，按当前系统自主合并、调整或省略不相关内容；可以连续组织构造和审核。需要检查时调用取证入口，默认得到来源/参考图和五个整体视图，再按疑点补局部，不让每笔写入都触发截图。事务、对象保护、真实读回和最终视觉判断仍然有效。旧项目保持其原策略，不静默改变历史写入语义。

## 构造、观察与纠错

使用当前绑定的Skill/MCP，不混读旧副本。已有生成器的文件直接提交；无匹配配方可用合法受管Ruby；基础构造需要时读取 `references/ruby-snippets.md`，古建屋面/转角/斗拱/支承链需要时读取 [古建构造模式](references/examples/ruby/ancient-construction-patterns.rb)，按当前问题取用，不全库加载。Ruby先落文件，以 `PipClawManagedBuild.build(entities,context)` 构造；毫米与SU内部英寸转换按[受管API](references/managed-ruby-api.md)处理。不得在脚本中保存/打开文档、改变内核或嵌套事务。

专家可直接使用[受管构造操作](references/scoped-operations.md)，程序维护单元、真实对象、回执和范围。不为包装现成工具重写相同Ruby，不复制ID/hash制作证明表。共享定义会影响真实兄弟实例；跨系统的共享修改应先确认范围，不能绕过保护。

看图后优先用 `visual_review` 提供结论、具体观察和实际查看的图片键或路径。机器附件、缺失原因、证据关联由程序组装；不得把图片已生成当作已经看过。来源/形态疑点查[来源解读](references/source-reading-diagnostics.md)或[轮廓核对](references/form-feature-review.md)；构造疑点查[装配](references/assembly-review.md)。涉及古建、楼阁、塔或古建照片时，优先读取 `references/chinese-tower-image-modeling.md`、`references/yellow-crane-tower-lessons.md` 及相关 REF；若有 `sketchup_ref`，按“楼阁”“屋顶”“斗拱”等短关键词分别匹配并只读当前问题章节。经验包用于选择构造和纠错，不是登记、数量或阶段门槛；暂时不可读时标记 `not_checked`，仍可用已有证据继续判断。`sketchup_ancient_tool` 的 `family=geometry` 才是可进入受管阶段的编译路线；`source/bearing/eave/measured` 只作诊断或校验，不能当成直接写入SU的结果。普通任务仍按需读取相关章节。

明确的用户尺寸可按[尺寸核对](references/source-dimensions.md)一次绑定，程序预检与实际测量；没有可靠目标不编造。需要局部图或叠图时查[图像辅助](references/reference-comparison.md)，不为每次任务加载。

执行成功、形态正确、实际看图通过、文件交付是不同结论。视觉结果明确返回 `visual_status=matched|mismatch|not_checked`：`mismatch` 用于返修，不要求补注册对象来“过门”；交付时如实带出 `mismatch` 或 `not_checked`。未知写入先查询原 `operation_id` 并恢复，不能换ID重放；已提交但取证失败只补证，不重建。真实缺陷通过授权修改修正，不让Agent手工清失败标记或重签历史。运行时不填写回执表、关闭表或审核覆盖矩阵。

## 交付

`finish` 根据当前成果审核并保存，只有返回 `finished` 且实际文件存在才报告交付。保留有意义的组件与参数、资源和必要视图；[材质与可编辑性](references/materials-editability-review.md)按任务检查。未做重开/实际编辑的维度明确未测；不追加用户未要求的固定渲染图数量。公共任意对象patch仍关闭，不以裸写绕过。

默认只汇报实际变化、关键观察、当前阻碍及必要下一步。完整日志、网格、历史留文件；共享经验和独立包版本复用，不全库重读。
