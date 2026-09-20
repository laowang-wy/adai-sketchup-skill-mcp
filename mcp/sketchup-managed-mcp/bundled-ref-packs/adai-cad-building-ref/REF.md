---
id: adai-cad-building-ref
name: ADAI CAD 建筑建模经验
version: 0.1.0
state: unverified
topics: [cad, dxf, architectural-modeling, alignment, registration]
stages: [massing, archetypes, replication, variants, facade_detail, finish]
author: ADAI internal research candidate
scope: shared
notes: Offline candidate; dimensions without measured source evidence remain unknown or assumed.
---

# ADAI CAD 建筑建模经验包

本候选只提供按需知识卡和可选离线工具；它不改变受管事务、证据、审查或保存策略。没有 CAD 时可继续 freeform，但不得宣称 CAD 对齐通过。

## [massing] CAD 读图与最小范围
适用条件：有 ASCII DXF 或可读 CAD 来源，或追加任务需要确认既有主体与新增范围。
当前最小动作：先运行 CAD preflight，记录单位、坐标范围、实体类型、图层、块候选和依赖缺口；只把实测来源写成 measured，其余标 unknown/assumed 并注明依据。
如何检查：核对 source file hash、单位声明、实体/图层计数和能力缺口；简化解析必须明确未覆盖嵌套块、曲线等。
失败出口：文件不是 ASCII DXF、依赖缺失或关键坐标缺失时，保留诊断并回退到通用流程，不把 freeform 当 CAD 对齐。
来源/边界：离线候选自实现；朋友仓库只作为研究来源，不复制其代码、文案或资产。

## [archetypes] 注册、单位与锚点
适用条件：从 CAD 记录主轮廓、代表性墙段、门窗、柱梁、屋面或宿主连接。
当前最小动作：用 registration_check 明确单位换算、坐标/标高和不对称锚点；区分 measured、user_specified、assumed。
如何检查：拒绝非有限数、零轴、退化或矛盾变换；核对锚点不对称且变换可逆。
失败出口：缺少真实尺寸时只输出 unknown/assumed；不发明固定建筑尺寸，也不靠块名盲目共用定义。
来源/边界：只生成检查结果，不写入 SketchUp；真实几何需受管 Ruby step。

## [replication] 轴网与真实实例
适用条件：一个已检查的代表性构件需要依据轴网和定位复制。
当前最小动作：记录源构件 ID、定位变换、实际实例数、标高和首/中/末实例检查点；尺寸或截面不同的构件进入 variants。
如何检查：以真实 ComponentInstance 读回核对变换与数量；简单构件不能因固定面数门槛被拒绝，空组件和虚报实例必须失败。
失败出口：没有接受的原型或实例证据时停止复制，保留未验证状态。
来源/边界：复制不等于外观验收；本卡不新增顶层阶段。

## [variants] 尺寸、截面与位置差异
适用条件：门窗、墙段、柱梁、屋面或洞口因尺寸、截面、分格或位置条件不同。
当前最小动作：为每类真实差异保留独立变体记录，引用 CAD source IDs 和适用条件。
如何检查：对比不同规格的几何边界、变换、宿主连接和 CAD 来源；禁止仅按块名共享定义。
失败出口：差异来源不明时标 assumed/unknown，不把参数通过推广成任意建筑通过。
来源/边界：工具只做离线合同检查；几何质量和视觉质量分别验证。

## [facade_detail] CAD 与 SU 对齐取证
适用条件：需要比较 CAD 来源数据与 SketchUp 实体读回。
当前最小动作：记录 source IDs、来源哈希、单位、视向和容差；区分调用者声明、图像观察和真实 SU 读回。
如何检查：数值通过只证明该比较，不证明独立测量或最终交付；用同尺度、同方向、同剖面证据核对洞口、标高和轮廓。
失败出口：取证失败时按受管状态恢复；不能用 usage、握手、文件存在或工具列出冒充视觉检查。
来源/边界：alignment_check 不启动 SU、不保存模型、不替代 review/finish。

## [finish] 汇总证据与真实交付边界
适用条件：准备保存或提交候选前。
当前最小动作：汇总 CAD/真实 SU 证据、限制、未验证项和 finish 回执；只有受管 finish 成功才称真实交付。
如何检查：逐项核对六阶段，记录原生 SU、独立 stdio、模块测试和未运行项；合成小样只能称离线验证。
失败出口：没有 SketchUp 2019 或原生工具通道时写 not_run，交付本地候选而不是 production-ready。
来源/边界：本候选 production_ready=false，许可为内部研究候选、对外分发待权利人确认。