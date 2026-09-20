---
id: adai-ancient-architecture
name: ADAI 中式古建建模经验（老王）
version: 1.3.0
state: unverified
topics: [古建, 中式楼阁, 塔, 庙, 殿, 斗拱, 曲檐, 翼角, 屋顶]
stages: [massing, roof_profile, archetypes, replication, variants, facade_detail, finish]
scope: shared
author: 老王
publisher: ADAI
attribution: 本古建 SketchUp 建模经验包由老王开发，ADAI 整理与发布
---

# ADAI 中式古建建模经验

**开发者：老王**  
**整理与发布：ADAI**

本包是面向公开分发的脱敏文字经验包，不包含原始商业 SKP、用户图片、历史本机路径或可直接执行的旧项目脚本。当前状态为 `unverified`：内容来自历史建模与纠错记录，但不能替代当前任务的参考图判断、真实 SketchUp 读回和阶段审查。

使用时由 `sketchup_ref.match` 按主题和阶段选择，再用 `read` 分节读取。历史尺寸、面数和构造只是案例证据，不得直接套用到新项目。

## [massing|roof_profile|archetypes|replication] 古建0.4模块调用

由老王开发，ADAI整理。一个古建总包，12张卡按需读取，7份配方分别校验。知识入口sketchup_ref；工具入口sketchup_toolkit(toolkit_id=ancient-architecture)或兼容sketchup_ancient_tool。list → read当前卡 → preset → validate → compile；一次只读取1—2张卡。
family=roof为六类参数屋面；source为5个保留源比例样板；bearing为柱斗拱梁承托诊断；eave为完整檐口诊断；recipe仅用于preset读取已登记配方，再按返回参数schema选择source或roof。
编译只生成受管诊断Ruby。用返回execution_contract的test/massing及项目前缀执行，实际SU读回与看图后才能复用，不直接称为最终建筑。
所有生成器分别维护参数范围、离线结果、SU记录和外观状态；一种通过不推广至其他类型、参数或版本。上游歇山detailed样板记录封山、六交点与四翼角切瓦；盔顶为带来源推定的候选，非实测还原；完整檐口135点来自A轮，B轮平滑取证未完成。新集成版本尚无SU实机验收。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 roof-routing 屋顶类型与路线选择

TRIGGER: 需要新建或修改古建屋顶时

ACTION: 先判断需要源样板保真复用，还是改变比例的通用屋壳。源样板使用 source_template_tool.py；通用屋面使用 roof_tool.py。

RULES: 源歇山只接受等比缩放，不能用 width 之外的字段强行改造。；六类名称代表算法入口；不代表岳阳楼或历史形制验收。；只有双坡剖面证据时，不外推为歇山、庑殿或盔顶。

CHECK: 确定正脊、山面、翼角与檐线是否符合当前来源。；先检查屋壳，再启用ridge、tile_sample、tiled；歇山/盔顶可调用detailed配方。

REJECT: 源样板和通用算法混用却未记录来源；用铺瓦遮掩主形缺陷

EVIDENCE: read card_id=roof-routing 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 xieshan-source 源歇山：正身、山面和翼角

TRIGGER: 用户要求廊架古建中央楼阁式歇山

ACTION: 使用 corridor-xieshan 还原已提取组件网络。源正身瓦带沿主坡平行排列，转角采用独立构件。

RULES: 保留长正脊、上部山面、侧坡和翼角的不同区域。；从 G0366 复用整体；源瓦带 C0029/C0030 不能直接声称为施工级单瓦。；本样板包含源脊饰与檐下结构；通用生成器不因此获得这些细节能力。；0.3另有通用歇山分区改进：中央平行、翼角收分，仍非源样板自由变形或最终历史还原。

CHECK: 实际查看透视、山面和檐下。；核对瓦列方向与山面交接，不仅统计面数。

REJECT: 将全宽瓦列汇聚到短正脊；把小双坡放到巨大四坡裙上并直接认可

EVIDENCE: read card_id=xieshan-source 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 dougong-families 斗拱构件与正身/转角区别

TRIGGER: 需要斗拱样板或檐下重复构件时

ACTION: 先选择有来源的家族。corridor-straight 与 corridor-corner 是不同拓扑；changkong-cross 与 changkong-layered 是另一个模型的中性描述。

RULES: 不要仅旋转正身件来制造转角。；不要只重复斗块或沿 Z 堆相同横臂来假装多层出跳。；改变层数、斜向角度和宿主结构仍需另行研究，当前合同拒绝这些字段。

CHECK: 查看正面、侧面、底部承托及转角斜向支路。；同类重复件保留共享定义；局部变体先独立定义。

REJECT: 凭通用组件名称认定历史制式；以颜色或面数代替构件关系

EVIDENCE: read card_id=dougong-families 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 placement-array 斗拱放置、旋转与阵列

TRIGGER: 样板要移动、转向或等距排列时

ACTION: 先编译 placement_contract，逐件比对世界坐标真实几何范围；阵列只开放 corridor-straight。

RULES: origin_mm 为 XY 几何包围中心与最低 Z，不是自动识别的柱头承托中心。；width_mm 是整体 X 宽；Y 和 Z 保持源比例。；阵列从第一个实例沿局部 X 排列，整体再绕 Z 旋转。；数值实例检查不能证明柱头接触、木构承载或结构安全。

CHECK: 首、中、末实例检查间距、方向与是否共享定义。；已安装构件另查真实承托面与实际缝隙；缺证据记 unverified。

REJECT: 把源定义局部巨幅坐标直接当实物尺寸；整体先旋转后沿世界 X 平移导致阵列走错方向；以 AABB 相交当作承托成立

EVIDENCE: read card_id=placement-array 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 curved-profiles 连续曲坡与共享边界

TRIGGER: 屋面呈帐篷形、断肩或剖面变化不连续时

ACTION: 先核对剖面站点、轴向与共享边界。王府样本给出多站剖面，通用歇山修正版通过共享连续剖面改善肩部。

RULES: 检查端点、中点及肩部切向变化。；坡面、脊线、檐线相关参数使用同一来源。；源双坡放样工具不包含四坡、歇山翼角或盔顶拓扑。

CHECK: 正视和侧视检查曲坡轮廓。；改变跨度/升高后，重查肩部、瓦面、脊件依赖。

REJECT: 8 点环带向中心汇聚造成帐篷顶；轴向读错而提取到恒定高度；将闭合测试当作形似证明

EVIDENCE: read card_id=curved-profiles 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 detail-sequence 古建细节的制作顺序

TRIGGER: 从屋壳深化到可近看的檐口时

ACTION: 依当前来源逐项组织屋面基层、椽望、瓦面、翼角、斗拱承托及独立脊饰；先做一件可检查原型。

RULES: 源样板含某细节不等于通用生成算法已实现它。；detailed歇山四翼角已有固定宽裁切，其他收分面与滴水勾头仍未实现完整传统施工细节。；只制作当前来源和视距要求的构件，先解决轮廓与连接。

CHECK: 屋壳通过再看单列瓦搭接，之后才全铺。；原型查看上面、下面和边缘，再实例复制。

REJECT: 用一块黑平面充屋面；脱离宿主的瓦片展示板冒充成品；为追求面数提前重复错误细节

EVIDENCE: read card_id=detail-sequence 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 skp-transfer 源 SKP 层级与几何保真

TRIGGER: 读取素材库并内化成可编辑工具时

ACTION: 源文件只读，绑定哈希；提取定义网络、内孔和全部实例变换，逐定义复用重建。

RULES: 使用 MeshHelper 三角化保留孔洞；外环派生图只作分析。；局部定义先定心，父级变换一次作用，旋转缩放不可遗漏。；明确未传递的材质 UV、游离线和历史构造未知。

CHECK: 读取前后源 SHA256 一致。；逐顶点检查重建坐标与来源位置。；每个定义保留面数、清理记录和 live triangle 断言。

REJECT: 把素材文件夹误认为模型工程目录；漏掉内孔；合成变换两次；把作者简化几何称为实物测绘

