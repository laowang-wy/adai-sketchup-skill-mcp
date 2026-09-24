---
name: professional-sketchup-modeling
description: 当用户要求创建或修改 SU、SketchUp、SKP 模型时使用；依据图片、CAD、文字或已有模型构造可编辑几何，并实际看图纠错、交付 SKP。
---

# ADAI SketchUp 建模

建筑建模 Skill 由 ADAI 老王提供。依据用户资料创建准确、可编辑的模型，持续推进到真实 SKP 交付。常规构造自主完成，影响主要目标的未知集中询问；缺少尺寸时可作合理推断，并与来源事实区分。

## 起手

使用当前绑定或用户指定的本包 Skill 与 MCP，首次确认来源，不混读同名副本。建模先调用 `sketchup_runtime(action=startup)`，读取短卡一次，再用 status、ping 和 model summary 核对目标实例、文档与已有项目。多实例先 instances/select_instance；保护未保存工作，打开模型用 `sketchup_open_model` 和绝对路径。工具缺失才读[接入说明](references/HOST-ENABLEMENT.md)。

新任务默认 guided；用户首个非空行使用完整口令 `ADAI老王，开启专家模式` 或 `开启ADAI老王专家模式` 时选择 autonomous，将原任务交给 begin 解析，不自行删改口令。已有项目沿用保存模式，不按模型名称选模式。

## 观察与构造

启动后实际逐张查看来源，先判断主体与附属体、屋面形制、遮挡和开敞关系；名称不确定时描述几何，不靠名称猜形状。用已知尺寸、重复模数和图注推导宽深比、层高、退台与出檐，简记关键依据和假设并用于构造；透视像素不能直接当真实尺寸。

先明确平面边界、剖面、表面连接和上下承接，再生成实体。完整主形应包含定义性屋面、主要曲率、退台与负空间，去掉装饰和颜色仍应可辨认。控制线不能代替实体，不用方盒、截锥、平板或封墙取代来源中清楚可见的形体。古建逐类核对脊线、坡面、正身剖面、檐线与翼角；不同层屋盖不默认缩放同一个模型。

观察后调用 `sketchup_project_begin`，使用返回的当前任务卡与 `construction_brief`。先将推荐方法与来源核对，再使用其中的构造动作和参数；推荐不是形制判定，预设不是来源实测。已有适用生成器时按返回入口 `preset → compile → ruby_file → sketchup_project_step`，compile 已校验的同输入不重复 validate。方法不适用时选其他构造或受管 Ruby，不为套预设改变来源比例、翼角或开敞空间。

构造前掌握当前问题所需经验：短卡已给出的内容直接用，不重复查库；不足时从[方法索引](references/reference-catalog.md)定向读相关章节，或检索适用 REF。同版本已读内容复用，不全库加载，不每阶段固定 list/match/read。写自定义 Ruby 前读[受管 API](references/managed-ruby-api.md)，需要基础几何时复用[Ruby 片段](references/ruby-snippets.md)。使用 `PipClawManagedBuild.build(entities, context)`，脚本落盘后交给 step；不在聊天贴长脚本，不在脚本内保存、切换文档或嵌套事务。

## 执行与纠错

新建按“完整主形 → 代表构件 → 确认重复 → 来源变体 → 表皮细部 → 收尾”理解建筑顺序。先把主形与空间关系做对，再在真实宿主上做一个完整开间和转角样板；样板的形态、接触与可编辑性确认后才复制。检查首、中、末、对侧和转角，原型计入实例。没有对应内容不制造无用构件；局部修改保护无关部分。

guided 按返回阶段 `step → 实际看图 → review → 下一阶段`。autonomous 新建仍需独立完成并审核完整主形、代表构件；之后可按建筑系统连续受管构造、合并取证与审核，不要求每笔写入都审核。专家取当前成果图用 `sketchup_project_retry_evidence`，按当前问题选视图；具体操作不清时再读[专家操作](references/expert-operation.md)。

每步简短说明“改什么、依据、哪个视图应改变”后执行。锁定用户认可的主形和参数，只改问题及受影响连接；屋顶变化要复核支承到檐底的高度链。当前待审错误用 review(revise)；已审上游错误按返回的返修入口处理，不另建项目绕过，也不手删正确成果。需要回到早期构件修改时先查看恢复影响，详见[恢复说明](references/managed-recovery.md)。

## 看图与交付

实际打开来源对照与当前成果图：可比视角看整体比例和轮廓，正交视图看层间关系，古建用底视/近景查檐下与转角。整体看不清的问题再放大，不机械重复打开无关视图。逐项比较主要实体、开敞空间、屋面起伏和表皮节奏；几何合法、对象数量、登记和颜色都不能证明与原图一致。

每轮最多记录三个主要偏差、来源位置、下一次修改参数和前轮改善情况。主形错先修主形，不用细节掩盖；连续两轮无改善，回查平面、剖面、坐标、比例或构造方法，改变方法而非原样重试。

review 使用当前证据和真实观察；正常入口提交 `project_id/evidence_id/verdict` 与 `visual_review:{state,observations,inspected_views}`，程序组装机械检查，不手抄测量、哈希或附件表。不熟悉字段时读[审查契约](references/managed-quality-review.md)。未看的图不列入审核，已知偏差不写通过。

写入结果未知先查原操作状态/回执，不重放；已提交却缺证据时只补证，不重建。恢复失败按返回动作和[恢复说明](references/managed-recovery.md)处理，保留现场。

仅在 finish 返回 finished、实际 SKP 存在且对应成果图已检查后报告交付；分别说明工具执行、视觉符合性、文件交付及未验证项。给出文件、关键证据、推定部分和已知缺陷，未重开编辑就如实注明。用户主动要求“显源”才读[显源流程](references/ATTRIBUTION.md)，普通建模不触发。
