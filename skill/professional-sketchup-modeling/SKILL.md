---
name: professional-sketchup-modeling
description: Create, inspect, revise and deliver editable SketchUp architecture with managed tools, shared source interpretation, and guided or autonomous execution.
---

# ADAI SketchUp 建模

根据用户资料构造准确、可编辑的模型，持续推进到真实交付。默认 `guided`；只有任务第一条非空行完整匹配 **ADAI老王，开启专家模式** 或 **开启ADAI老王专家模式** 才选择 `autonomous`。`ADAI老王，开启引导模式` 选择引导。模型名称不决定权限或成果标准。署名为“建筑建模 Skill 由 ADAI 老王提供”；仅用户主动要求“显源”才运行显源流程。

## 共同专业底座

两种模式使用同一份[建筑专业经验](references/shared-architectural-foundation.md)：先理解来源身份、主体与翼楼、可见轮廓、负空间、尺度和基准，再选择构造方法。区分真实边界、阴影、反射和遮挡；照片像素不能直接当米数；面积与围护边界、绝对标高与分段高度不得混用。已给定可靠尺寸直接使用，资料不可见的部分可以在授权范围内合理推断并简短注明。

几何闭合、包围框或数量不证明建筑相符。重要主形错误先修依赖它的部分，其他合法工作可继续；重复不收敛时换控制几何或表示方法，不堆细节。经验用于判断，不逐条提交遵守证明。任务没有照片时核对任务条件，不制造图像前置。

## 接入与策略

首次激活调用 `sketchup_runtime(action=startup)`，只读一次短指导；已有确定绑定和当前状态直接复用。多实例需要选择目标；实例或文档改变、结果未知时再确认。保护未保存工作，不反复启动SU。工具不可见时只查[接入说明](references/HOST-ENABLEMENT.md)。

调用 `sketchup_project_begin` 后，以保存策略和工具实际返回为准：

- **guided**：阅读[引导操作](references/guided-operation.md)，沿当前阶段得到方法、样板及具体纠错。阶段指导不阻止提前推演整体空间与接口。
- **autonomous**：阅读[专家操作](references/expert-operation.md)。新项目按建筑系统组织连续操作，自选构造与看图节点，不套六阶段，不固定每笔五图。旧项目保持其原策略，不静默改变历史写入语义。

## 构造、观察与纠错

使用当前绑定的Skill/MCP，不混读旧副本。已有生成器的文件直接提交；无匹配配方可用合法受管Ruby。Ruby先落文件，以 `PipClawManagedBuild.build(entities,context)` 构造；毫米与SU内部英寸转换按[受管API](references/managed-ruby-api.md)处理。不得在脚本中保存/打开文档、改变内核或嵌套事务。

专家可直接使用[受管构造操作](references/scoped-operations.md)，程序维护单元、真实对象、回执和范围。不为包装现成工具重写相同Ruby，不复制ID/hash制作证明表。共享定义会影响真实兄弟实例；跨系统的共享修改应先确认范围，不能绕过保护。

看图后优先用 `visual_review` 提供结论、具体观察和实际查看的图片键或路径。机器附件、缺失原因、证据关联由程序组装；不得把图片已生成当作已经看过。来源/形态疑点查[来源解读](references/source-reading-diagnostics.md)或[轮廓核对](references/form-feature-review.md)；构造疑点查[装配](references/assembly-review.md)。只加载当前相关章节，古建REF与生成器按需使用。

明确的用户尺寸可按[尺寸核对](references/source-dimensions.md)一次绑定，程序预检与实际测量；没有可靠目标不编造。需要局部图或叠图时查[图像辅助](references/reference-comparison.md)，不为每次任务加载。

执行成功、形态正确、实际看图通过、文件交付是不同结论。未知写入先查询原 `operation_id` 并恢复，不能换ID重放；已提交但取证失败只补证，不重建。真实缺陷通过授权修改修正，不让Agent手工清失败标记或重签历史。运行时不填写回执表、关闭表或审核覆盖矩阵。

## 交付

`finish` 根据当前成果审核并保存，只有返回 `finished` 且实际文件存在才报告交付。保留有意义的组件与参数、资源和必要视图；[材质与可编辑性](references/materials-editability-review.md)按任务检查。未做重开/实际编辑的维度明确未测；不追加用户未要求的固定渲染图数量。公共任意对象patch仍关闭，不以裸写绕过。

默认只汇报实际变化、关键观察、当前阻碍及必要下一步。完整日志、网格、历史留文件；共享经验和独立包版本复用，不全库重读。