EVIDENCE: read card_id=skp-transfer 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 su-recovery SU 小面精度、取证与失败恢复

TRIGGER: 导入报索引、丢面、尺寸或超时错误时

ACTION: 用已内化的确定性处理排查；长任务只提交一次，等待明确回执与状态核对。

RULES: PolygonMesh 使用 add_point 返回编号。；小面在放大局部坐标建成后整体等比恢复，记录近共线碎片处理。；检查实际顶点几何范围；嵌套实例 AABB 只作参考。；超时并不代表未生成；先检查原请求及迟到回执。

CHECK: 看真实 SU 图证，白图或被遮挡图不能验收。；保留用户现有文档，诊断检查点不是最终干净 SKP。

REJECT: 超时盲目重放；删除断言以掩盖丢面；编辑受管状态冒充成功；将生成脚本称为成品 SKP

EVIDENCE: read card_id=su-recovery 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 bearing-contacts 柱头—斗拱—檐梁实际承托面

TRIGGER: 将独立斗拱放到柱头或连接檐梁时

ACTION: 先运行 bearing_tool.py inspect，确认源几何具有可识别承托面，再生成仅用于接触验证的柱—斗拱—梁样段。

RULES: 底座中心从源底部平面测得，不等于整个斗拱包围盒中心。；当前仅识别由两片三角面组成的极值水平矩形垫面；其他面型明确拒绝，不自动猜承托点。；柱和檐梁是演示宿主，尺寸按测得垫面与明确输入推导，不声称复原源建筑木构。；面积范围与逐点接触是几何证据，不是结构安全或历史制式认证。

CHECK: 每个指定垫面采用9个内点，分别从真实SU柱/斗拱/梁表面计算高度差。；只接受两侧都有真实面覆盖且高度差不超过0.03mm的采样。；看侧面和底座近景；自动拒绝不能明确识别的源面。

REJECT: 仅用整体包围盒中心放柱；只有AABB重叠就声称接触；借自动装配掩盖未知的构件做法

EVIDENCE: read card_id=bearing-contacts 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 xieshan-closures 歇山封山、脊交汇和翼角切瓦

TRIGGER: 通用歇山需要补齐山面和翼角收口

ACTION: 复用 experience/recipes/xieshan-detailed.json；validate 后 compile；受管 ARK4_ 单体诊断。

RULES: detailed 加入山面封板、曲边封檐、底枋、竖条和六个脊接头。；四翼角按毫米瓦宽排列，在斜脊边界裁切；切边封闭8mm厚度。；接头为闭合搭接件，山面为素面推定做法。；端裙坡仍使用原有收分瓦域。

CHECK: 看两侧山面、翼角俯视近景和脊端。；所有新封饰和切瓦必须闭合，SU再次检查。；切瓦保留名义宽，顶点不越斜脊裁剪线。

REJECT: 将 detailed 用到未支持类型；把素面件称为历史雕刻复原；删除退化面或闭合断言

EVIDENCE: read card_id=xieshan-closures 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 full-eave 柱斗拱梁—椽—望板—屋面连接样段

TRIGGER: 将已测承托面扩展为完整檐口层次

ACTION: python eave_tool.py --width-mm 1200 --output work/eave；受管 ARKS_Eave 前缀诊断。

RULES: 仅长空阁 layered 源斗拱，宽900—1800mm；柱高1800、梁高180固定。；五根椽共享剖面站点；缺口平面接触梁顶，外肩5mm斜切。；望板下表面复用椽顶站点；望板25mm，屋面基层50mm。；单梁悬挑样段仅用于接触和层次诊断。；135点证据来自A轮；B轮仅瓦片边线平滑，取证超时，禁止称B轮已签名通过。

CHECK: 柱斗拱、斗拱梁、梁椽、椽望板、望板基层共15组135个真实 SU 面采样点。；每侧均有真实面覆盖，误差限制0.03mm。；查看侧面和檐下，不以包围盒代替接触。

REJECT: 未经研究自动转成转角样板；要求任意斗拱自动套接；将样点通过声称为结构验算

EVIDENCE: read card_id=full-eave 获取相对记录；历史验证范围不自动覆盖新参数。

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建经验卡 helmet-provenance 盔顶来源约束、连续剖面与六珠宝顶

TRIGGER: 生成带来源约束的盔顶候选

ACTION: 复用 experience/recipes/helmet-source-informed.json；先读 study/helmet-source/profile.json 和 sources.json。

RULES: 照片观察、公开尺寸与推定曲线分开记录。；八个归一化站点使用单调 C1 插值；四脊共享母线。；六珠数量有文字来源；珠径、剖面和翼角参数明确推定。；近照裁切，尚无已确认的当地盔顶源SKP。；冠顶邻近宝顶的小片露壳区尚未补特殊裁瓦，验收范围为来源深化与可重复候选。

CHECK: 检查站点、端点、连续性与单调性，检查四脊六珠。；看SU正面、侧面和整体，不以面数认可风格。；修改 profile.json 必须重审来源并更新哈希。

REJECT: 把原文4.51m模糊基准当作实测檐脊高；将不明类型SKP充当盔顶来源；将推定候选宣传为精确复原

EVIDENCE: read card_id=helmet-provenance 获取相对记录；历史验证范围不自动覆盖新参数。

## [archetypes|roof_profile] 细部与檐口样板

> 本节经验由老王开发，ADAI 整理与发布。公开包不包含原始商业模型、用户截图或本机证据路径。

### Ancient Detail Decomposition From Visual Samples
Read before building an isolated Chinese-ancient eave/bay hero sample. It defines the visible six-layer target and the minimum close-view acceptance.


This decomposition comes from the historical detail study; apply only the systems supported by the current reference and delivery view. It is based on the readable close facade sample `targeted-004` and the courtyard/academy samples `targeted-003`, `targeted-008`, and `targeted-013`.

#### Six-layer eave sample

1. **Roof substrate**: a real sloped surface with a section that meets the wall and purlin; never a detached black plane.
2. **Rafter field**: short rafters terminate at the eave board and meet the purlin/ridge direction; no member may cross the ridge or float beyond the eave.
3. **Tile field**: individual or small grouped tile profiles overlap in the slope direction; the visible lower edge has a drip tile/nose rhythm, while the ridge has separate ridge tile closure.
4. **Eave curve and wing corner**: the eave line rises at the corner. The corner is a separate transition module, not a square roof-plane intersection.
5. **Dougong and painted timber**: column head -> bearing block -> layered arm -> nose/tail -> eave beam seat. Color bands and fascia are separate shallow members.
6. **Threshold/facade**: stone base and steps -> frame depth -> lattice/partition -> door leaf and threshold. Flat dark rectangles fail the sample.

#### Source-matched sample acceptance

For a source requiring the six-layer assembly, inspect those layers in close perspective and section. Other sources require their actual visible systems, not invented layers. Use bounding-box overlap only as a broad screening test: it does not prove contact. Check transformed surfaces/connection endpoints and their gaps at the intended scale, inspect a section and close perspective, and reject penetration or floating parts. Only after it passes may the sample be converted into components and repeated across the hall.

#### Rejection record

The historical study's roof ribs and the separate tile display board were rejected. They increased entity counts but did not reproduce the visual construction language of the source models. This record prevents treating semantic names or component counts as a substitute for visual fidelity.

#### Straight bay and corner are separate prototypes

Read `chinese-tower-image-modeling.md` and inspect the installed straight/corner bracket diagrams before selecting a family. A corner may need diagonal and multi-directional arms; rotating an ordinary bracket alone is not proof of a valid corner. The six-layer hero sample applies where the reference and close-view delivery require those elements; do not add unsupported bracket systems to every traditional building.

## [massing|roof_profile|archetypes|replication|variants|facade_detail|finish] 古建建模门禁

> 本节经验由老王开发，ADAI 整理与发布。公开包不包含原始商业模型、用户截图或本机证据路径。

### Ancient Architecture Gates — Distilled

