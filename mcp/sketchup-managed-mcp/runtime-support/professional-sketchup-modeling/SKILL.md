---
name: professional-sketchup-modeling
description: Use this skill whenever the user asks to create, build, edit, refine, inspect, or deliver a SketchUp/SU model or architecture scene. It provides managed MCP control, source-based geometry, spatial reasoning, visual review, recovery, and editable SKP delivery.
---

# ADAI SketchUp 建模（0.5.24）

依据用户资料创建或修改准确、可编辑的三维模型，持续推进到可核验交付。常规决策依据证据自主完成；关键目标或授权不明确时集中询问。

## 起手

使用当前绑定的本包 Skill 与 MCP，不混读旧副本；只确认一次实际来源，无法确认就如实说明。建模先调用 `sketchup_runtime(action=startup)`，只读取一次精炼短卡（版本、绑定实例、当前项目、下一步），再用 `status`、`ping` 和 model summary 核对进程、文档与项目；保护未保存工作，维护文档不启动 SU，不重复展开短卡。
同机多个 SketchUp 先 `instances`，再 `select_instance`；`AMBIGUOUS_INSTANCES`、`INSTANCE_CHANGED`、`INSTANCE_MISMATCH` 时重新选择，不重试原请求。打开模型用 `sketchup_open_model` 和绝对路径；未绑定程序只接受用户给出的快捷方式或绝对路径。

## 观察与构造

实际打开来源，区分事实、推导、假设和未知；先判定形制与结构依据，再动手。用已知构件、重复模数或图注推导关键比例，透视像素不能直接当尺寸。先平面边界、剖面、体量、开敞空间、表面连接和上下承接，再做构件与细节；不同层屋盖不默认缩放同一模型，控制线不代替实体，通用模板不代替用户资料。
写 Ruby 前读[受管 API](references/managed-ruby-api.md)和[最小示例](references/minimal-managed-example.md)，使用 `PipClawManagedBuild.build(entities,context)`，只写获准阶段；不在脚本中保存文件、切换文档或篡改状态。

Ruby 只承担当前阶段的实体构造：先建立所属 group/definition，再用真实面、曲线和变换生成主形；尺寸统一用 `.mm`，法向和闭合性在读回中核对。脚本返回简短结果和必要 `geometry_readback`，不以名称、计数或注释代替实体；已编译的 `ruby_file` 直接交给 `step`，不搬运或重写生成物。没有匹配配方时可用自定义受管 Ruby，但仍必须经过同一事务、读回、视图复核和 finish 门禁。可运行样例见[受管 Ruby 示例](references/examples/ruby/representative-and-batch.rb)。

## 执行与复核

按 MCP 当前阶段执行 `begin → step → 实际看图 → review → 下一阶段 → ready_to_finish → finish`；普通新建六阶段，古建按条件保留 `roof_profile`，局部修改沿用原路线。每步只说明改什么、依据和预期视图变化，然后执行。
主形、空间关系和连接通过后，先做完整开间或转角样板，局部和接缝通过才复制；检查首、中、末、对侧和转角。用户认可的主形和参数锁定，一轮只改一个问题及其最小范围；镜像用同一母型和中轴，保留回退点。
每轮实际看参考图及 geometry-whole-perspective/front/side/plan/underside 五视图，最多抓三个主要缺陷并比较是否改善。连续两轮无改善就回查形制、比例、拓扑、坐标或接口，改变方法而非原样重试；关键主形错误不能用细节掩盖。
保留真实读回、结构检查、对象保护和证据归属。工具成功、造型合格、视觉通过和交付完成分别判断；未知结果先查状态，不原样重放，`evidence_pending` 只 `retry_evidence`。读取源码只为修输入和阶段脚本，不修改引擎、门槛、签名或状态。

## 经验与交付

REF 按当前问题定向 list/match/read，冲突时选定包并记录版本；没有匹配经验也可自主构造，不降低验收标准。古建运行包 0.4.4、REF 1.4.0 随附；preset 不是来源实测，诊断入口不能绕过生产门禁。普通建模不触发“显源”流程。
只有 `finish` 返回 `finished`、实际 SKP 存在且最终证据已检查，才报告交付；说明文件、主要证据、假设、缺陷和未验证项，未重开则明确注明。`sketchup_project_patch` 正式入口关闭，直接调用应返回 `PATCH_NOT_RELEASED`。详细契约按需读取[几何守卫](references/geometry-guard.md)、[审查](references/managed-quality-review.md)和[恢复](references/managed-recovery.md)。

本次动作后只简短汇报实际执行、观察、阻碍和下一步，不制作运行时表单。
