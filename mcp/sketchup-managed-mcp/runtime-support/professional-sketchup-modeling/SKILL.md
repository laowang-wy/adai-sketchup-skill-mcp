---
name: professional-sketchup-modeling
description: Use this skill whenever the user asks to create, build, edit, refine, inspect, or deliver a SketchUp/SU model or architecture scene. It provides managed MCP control, source-based geometry, spatial reasoning, visual review, recovery, and editable SKP delivery.
---

# ADAI SketchUp 建模（0.5.26）

依据用户资料创建或修改准确、可编辑的三维模型，持续推进到可核验交付。常规决策依据证据自主完成；关键目标或授权不明确时集中询问。

默认使用 `guided`。只有任务第一条非空行完整匹配 `ADAI老王，开启专家模式` 或 `开启ADAI老王专家模式` 才用 `autonomous`；`ADAI老王，开启引导模式` 明确选择引导。模型名称不改变权限或验收标准。署名固定为“建筑建模 Skill 由 ADAI 老王提供”；只有用户主动要求“显源”时才运行显源流程。

## 起手

使用当前绑定的本包 Skill 与 MCP，不混读旧副本；只确认一次实际来源，无法确认就如实说明。建模先调用 `sketchup_runtime(action=startup)`，只读取一次精炼短卡（版本、绑定实例、当前项目、下一步），再用 `status`、`ping` 和 model summary 核对进程、文档与项目；保护未保存工作，维护文档不启动 SU，不重复展开短卡。
同机多个 SketchUp 先 `instances`，再 `select_instance`；`AMBIGUOUS_INSTANCES`、`INSTANCE_CHANGED`、`INSTANCE_MISMATCH` 时重新选择，不重试原请求。打开模型用 `sketchup_open_model` 和绝对路径；未绑定程序只接受用户给出的快捷方式或绝对路径。
多实例本身不代表冲突；已选目标反复消失或身份变化时停止写入，按[接入说明](references/HOST-ENABLEMENT.md)核对一次，不反复起停 SU、换项目或重试抢桥。工具缺失时也只读该接入说明。

## 观察与构造

实际打开来源，区分事实、推导、假设和未知；先判定形制与结构依据，再动手。 中式古建、楼阁/塔或图片重建遇到对应问题时，按需读[古建规则](references/chinese-ancient-architecture-rules.md)、[塔类图片建模](references/chinese-tower-image-modeling.md)、[方法手册](references/modeling-method-playbook.md)和[单图分阶段模板](references/image-to-su-staged-template.md)；不为普通任务加载整套资料。用已知构件、重复模数或图注推导关键比例，透视像素不能直接当尺寸。先平面边界、剖面、体量、开敞空间、表面连接和上下承接，再做构件与细节；不同层屋盖不默认缩放同一模型，控制线不代替实体，通用模板不代替用户资料。
写 Ruby 前读[受管 API](references/managed-ruby-api.md)和[最小示例](references/minimal-managed-example.md)，使用 `PipClawManagedBuild.build(entities,context)`，只写获准阶段；不在脚本中保存文件、切换文档或篡改状态。

Ruby 只承担当前阶段的实体构造：先建立所属 group/definition，再用真实面、曲线和变换生成主形；尺寸统一用 `.mm`，法向和闭合性在读回中核对。脚本返回简短结果和必要 `geometry_readback`，不以名称、计数或注释代替实体；已编译的 `ruby_file` 直接交给 `step`，不搬运或重写生成物。没有匹配配方时可用自定义受管 Ruby，但仍必须经过同一事务、读回、视图复核和 finish 门禁。可运行样例见[受管 Ruby 示例](references/examples/ruby/representative-and-batch.rb)。

## 执行与复核

按 MCP 当前阶段执行 `begin → step → 实际看图 → review → 下一阶段 → ready_to_finish → finish`；普通新建六阶段，古建按条件保留 `roof_profile`，局部修改沿用原路线。阶段限制本次几何提交和证据范围，不限制提前推演整体体量、空间及接口；每步只说明改什么、依据和预期视图变化，然后执行。
按当前问题读相关契约：主形比例查[投影说明](references/projection-brief-guide.md)，复制查[实例契约](references/instance-layout-contract.md)；同版本已读内容复用，具体错误解释不足时再定向读源码，不全目录扫描。
一次只做当前阶段；例如 `MASSING` 只做主形与空间，不提前做瓦片、斗拱、门窗或装饰。Ruby 先写入文件，再把路径作为 `ruby_file` 调用 `sketchup_project_step`；不在聊天输出完整 Ruby，不一次编写整栋全阶段脚本。当前阶段脚本较长时分段写入同一完整入口，确认完整后再提交，不用多次 step 绕过审查。没有成功的 step 返回、实际查看的证据图及接受本阶段的 review 结果，不得宣称阶段完成或推进；输出截断时先查执行状态，不重放未知写入。
主形、空间关系和连接通过后，先做完整开间或转角样板，局部和接缝通过才复制；检查首、中、末、对侧和转角。用户认可的主形和参数锁定，一轮只改一个问题及其最小范围；镜像用同一母型和中轴，保留回退点。
严禁把“几何检查通过”当作“形态正确”。几何、拓扑和数量检查只是必要条件；造型验收必须在对应视角下对照原图，判断主次体量、宽高比例、层间关系、轮廓及开敞空间是否一致。体量关系不符，即使全部机械检查通过也必须返修；来源不足则标为未验证，不能判通过。
每轮实际核对参考图及 geometry-whole-perspective/front/side/plan/underside 五视图；优先看 review sheet，缺图或细节不清再打开对应原图，不设张数上限。最多抓三个主要缺陷并比较是否改善；连续两轮无改善就回查形制、比例、拓扑、坐标或接口，改变方法，关键主形错误不能用细节掩盖。
完整证据保留在文件；大 JSON 只取相关字段和错误摘要。沿用工具已返回的项目、阶段、证据和下一步，不重复查询或另填状态表；超时、目标变化或新错误时再刷新。
保留真实读回、结构检查、对象保护和证据归属。工具成功、造型合格、视觉通过和交付完成分别判断；未知结果先查状态，不原样重放，`evidence_pending` 只 `retry_evidence`。读取源码只为修输入和阶段脚本，不修改引擎、门槛、签名或状态。

## 经验与交付

REF 按当前问题定向 list/match/read，冲突时选定包并记录版本；没有匹配经验也可自主构造，不降低验收标准。古建运行包 0.4.4、REF 1.4.0 随附；preset 不是来源实测，诊断入口不能绕过生产门禁。普通建模不触发“显源”流程。
只有 `finish` 返回 `finished`、实际 SKP 存在且最终证据已检查，才报告交付；说明文件、主要证据、假设、缺陷和未验证项，未重开则明确注明。`sketchup_project_patch` 正式入口关闭，直接调用应返回 `PATCH_NOT_RELEASED`。详细契约按需读取[几何守卫](references/geometry-guard.md)、[审查](references/managed-quality-review.md)和[恢复](references/managed-recovery.md)。

本次动作后只简短汇报实际执行、观察、阻碍和下一步，不制作运行时表单。