Read when: the route is Chinese ancient architecture, Minnan reconstruction, dougong/bracket work, roof tile fields, ridge/eave detail. Apply source-relevant geometry checks within the current managed phase. Fixed host names, dimensions and historical forms are specimen-specific. MCP owns transactions, capture, rollback and save.

This is the distilled gate list from the 2026-08-09 Minnan rebuild (V9–V56). The full per-version evidence log is archived at ancient-gates.v9-v56-full.md（历史归档未随公开包分发）. For the earlier dougong/eave study (V2–V177), read chinese-ancient-regression-findings.md（来源条目：`chinese-ancient-regression-findings.md`；相关规则已提炼进本 REF）; core rules live in chinese-ancient-architecture-rules.md（来源条目：`chinese-ancient-architecture-rules.md`；相关规则已提炼进本 REF）.

#### 1. Reconstruction Transfer Principles

- Treat an ancient reference as an **assembly graph**, not a name dictionary: platform/stairs → bay/column datum → infill/openings → beam/purlin chain → lower eave → main roof shell → tile courses → ridge/hip ornaments → corridors/site. Each phase stays an independently inspectable group.
- Separate the architectural subject bounds from site/terrain/helper bounds before any visual comparison; `zoom_extents` output alone is never evidence (a huge terrain or zero-depth helper corrupts framing).
- Every roof shell must contain top, soffit, fascia, ridge closure, and both end closures. A roof continuous from one perspective but open at the rear/underside is rejected.
- Keep large sources read-only and prefer isolated parsing. Production geometry follows managed stages; never clear the source, start private transactions or directly save.

#### 2. Host Datum, Units, And Placement

- The SU2019 Ruby bridge may return internal **inches** while audits report **millimeters**. Convert once at the bridge boundary; never mix the two in one placement formula.
- Read the host entity's **world bounds / persistent ID** from the active model and derive new coordinates in one unit system. Never infer a world position from a definition's local bounds.
- Symmetric members (left/right ridge ends, gable trims): derive each side from measured host endpoints and verify independently. Symmetry is a result to verify, not a placement assumption — never reuse one sign-flipped transform for both halves.
- A visually correct independent group beats a component with wrong slope/bounds. Reuse is a fidelity goal, not permission to damage topology.

#### 3. Hero-Node Promotion And Propagation

- Every repeated system starts with **one host-calibrated hero node**, never a full array. Derive its envelope from existing host bounds (column head / eave seat / bay opening); if it penetrates the host, diagnose placement, section and host clearance before propagation; do not distort a rigid bracket by automatic rescaling.
- For complex eave/bracket nodes inspect perspective, strict front/side, plan and underside where needed to resolve orientation and bearing. Reuse existing adequate evidence; a simple part needs only views that answer its actual risks. Check host contact and load path, then inspect affected first/middle/last instances and overall integration after propagation. Detached rows require rejection; only MCP performs supported rollback/revision.
- Propagate by measured bay/column offsets with a small numeric tolerance; never compare transformed mm coordinates by exact float equality. Derive front and rear transforms from their actual host axes. Source-supported symmetry may use a verified mirror; inspect full parent transforms, handedness and asymmetric connections on both sides.
- Separate samples and arrays in phase-owned containers. Reject through managed review; do not manually delete phases or reopen over unsaved work.
- Independent analysis may continue, but an unresolved node cannot proceed past the current phase gate or justify propagation.

#### 4. Tile Fields, Ridges, And Drip Courses

- A tile field starts from one real closed barrel profile: curved section, explicit thickness, front+back materials, local frame (X across tile, Y along measured slope, Z = roof normal). Derive every instance from the host roof equation or shared eave/ridge stations. A world-horizontal tile grid over a sloped shell, or a flat dark material faking tiles, is rejected.
- Validate one **central patch** (perspective, strict side/section, plan, front/rear, underside) before full-width propagation. Propagation must terminate inside both gable boundaries and below the ridge closure.
- **Hip roofs**: audit each face separately (front/rear slope, left/right hip, ridge, terminals). Hip-end tiles come from the actual triangular face equation — row length shrinks toward the endpoint, every segment stays inside the host triangle.
- **Ridge closure**: short repeated barrel-profile components from the actual ridge guide; keep definitions shallow (direct faces/edges, no nested groups). Terminal caps sit at actual ridge endpoints, inset slightly into the last tile member. A cap outside the host ridge is a floating ornament.
- **Drip course**: short repeated members from the measured eave control line, overlapping the host datum in section, terminating within the roof boundary. A continuous rectangular eave plate is not a substitute.
- Inspect actual existing tile placements before adding a field. Duplicated accepted tiles fail; use managed correction rather than manual deletion/reopen or stacking.
- Ordinary tiles, drip course, hip tiles, and ridge tiles are **separate semantic systems**; a complete front slope proves nothing about hip coverage or ridge closure.
- Wing/side-hall roofs are local systems: derive each wing's tiles, ridge, eave, terminals from **that wing's own stations and slope direction** (nested side roofs often use mirrored local sections and parent transforms). Never copy courses along the main axis.
- If a complete tile field is hidden by a redundant roof skin, isolate field and skin separately — a tile-only view distinguishes an occlusion problem from a missing-tile problem.

#### 5. Rafters And Corner-Rafter Fans

- Rafters terminate on the measured roof section or at a visible eave-tail zone. An eave-to-ridge member can pass bounds tests yet project through the tile field — validate roof-equation contact in strict side and underside.
- A corner fan is defined by **two shared guides**, not individually placed beams: all roots on one measured wall/eave bearing line, all outer ends on one measured curved fascia guide. Derive each rafter endpoint from the same station parameter on both guides.
- **Guide pairing**: station *i* on the bearing line pairs with station *i* on the outer curve. Validate pairing in plan (non-crossing, monotone centerlines) before adding thickness; reversed or mixed-coordinate guides create crossing rafters.
- **Degenerate station guard**: when a station tangent is parallel to the up vector, the cross product degenerates — detect it and pick a deterministic fallback axis; never `normalize!` an unchecked cross product. Test first/middle/last station frames before building the full fan.
- Project every root and tip onto the actual roof substrate section at its station. The **underside view is a hard gate**: continuous bearing at eave/purlin, every rafter below the substrate.

#### 6. Ridge-End Terminals And Ornament (吻兽)

- Place ridge-end closures from the actual host cap **world bounds / persistent ID** (`Hip_End_Cap` was the specimen name), not a generic roof centerline or mirrored definition-local bounds. Base overlaps the host cap by a measured small amount; crown stays within the roof closure envelope.
- Improve a passed structural terminal with a closed local profile (broad base, restrained waist, smaller crown), **replacing** the simplified sample inside an isolated reversible phase — never stack a new finial over the old one.
- A terminal passing contact/boundary/four-view gates is still only a structural baseline. Do not label it a complete 吻兽 until source-calibrated silhouette and ornament grammar are present; source name + bounds calibrate scale and repetition only, never form.
- Reject failed terminals through managed review, preserving evidence; never stack successive guesses over rejected bodies.

#### 7. Envelope Details (Corridors, Side Halls, Lattice)

- Side corridors must expose an independent load path under the low roof: wall/column datum → purlin → repeated short rafters → fascia/eave. A wall plus a roof shell is not enough; the underside view proves it, a distant perspective cannot. Do not recreate a global rectangular roof plate just to support corridor rafters.
- Side-hall openings need depth: lattice bays between existing column datums, real frame thickness, sill/window-seat, separate stone thresholds; column feet terminate on distinct stone plinths.
- Lattice decoration is **embedded in the host frame depth**, sharing a measured host plane within jamb/column boundaries — never an exterior diagonal overlay pasted ahead of the sash. Propagate only along the host bay axis at measured clear-opening intervals; if any instance envelope enters a pier/wall/sill, roll back the whole propagation phase.
- Fix face orientation and assign front+back materials before visual acceptance; diagnostic back-face colors are geometry evidence.
- Glass-dominated facades stay modern-looking no matter how many frames you add — shift the reading with host-embedded lattice, threshold depth, and continuous eave-band rhythm while preserving the structural bay grid.

#### 8. Material And Texture Honesty

- Source texture statistics are calibration evidence, not permission to invent texture paths. Resolve each texture against the registered library; if unavailable, keep the semantic material role and report the texture gap separately. Geometry validation and material validation are separate gates.
- Scope material repair spatially and semantically (e.g. repair only the known roof/timber systems with missing materials) — never recolor the whole model from a color heuristic. Legitimate materials (cyan glass) must survive.

#### 9. SketchUp 2019 Execution Hygiene

- `Sketchup::ComponentDefinition` has no `add_group` — use `definition.entities.add_group`. Check empty definitions with `definition.entities.length == 0`, not `empty?` on `Sketchup::Entities`.
- No implicit `Point3d + Vector3d * scalar` coercion in generated scripts — construct coordinates explicitly or use `Point3d#offset` with a validated vector; test one member before opening the array transaction.
- After Ruby errors, reconcile original request, binding and confirmed rollback before retry. Do not manually clean a phase or infer rollback from an exception.
- A timeout is unknown outcome: inspect original request/process and project state, preserve unsaved work and follow managed-recovery.md. Never force-close a dirty model to recover.
- Generate freeform geometry only under supplied phase entities or owned definitions. Verify intended host/phase; raw-write tools are not production entry points.
- When auditing nested groups, accumulate each parent transform exactly once; multiplying an entity transform onto bounds already in parent coordinates creates false host coordinates.
- Avoid ambiguous array literals in numeric loops; use explicit scalar assignments and inspect generated scripts before execution. Use tested helpers inside managed build scope; tool availability does not change lifecycle restrictions.
- Inspect obsolete geometry before delivery. Names alone do not authorize deletion; only current phase-owned cleanup is permitted. Disclose retained external/old roots.

#### 10. Formal Delivery

- Finish through sketchup_project_finish; verify file/final evidence and arrange safe supported reopen. Unavailable reopen remains unverified, and bytes/path agreement do not prove quality.
- Save acceptance has two independent gates: the SketchUp response succeeds **and** the target `.skp` is nonzero with exact-path readback. A changed window title or zero-byte file is not evidence.
- Report technical readback, visual fidelity, and source-density fidelity as separate statuses.

## [massing|roof_profile|archetypes|replication|variants] 中式古建构造规则

> 本节经验由老王开发，ADAI 整理与发布。公开包不包含原始商业模型、用户截图或本机证据路径。

### Chinese Ancient Architecture Rules

Read for Chinese traditional buildings, courtyards, temples, academies, pavilions, ancestral halls, or new Chinese architecture that requires credible traditional construction.

#### Spatial Order
- Establish a north/south or project axis, entrance sequence, courtyard hierarchy, and primary view before ornament.
- Use a layered sequence: site wall/gate -> forecourt -> main courtyard -> covered transition -> principal hall or residential wings.
- Keep main hall, secondary wings, gate, service buildings, and landscape as independent groups; do not flatten the compound into one mass.
- Use symmetry for the main axis when the building type calls for it, and controlled asymmetry in secondary gardens, paths, planting, and service zones.

#### Structural Grammar
- Model the timber frame as a readable system: stone or brick台基, columns, beams, purlins, roof frame, and infill walls.
- Use bay spacing as the base module. Define column grid and depth first; derive doors, windows, brackets, and roof members from that module.
- Separate台基, 柱, 梁架, 屋面, 檐口, 门窗, 墙体, and landscape into named groups/tags.
- Repeated columns, brackets, rafters, tiles, lanterns, and window modules must use component definitions where practical.

#### Roof And Eaves
- Build roof curvature from a controlled profile and ridge/eave guide, not a flat extruded slab. For a visible upturned eave, define the end lift explicitly and sweep or loft the roof surface.
- Keep ridge, roof planes, ridge ornaments, eave members, rafters, tiles, gutters, and corner transitions separate so the roof can be corrected without rebuilding the hall.
- Verify roof pitch, eave depth, ridge height, corner lift, and drainage direction in section and perspective.
- Use tile courses or tile strips as repeated components; do not model thousands of unique tiles unless the close view requires it.

#### Facade And Detail
- Concentrate detail at thresholds and roof edges: bracket sets, door frames, lattice windows, stone steps, balustrades, eave boards, and lanterns.
- Do not paste decorative Chinese motifs onto a modern volume and call it ancient architecture. The bay grid, roof,台基, structure, and courtyard order must agree.
- Material logic should distinguish roof tile, painted/dark timber, white or earth wall, stone base, paving, and landscape water/planting.

#### Acceptance
- Main axis, courtyard proportions, bay grid, structural rhythm, roof section, eave treatment, and threshold sequence are inspectable.
- A close view validates one complete bay, one column/beam junction, one window/door module, one eave corner, and one roof tile/edge treatment.
- Repeated details are components and remain editable; no unexplained floating ornament or disconnected roof geometry.

#### Targeted Corpus Calibration

The targeted corpus repeatedly exposes separate systems named for roof tiles, roof boards, purlins, raised roof profile, rafters, beams, gables, courtyard walls, gates, ridge tiles, pavilions, and bracket sets. Use targeted-ancient-curved-study.md（来源条目：`targeted-ancient-curved-study.md`；相关规则已提炼进本 REF） for the evidence-backed build sequence and acceptance gate. Do not accept a model with only a massing box, a decorative roof plane, or floating brackets.

#### Quality Rejection Gate From Visual Regression

The historical regression rejected these model/tile simplifications. Apply the following failure checks where the source and requested close-view detail require the corresponding systems:

- Long rectangular ribs on a sloped plane are not roof tiles. A tile system must show tile profile, thickness, overlap, drip/eave termination, ridge closure, and believable contact in a close view.
- A single planar roof slab with dark material is not a finished roof. The section must expose roof base, purlin/rafter rhythm, tile bedding, tile courses, eave board, ridge and corner transition.
- A stack of rectangular blocks is not a dougong/bracket set. The bracket sample must show attached column head, bearing block, layered arms, nose/tail, eave beam seat and end contact.
- A facade with three repeated door rectangles is not a traditional elevation. It needs frame depth, threshold, lattice/partition logic, wall-to-column relation, and a readable bay rhythm.
- A distant whole-model screenshot cannot validate detail. Create a separate close preview of one eave corner and one complete bay before arraying.

#### Fine-Grained Ancient Modeling Protocol

1. Build a source-matched prototype within the current managed phase and inspect it separately and in its real host. Do not clear or switch an active document to obtain a clean test.
2. Build one 1:1 or explicitly scaled eave bay in section: column head, bracket, beam, rafter, roof base, one tile profile, overlapping tile row, eave/drip tile, and ridge/end closure.
3. Inspect in plan, section and close perspective. Reject any floating, penetrating or world-axis misaligned member.
4. Only after the sample passes, turn the tile, rafter and bracket into components and array them along the bay grid.
5. Keep experimental versions separate from the production file. A rejected sample must be recorded and must not be merged merely because the audit counts increased.
6. Judge visible construction completeness at the target viewing distance, not a minimum count of entities or small details. Preserve identifying silhouettes and required close-view contacts; select detail levels deliberately. Read `chinese-tower-image-modeling.md` for measured source costs and straight-bay versus corner prototypes.

#### Regression Evidence

The 2026-08-07 dougong/eave-corner/tile study produced versioned calibration findings (V2-V177). When iterating on an ancient detail hero node or recovering from a visual rejection, read chinese-ancient-regression-findings.md（来源条目：`chinese-ancient-regression-findings.md`；相关规则已提炼进本 REF）; apply their source-relevant failure mechanisms; historical specimen shapes, dimensions and view counts are not universal requirements.

#### 2026-09-06 measured tower study

Read `chinese-tower-image-modeling.md` before tower or image-reconstruction work. Its evidence and diagrams are installed with this Skill. Apply courtyard/axis requirements only when the reference building supports them; do not invent a compound around a single tower. Source-model appearance does not prove historical joinery or a finished tile system.

## [roof_profile|archetypes|replication|variants] 古建失败与修正规律

> 本节经验由老王开发，ADAI 整理与发布。公开包不包含原始商业模型、用户截图或本机证据路径。

### Chinese Ancient Regression Findings — Distilled Gates

Read when: iterating on a Chinese ancient detail hero node (dougong, eave corner, tile field, ridge terminal) or recovering from a visual rejection.

This is the distilled gate list from 46 versioned regression rounds (V2–V177, 2026-08-07). Each gate names the failure mechanism that created it. The full per-version evidence log is archived at chinese-ancient-regression-findings.v2-v177-full.md（历史归档未随公开包分发）; consult it when you need the exact rejected/accepted version history. Core rules live in chinese-ancient-architecture-rules.md（来源条目：`chinese-ancient-architecture-rules.md`；相关规则已提炼进本 REF）; the later Minnan rebuild gates live in ancient-gates.md（来源条目：`ancient-gates.md`；相关规则已提炼进本 REF）.

Accepted baselines referenced below: **V14** tile section grammar · **V28/V30** single-jump contact chain · **V70/V71** tile contact/overlap microtests · **V72** isolated roof unit · **V79** profiled single-jump dougong · **V80** orthogonal corner topology · **V149** native Y-Z section microtest · **V176** corner rafter-fan topology.

#### Current execution boundary

These are historical shape regressions. All production creation, visibility changes, evidence capture and saving must follow the current managed phase/API. Never execute archived export/clear/save snippets directly. Numeric sizes and topology below describe their source specimens; other buildings require source-calibrated dimensions and connections.

#### 1. Visual Evidence Gates (select for the actual node)

- For complex brackets/eave interfaces, inspect **front, strict side, plan, underside, perspective** as needed to reveal shape and contacts; reuse sufficient existing views and do not force five redundant captures for simple objects. Transparency/X-Ray, entity counts, successful Ruby returns, and saved SKP files are not evidence (V2, V19-V24).
- Blank, clipped, camera-missed, or slab-dominated PNGs are **failed evidence** even when the geometry audit passes (V67-V68).
- Frame an isolated owned prototype through managed evidence; unrelated objects must not obscure the sample. Preserve external/template/user objects. Do not delete them for a clean screenshot (V70-V71).
- Use a **neutral timber palette** for acceptance images. Strong red/green/white diagnostic colors make disconnected parts look falsely structured (V25-V26).
- A sample that passes in isolation must be **re-checked after insertion** into the bay: parent hierarchy, display style, face materials, and fascia can make correct geometry read as vertical boards (V14→V15).
- Before rejecting inserted geometry, export three views: detail-only, context-hidden, and final composite (V17-V20).
- Never repair a visual failure by moving the camera, adding filler plates, stacking more layers, or strengthening colors (V112, V132-V133).

#### 2. Dougong / Bracket Gates

- **Load path is a contact chain**: column head → root dou → profiled arm → intermediate dou → next arm → eave seat. A visible gap at any interface is a hard failure (V21-V24).
- **Same elevation is not contact; bounding-box overlap is not a bearing face.** Each interface needs a documented vertical bearing interval plus XY overlap, with the arm's horizontal **bearing shoulder extending into the next dou footprint** (V120-V126, V143-V148).
- **Stacked boxes and continuous extruded curved plates are not dougong.** Use short-member grammar: separate root bearing body + short arm + independent nose/terminal pieces. The bracket eye must be a bounded void between members, not a gap from misalignment (V2, V38-V55, V83-V84, V101).
- **Corner topology**: the historical orthogonal sample used X/Y arms sharing one root dou; reject unsupported disconnected branches. Do not prescribe this L-shaped form for all buildings: diagonal and multi-directional corners must follow the actual source (see chinese-tower-image-modeling.md).
- **One jump passes before a second jump exists.** No propagation to a production bay until the source-relevant node and host views pass (V25-V30).
- Scale anchors from source corpus: small repeated dou ≈ 60×60×20 mm and 40×50×35 mm. These are specimen-specific measurements, not rejection thresholds for other buildings; calibrate member proportions from the current source (V47-V50).
- Build the section **natively in the Y-Z plane with explicit horizontal bearing polygons**, then extrude across X. Do not position curved noses by approximate world coordinates (V138-V149).
- An orthogonal/transverse branch must share the main load-path datum; it must not create a second unsupported vertical chain (V150-V152).
- When a junction fails, **move the host members** to fix it — never add a bridging block or filler pad (V112-V116).

#### 3. Roof Tile And Substrate Gates

- The roof substrate is a continuous sloped/curved surface readable in perspective and section; rafters and tile instances cannot substitute for it (V2).
- Tile grammar (V14 baseline): X-Z curved barrel section extruded between exact slope guide stations, split into ~6 independent courses, with pan-tile valleys and a separate drip tile. The historical test used world-coordinate construction to debug placement. Production components may use local geometry and one verified host transform; do not ban valid rotated instances.
- **All roof layers derive from one shared station function**: eave station, ridge station, slope ratio, substrate thickness, rafter centerline, tile base, tile lift (V134-V135).
- Rafters are oriented prisms terminating below the eave board. A rafter crossing the tile bedding or continuing through the drip closure invalidates the field. **Never** approximate a diagonal member with a world-axis bounding box — it becomes a wall of vertical boards (V15-V17, V72).
- A tile field fails if: courses have no visible slope overlap, the eave tile-end face is unreadable, or drip/fascia closure is missing — even when each tile is individually grouped (V163-V164).
- Terminal tiles: edit/replace the existing tile definition at its real slope stations; do not overlay a second closure system on top (V65-V66).
- Roof support chain for composite integration: front wall/top plate → sloped lookout → eave purlin/roof base; wall-top bearing → mid purlin; rear column → ridge support (V172).

#### 4. Eave Corner Gates

- Substrate, fascia/drip, tile edge, and corner-rafter fan use **separate sections and guides**; sharing stations is allowed, sharing offsets and profiles is not (V173-V175).
- Build each short section in the **local corner tangent/normal frame** and triangulate the loft between stations. Copying one world-oriented terminal profile to every station produces a faceted cluster (V173).
- The historical fan test used ≥4 rafters and ≥5 guide stations. For new work choose member count and sampling from source rhythm and curvature; require explicit bearing, non-crossing plan directions and a shared controlled outer edge. Validate plan and underside before adding substrate or tiles (V175-V177).
- A passing straight eave proves nothing about the corner (V172-V173).
- Triangle-face fallback is an SU2019 geometry safeguard, never visual acceptance (V173).

#### 5. Integration And Datum Gates

- Local integration needs one explicit vertical datum chain: plinth → column shaft → column head → root dou → jumps → beam/eave seat. Do not place a low-origin detail inside a full-height column shaft (V92-V94).
- Derive column width, beam section, eave depth, and bracket projection from a **source-calibrated bay module** before inserting any detail; never shrink the detail against arbitrary context (V93-V94).
- Within the actual managed phases, verify prototype → host integration → transform/readback → managed evidence. A `Deleted Entity` error needs entity-lifetime and ownership diagnosis; it does not by itself identify a coordinate or sequencing cause. See entity lifetime（来源条目：`ruby-snippets.md`；相关规则已提炼进本 REF）.
- A mapped detail contacting the real column is still not accepted until the relevant visual and interface checks pass at the real datum (V97).

#### 6. Source Learning Boundary

- Three evidence classes: (a) whole-building visual density, (b) repeated member scale/material, (c) structural-node geometry. **Only (c) can calibrate a dougong hero node**; (a) and (b) constrain proportions but prove nothing about bracket grammar (V47-V50, Source Candidate Boundary).
- Layer names like `斗拱`/`檩条`/`瓦` in a source model are routing evidence, not proof that an anonymous component is a correct bracket (V47-V50).
- Anonymous wood components with complex geometry are not dougong unless visibly contextualized in the chain column head → dou → arm → dou → eave seat (Source Candidate Boundary).
- Inspect source components through the read-only corpus workflow. Any normalization or diagnostic assembly belongs in an authorized isolated copy and supported managed scope; never unhide or save the source directly. Check actual bounds/count and readable evidence; a blank preview cannot validate extraction.

#### 7. Script And Execution Hygiene

- Assert required group names exist before saving; copied scripts can silently omit members (V139-V142).
- A generated Ruby file containing literal `\n` text is a script-generation bug — discard the run, it is not a geometry result (V119).
- Historical V17–V20 used direct `active_view.write_image`; that execution method is superseded. Request evidence through managed MCP, validate the actual camera and returned close view, and use evidence retry on capture failure.

## [massing|roof_profile|archetypes|replication|variants] 中式楼阁图片建模流程

> 本节经验由老王开发，ADAI 整理与发布。公开包不包含原始商业模型、用户截图或本机证据路径。

### 长空阁 SKP 学习：中式楼阁的组件组织与图片建模流程

2026-09-06。用途：其他 Agent 在中式楼阁、古建图片重建、屋顶/斗拱原型与轻量化任务前必读。与 `chinese-ancient-architecture-rules.md`、`ancient-detail-decomposition.md` 配合；本报告中的案例数据不是通用设计尺寸或构造标准。

#### 证据与实际分析范围

The selected diagram inventory is routed through chinese-tower-case/README.md（来源条目：`chinese-tower-case/README.md`；相关规则已提炼进本 REF）; filenames map to audit enumeration keys and are not stable entity IDs.

来源：`历史只读样本库\68.2024 设计院事务所 最新 Sketchup 模型   中式\历史中式楼阁样本.skp`，99,713,495 字节。独立进程通过 SketchUp 2019 C API 只读加载，解析全部组件定义、实例层级、变换和面数；抽查屋顶、檐口、柱梁与斗拱的顶点几何。读取前后 SHA256 一致，详见同目录 `原始证据未随公开包分发`。没有切换当前 SketchUp 文档，也没有调用鼠标/前台截图。

同目录 `原始证据未随公开包分发` 是文件内嵌的小预览，构图裁切，不能据此确认完整层数。其余 PNG 是直接从源几何外环生成的研究图，不是 SketchUp 渲染：未处理面内孔、材质、纹理与真实遮挡精度，不可拿来证明接缝闭合或最终交付质量。

| 项目 | 实测/计算 |
|---|---:|
| 普通组件定义 / 群组定义 | 1,051 / 3 |
| 根层容器 / 最大嵌套深度 | 96 / 5 |
| 唯一存储面数（含未引用定义） | 337,023 |
| 根层可达唯一面数 | 326,699 |
| 沿根实例路径展开面数 | 1,653,318 |
| 未被根层引用的定义 | 11 |
| 材质 / 标签 / 场景 | 37 / 1 / 1 |
| 所有纹理基础 RGBA 估算 | 443.92 MiB |

展开面数包含隐藏对象，不是实际渲染面数或速度测试；RGBA 估算不是文件体积或实测显存。Cxxxx/Gxxxx 是这次枚举的审计编号，不是可长期查找的 SketchUp GUID。

#### 已确认、可复用的做法

##### 1. 楼阁用分层屋顶与框架组合，不套用住宅标准层复制

`C1021` 是上部屋顶组合：13 个直接子实例、展开 5,476 面，记录的根层包围盒约 46.49 × 46.49 × 18.82 m。`C1043` 是另一层屋顶组合：14 个子实例、展开 8,742 面，约 70.58 × 70.59 × 18.22 m。图见 `原始证据未随公开包分发`、`原始证据未随公开包分发`。

几何能看到曲坡、翘角、多个山面及脊端装饰。应先画脊线与坡面连接关系，再命名屋顶类型；此处不把全部屋顶强行定成某一个历史制式。两层是独立组合，子件数量和结构不同，不能仅把一个标准屋顶整体缩放后当作所有层。

这些尺寸是文件坐标换算，不是测绘值；不把约 98 m 的模型最高屋顶部标高当作真实建筑高度，也不把这份文件的比例硬编码进新项目。

##### 2. 主坡、檐口直段、翼角和装饰分开

`C0493`（82 面）和 `C0481`（80 面）分别各出现 4 次，研究图显示长条曲面带。角部 `C0853` 展开 152 面，由两种几何子件各 2 个组成，并有局部方向上的 1.1 缩放。上部屋顶 `C1021` 内，`C0475` 同一定义以四个正交方向布置。

可复用原则：一套参数驱动脊线、正身檐口及角点；正身曲面与角部过渡分开生成，共用边界点。先调侧剖面坡度和端部抬升，再调平面四角，随后补厚度和檐下。不要只抬矩形屋顶四角，或把几张斜平面拼成屋顶后用深色材质掩盖形体。

同面数/相似外形的四个方向构件不一定是同一定义；确认定义引用关系后才声称共享。源文件有不少独立的方向版本，新建时仅在几何、材质和连接确实等价时合并为共享定义。

##### 3. 斗拱是分层组合，转角要有独立原型

`C0786` 展开 1,092 面，研究图可见有曲线截面的拱臂、承托块与逐层连接；`C0797` 展开 3,120 面，具有多向/斜向的组合关系。见对应 PNG。`C0027` 是 154 面的基础拱臂/承托形构件，沿根路径出现 1,108 次，贡献 170,632 展开面。

可复用粒度：基础拱臂/斗形细件 → 一朵正身斗拱 → 柱头/梁架及一个完整开间；转角斗拱单独定义，不能只旋转正身斗拱冒充。不要以 1,092 或 3,120 面作为质量门槛，也不能以外形组合图声称已验证传统榫卯或结构承载。

普通开间复制前完成柱头、斗拱、梁座和檐下联系。相同轮廓细件通过定义实例共享；仅在材质、截面、连接方向真实改变时做变体。

##### 4. 局部坐标和实例尺度必须一起读

`C0113` 原始局部几何包围盒约 2526.71 × 14654.90 × 2463.36 m，但某直接父实例缩放约 0.000150789，并转向为竖向，父坐标包围盒约 0.381 × 0.37144 × 2.2098 m。上层还可能继续缩放。仅读定义就会把柱形小件误认为巨物。

算法：叶顶点 `p_local` 经 `T_root … T_parent T_instance` 转到目标坐标；定义尺寸、父坐标尺寸、世界尺寸分栏记录。检查线性变换行列式、非均匀缩放和镜像；镜像后检查面朝向、贴图方向与连接，不能仅调平移。新建原型尽量在合理局部尺寸、清晰原点和轴线下定义；已有文件的坐标归一化只能在授权工作副本里做，并验证世界位置不变。

#### 源模型的代价和不能照搬的部分

- `C0988` 是位于低标高环境组合中的密集薄网格，单定义 278,989 面、重复 4 次，贡献 1,115,956 面，占全场展开面数 **67.50%**。研究图只确认其薄片密集网格形态，未确认具体材质或用途，不能凭名字说它就是瓦或植被。
- 其父环境组合 `C1049` 每个展开 297,107 面，共 4 个。算术上排除这四个组合后剩 464,890 面；剩余仍含其他环境，不能把它称作纯建筑面数，也不能称作实测优化成果。
- 37 个材质中包含 8192×8192 纹理，仅此基础 RGBA 即 256 MiB。检查目标视距及材质真实用途后再决定降采样，不能把所有精细度问题都归因于古建斗拱。
- 只有 1 个标签，环境与建筑的显示控制不够细。新项目建议按“建筑层/屋顶/框架/斗拱/门窗栏杆/环境/细节级别”组织有意义的容器和标签，原始面线保持 Untagged。不要为了标签数量拆碎构件。
- 这次没有验证出可直接提取为合格近景原型的完整瓦片搭接系统。源屋面曲面带适合学习轮廓组织，不等于已具备近景瓦当、滴水、厚度和脊部收口。继续执行已有瓦片近景拒绝门槛。

#### 下次根据图片建中式古建：Agent 执行流程

1. **看图并记录可见性。** 提取可见层/檐层、柱跨节奏、台基、楼身收分、主脊/山面/转角、栏杆与门窗、相机方向；檐层不直接等于可使用楼层。分别写“可见依据、推断、未知”。没有标尺时使用相对比例，绝不冒称真实尺寸；看不到的背面和内部结构用明确标注的假设。
2. **先做轮廓骨架。** 按图片定台基宽高、柱网、各层檐线宽度与标高、脊高、出檐深度和角点抬升。屋顶以脊线—正身剖面—翼角边界控制；对称只在图片支持时使用。不自动套上庭院、围墙和轴线序列。
3. **通过体量对照。** 用与原图相近的视角看轮廓、主要负空间、屋顶遮挡及楼身收分，同时检查正面和侧面。轮廓偏差回到骨架修改，不靠增加斗拱、瓦条或景观弥补。
4. **做一套完整可重复样板。** 标准开间包括柱/柱础、梁枋、按可见依据配置的正身斗拱、门窗/栏杆、檐下构件；屋面样板显示适合目标视距的坡面厚度、檐口与接触关系。需要近景瓦时单独完成瓦形截面、搭接、滴水和屋脊端部。无斗拱的参考建筑不强加斗拱。
5. **同时验证一个转角样板。** 包括翼角曲面、角梁/檐下连接和图中实际存在的转角斗拱。正身与转角共用边界，非共面四边形明确三角化，检查扭曲、自交、裂缝、面朝向和穿透。接触用实际表面/端点间隙、必要剖面和近景判断，包围盒只用于初筛。
6. **预算后复制。** 列每个原型的唯一面数、预计根路径次数和展开贡献；整合单开间或瓦带这样的适当重复单元。按已验收的局部坐标系平移/转向，构件方向随檐线或屋面切线变化，避免双重变换。复制后抽查首、中、末及转角接缝。
7. **逐层变体。** 单独处理楼身收分、不同层屋顶、山面/脊饰、端跨、顶冠和局部例外；不靠整栋非均匀缩放解决所有差异。历史样式、构造细节须与图片或额外可靠资料对应，来源不明时明确写推定。
8. **按视距控制细节并完成验收。** 远景保留曲坡、翘角、脊线、檐口厚度与阴影节奏；近景保留可见瓦形、斗拱轮廓、栏杆/窗格和节点联系。高频远处细节可分级，但不能把占轮廓的关键构件压成贴图。分别检查整体、正身开间、角部、屋面剖面与檐下；通过受管 MCP 分阶段审查并完成 SKP 保存。

此流程是从样本学习后形成的建模规则，不表示本次已经完成新的图片重建测试。任何图片的相似度仍需逐阶段视觉验证。

#### 对应受管阶段

- `massing`：相机、柱网所决定的楼身、檐层与主要屋顶轮廓。
- `archetypes`：完整正身开间、正身斗拱（如有）、瓦带（目标视距需要时）、转角样板；先检查再复制。
- `replication`：通过样板的真实组件实例，局部坐标与切线方向正确。
- `variants`：不同楼层收分、特殊屋顶/角部、顶冠/山面和脊饰。
- `facade_detail`：不属于重复原型的一次性入口、牌匾、局部收口等。
- `finish`：材质、视距细节切换、整理及最终证据。不以增加实体数代替验收。


#### 黄鹤楼实际重建的后续纠错门槛

在新建或修改承托、层间窗墙与曲屋顶前，必须继续读取 黄鹤楼照片建模复盘（来源条目：`yellow-crane-tower-lessons.md`；相关规则已提炼进本 REF）。其中记录用户实际指出的承托歪斜和下两层墙体偏矮，以及对应的完整变换、挤出居中、逐层梁底标高链检查。D 的修正不构成屋顶拓扑或传统斗拱制式已经准确复原的证据；不要把本案例取消附加 45° 件推广成所有转角禁用多向构件。

## [massing|roof_profile|archetypes] 古建与曲面样本研究

> 本节经验由老王开发，ADAI 整理与发布。公开包不包含原始商业模型、用户截图或本机证据路径。

### Targeted Study: Chinese Ancient and Curved Architecture

Read after the relevant production protocol (`chinese-ancient-architecture-rules.md` or `curved-architecture-rules.md`) when a model needs corpus-calibrated construction grammar. This study covers 13 ancient and 7 curved SketchUp-2019-readable samples from `历史只读样本库`. It is evidence for reusable structure and scale—not proof that any source is a complete construction document.

#### What the Corpus Proves

| Family | Strong evidence | Do not infer |
|---|---|---|
| Ancient | Layered platform, bay/frame, roof board/purlin/rafter/tile, ridge, threshold, courtyard, repeated small definitions | Exact anonymous dougong shape from a layer name, material, or entity count |
| Curved | Separate shell/glass/metal/floor/landscape systems; repeated bay assemblies; cap/termination systems | That a curved shell with a few windows is an adequate facade |

Ancient source layer names commonly include `瓦`, `屋面板`, `檩条`, `举架`, `椽`, `梁`, `山墙`, `院墙`, `门`, `合院`, `屋脊`, `脊瓦`, `斗拱`, and `亭子`. Treat names as routing clues; validate actual close geometry before copying a detail.

#### Ancient Transfer Sequence

1. Fix source-supported axes, platform, bay module and grid; courtyard and gate sequences apply only when present in the reference.
2. Build one complete bay: column, beam/tie, purlin/rafter, infill, door/window frame, threshold, and platform connection.
3. Derive the roof from ridge/eave/section guides; keep roof planes, eave boards, rafters, tile courses, ridge tiles, and terminals independent.
4. Validate one close detail kit: bracket, lattice door/window, stair, railing, lantern, and eave corner.
5. Convert only an accepted sample to components and extend along the bay grid.

A credible close roof edge exposes roof plane, under-eave/board, rafter rhythm, tile edge, and ridge/end termination. Use tile strips/courses for normal distance; reserve individual tiles for ridge/eave/hero views. A flat roof slab, floating bracket, or pasted motif fails the transfer gate.

#### Curved Transfer Sequence

1. Classify curve and record center/radii or guide curves.
2. Make one real-radius facade bay: host contact, glass/infill, sill/head, vertical frame, transom, interior/exterior depth.
3. Pass plan and section: tangent/radial correctness, no planar gap or wall penetration.
4. Componentize and place by local tangent; do not transform from a world AABB.
5. Add floor-edge/spandrel and cap/parapet as independent curved systems; build end/termination bays separately.
6. Validate bottom, middle, top, termination, close bay, and site separately.

Reject `curved shell + floating flat windows`. Required systems are continuous shell/glazing curvature, frame depth, vertical/horizontal grid, sill/head, floor-edge/spandrel, cap, and termination modules.

#### Evidence Limits and Use

- Ancient examples range roughly 129k–12.7m recursive entities with depth 5–13; curved examples roughly 40k–3.29m entities with depth 4–12. These are evidence of assembly density, **not targets**.
- Learning evidence needs source hash, recursive audit and inspected visual evidence. Historical UI runs used active-path matches; current isolated C API reads use exact source path and unchanged before/after hashes, not an active UI document. See read-only reader（来源条目：`read-only-corpus-reader.md`；相关规则已提炼进本 REF）.
- `feature_profile=chinese-ancient` or `feature_profile=curved-architecture` is an audit signal only. Promotion still requires close visual validation.
- The historical ancient regression is a construction-grammar prototype, not a finished ancient model. The historical curved-tower regression shows that 924 definitions with only one definition reused at least five times and six instances is insufficient reuse; componentize validated facade systems before claiming corpus fidelity.

For detailed failure history, see `chinese-ancient-regression-findings.md`, `ancient-gates.md`, or the archived original: targeted-ancient-curved-study.full-20260824.md（历史归档未随公开包分发）.

## [massing|roof_profile|archetypes|replication|variants] 多层楼阁照片建模复盘

> 本节经验由老王开发，ADAI 整理与发布。公开包不包含原始商业模型、用户截图或本机证据路径。

### 黄鹤楼照片建模复盘：必须执行的纠错门槛

适用：照片重建中式楼阁、曲屋顶、柱头承托及多层窗墙。2026-09-06，用户指出“斗拱歪了”“下面2层的墙体高度不够”；本记录把实际失败转为下一次建模的检查条件。与 古建图片流程（来源条目：`chinese-tower-image-modeling.md`；相关规则已提炼进本 REF）、古建回归发现（来源条目：`chinese-ancient-regression-findings.md`；相关规则已提炼进本 REF） 一起执行。

#### 证据边界

修正版 D 经受管流程保存为 SKP，并核对文件非空及哈希；本次未重新打开交付 SKP 验证。此前代理曾通过审查，用户仍发现明显节点错误，故流程 finished、签名、计数与整体预览均不代表照片还原已合格。D 的屋顶仍有规则化处理，栏杆窗格、背面、内部及细小节点有推断；不得把 D 当作精确复原标准模型。

案例副本放在 yellow-crane-20260906（原始证据未随公开包分发）：用户错误截图、D 原型截图、C/D 原型脚本及交付说明。脚本只用于追溯，不作为可直接运行的新项目模板；截图摘录不能代替完整签名证据。实际照片可见的大型曲形承托，应与短材分层的斗拱组合分别识别；连续挤出的曲板不能仅因命名而算作已验证的传统斗拱。

#### 1. 承托歪斜：先查坐标、缩放与挤出，再查造型

失败证据：用户截图（原始证据未随公开包分发）。C 把承托放进按开间宽度缩放的组合，又叠加 45° 附加件，导致形变、朝向及重叠问题。D 把承托独立为 `column_support`，按原尺寸放置，并统一挤出法向；见 D 原型（原始证据未随公开包分发）。

执行规则：

- 定义柱轴原点、沿梁/檐的切向轴、出檐方向与竖轴；从真实宿主边线确定方向，不从世界原点的径向猜测。把需要刚性尺寸的承托移出非均匀缩放的开间；放置采用平移与旋转，局部例外单独定义。
- 检查完整实例路径的组合变换 `T_world = T_root … T_parent T_instance`。检查三轴长度、归一化后两两点积、行列式符号，以及各轴相对宿主方向的夹角。单位轴长不能排除错转、剪切或镜像。按项目尺度明确尺寸/角度/间隙容差，不只打印矩阵就算通过。
- 挤出前确认法向与预期厚度轴一致。此案例 YZ 截面从 `x=-0.15m` 沿 +X 挤出 `0.30m`，应覆盖 `[-0.15,+0.15]m`；D 先执行 `f.reverse! if f.normal.x < 0`。XZ 截面同样检查 Y 法向。数值仅为本案例参数，不是古建统一尺寸。
- 在局部坐标中测量厚度两侧到柱轴距离；用近景和必要剖面核查柱头、承托端部、梁底真实表面接触。不能以包围盒交叠证明连接，不能加填充块掩盖错误定位。
- 复制前同时看正身和转角原型；复制后看直段、斜切角、对侧以及首/中/末实例，排查重复出现和反向。D 取消 45° 叠件是本案例修正，不是“一柱只能一件”或古建转角禁用多向承托的通则。

拒绝继续：受非均匀缩放影响、承托偏离柱轴、伸向错误檐面、意外镜像/重叠，或接触关系没有足够证据。原型阶段解决后再复制。

#### 2. 下两层墙体偏矮：建立逐层标高链

失败证据：用户截图（原始证据未随公开包分发）。C 的 `wh=[h-1.55,3.1].min` 把较高楼层也限为 3.1m，梁下留下非参考图要求的大空隙。D 改为 `bottom=0.18`、`wh=h-1.18`，使墙顶 `bottom+wh=h-1.0` 与该原型后梁底吻合；见 D 原型（原始证据未随公开包分发）。这些偏移是此模型参数，不能跨建筑照搬。

执行规则：

1. 为每层列出完成面、窗台、窗头、亮子/墙带、墙顶、梁底、柱头、屋面承托面、檐口和脊顶标高。屋面遮挡后的可见墙高也要与照片核对；檐层数不直接等于楼层数。
2. 从宿主梁底推导目标墙顶与间隙，按层生成墙体/门窗参数。对高首层、第二层、标准上层分别检查，禁止通用高度上限把下部楼层截短。
3. 根据参考图拆分门窗、上亮子和墙带，避免把全部窗格一起纵向拉长。原图为通透回廊或梁下开口时保留，不为消除所有空白而填墙。
4. 修改进深后同时核对楼板承接、窗洞侧壁、梁柱连接和回廊净深；不能仅把窗前移以遮住错误体量核。体量核退到最深开口后方，防止遮挡窗洞。

拒绝继续：梁下出现未解释的连续空带、下层和上层套同一限高、窗格拉伸失真、楼板未接到后移窗墙。必须逐层正立面加檐下近景检查，整体远景不足以验收。

#### 3. 屋顶先判连接关系，再铺瓦

- 用正面、斜上方和仰视照片相互约束：先画主脊、山面、正身坡、斜角坡和顶冠的连接关系，标出可见/推断/未知。不能因平面对称就把八个相同扇区旋转缩放成全部屋顶。
- 在 massing 阶段核查中部檐线、坡面剖面、翼角集中上扬的位置、出檐量和各层收分；识别性轮廓有误就拒绝进入细节阶段。
- 基层、瓦面、封檐板与椽扇共用一套曲线采样及边界参数，各自保留厚度与偏移。检查翼角扇向、曲面接缝、侧边封闭和屋脊收口；详细曲屋面下不要残留外露的平板体量膜。
- 筒瓦有曲率和搭接仍不足以通过近景验收，还需检查板瓦沟、端部厚度、瓦当/滴水、脊端封闭及角部接触。照片看不清的结构不得宣称精确还原。
- 各阶段参数保持单一来源，记录参数版本。避免把同一几何辅助代码复制到每个脚本再局部替换，导致标高和边界漂移；共享实现须遵守受管 build 文件契约。

#### 4. 审查与交付的最低证据

| 阶段 | 必查内容 | 不通过时 |
|---|---|---|
| massing | 多视角檐线、翼角、层间可见墙高、屋顶连接 | 修改骨架 |
| archetypes | 下两层及上层窗墙、独立承托、正身/转角、屋面剖面 | 修原型后再复制 |
| replication | 完整父级变换、首中末/对侧、重复件与接触 | 修当前复制阶段；原型有错按受管规则回到独立项目 |
| facade_detail | 下中上近景、檐下平板残留、瓦口与节点 | 不能以远景或面数替代 |
| finish | 最终预览、文件、证据、交付根及文档内其它项目 | 如实记录未验证项和残留内容 |

审查记录写清“检查了哪个实例/视角、发现什么、哪些还未知”，不要只写通过。用户指出的问题要进入后续检查清单，不能修一次后仅看整体图。

受管检查点和 `save_copy` 可能保存完整文档，包含隐藏旧项目根。D 保存中存在旧 B/C 项目根，应在交付中明确当前主体。新项目应通过受支持流程安排干净文档，保留用户未保存工作；隔离写入不等于只导出项目。不得通过删除外部对象或修改签名状态伪造干净交付。

统计同时区分唯一存储几何、沿根路径展开几何、隐藏对象和文件大小；本案例的百万级展开实体数既不证明细致还原，也不是唯一存储数或实测性能。文件核验不等于重新打开验证，未重开时明确说明。

#### 5. 超时恢复

遵循 managed-recovery.md（来源条目：`managed-recovery.md`；相关规则已提炼进本 REF） 的黄鹤楼补充：请求超时后 `ready_for_step` 也可能只是尚未提交的新状态，必须先确认原请求是否仍在运行；`evidence_pending` 只重试证据。构建期间不并发写入、不因超时重放几何、不修改已签名状态。
