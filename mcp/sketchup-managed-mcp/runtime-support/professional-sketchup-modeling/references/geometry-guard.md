# 公共几何契约（发行版 0.5.27 / 工具 0.4.4 / 核心 0.1.1）

契约沿用 0.5.6 代码基线；工具与几何核心使用独立版本号。

入口 sketchup_ancient_tool(action=compile,family=geometry,parameters=...)。parameters包含project_id、phase、source_evidence、task_contract及parts（1..100个唯一semantic_id）。正式编译阶段为massing、roof_profile、archetypes、primary_corrections、facade_detail；refinement是项目mode，不是phase。massing必须登记projection_subjects，archetypes必须登记archetypes及至少一个visible_detail_system；来源或任务明确要求更多系统时按要求补齐，primary_corrections必须登记correction_targets并使用refinement mode。适配器会生成受管登记调用，但真机执行、读回和视觉验收仍未由离线编译证明；须匹配真实当前context，roof_profile另需roof_control_contract。旧roof/source/bearing/eave/measured保持test/massing门禁。
每个part提供role、vertices、faces、topology。closed预期闭合；open_sheet须提供expected_boundary、thickness_mm、offset_direction。host_id、offset_mm、offset_semantics明确宿主与偏移。dependencies声明producer/consumer；contacts声明pair、points_mm、direction、expected_gap_mm、tolerance_mm。详细输入见geometry_tool.py；来源与尺寸不能猜填。

曲面三角化，凹平面多边形耳切；非共面四边形拒绝。检查索引、有限数、退化、重复、边关联、局部方向、逐分量正体积及自交。多分量AABB重叠保守拒绝，不支持嵌套空腔。只加厚已声明开放片，未知洞口不可补。源编译只在副本统一方向，非流形拒绝并保留原网络。
主要错误：FACE_INDEX、VERTICES_INVALID、ZERO_AREA、NONPLANAR_POLYGON、TRIANGULATED_INPUT_REQUIRED、OPEN_CLOSED_COMPONENT、LOCAL_ORIENTATION、INWARD_COMPONENT、TRIANGLE_SELF_INTERSECTION、SOURCE_NONMANIFOLD_EDGE、SEMANTIC_ID_MATCH_COUNT、LIVE_TRIANGLE_COUNT、CONTACT_GAP。错误包含语义ID及可用面/边编号并抛入受管事务回滚。lint只是文本提示，不是几何验收。

SurfaceHost基于最终三角网返回cell、重心权重、point、normal、版本和哈希。同XY多高度须chart；折线上稳定选择编号最小的实际cell法线，不使用跨折线平均法线。locate(offset_mm)沿该法线偏移；竖直样板另行声明。
歇山旧竖直底壳在山面肩部真实穿插。现保留上部顶点/宿主，底层XY比例1-thickness/min(half-width,half-depth)，Z减thickness，形成内收斜封边，非处处法向等厚。其它五类壳几何保持。盔顶/盝顶旧报错是近共面求交数值误判，改为毫米单位平面距离及主平面投影。相交检查仍有共面共线/T接容差边界，不是通用CAD证明。

SU以真实Face.mesh重验面数、边界、连通、法线、体积、bounds及mesh_sha256。semantic_id独立于persistent_id；每次自动材料绑定当前证据和新鲜PID。geometry-readback、measurements、dependencies及review-draft生成后，视觉仍unverified；必须实际看图。geometry_diagnose加载当前安装核心，只读受管对象。
五整体视图与最多8组近景用递归可见Face包围盒，排除ConstructionPoint锚点。固定图临时隐藏项目外实体并恢复可见性/相机，元数据记录投影与范围；近景保留同项目装配环境。顶层summary不能判断复杂度，需递归audit。耗时分编译、写入/读回、取证与审查，不推断用户所说比例。

历史SU2019样板记录验证六类默认壳、庑殿40实例瓦样板及5条封闭脊、生产massing/roof_profile合成样板16点竖直接触；漏面及反面反例回滚。18组参数矩阵仅离线。未证明整塔、全参数、完整铺瓦、镜像世界朝向、历史还原或重开；样板checkpoint不等于完成六阶段建筑finish。
corridor-corner、corridor-xieshan保留读取，编译因源非流形拒绝，见catalog.current_compile_support。其它源开放内容不宣称闭合。已接受阶段错误用revise_from创建检查点并失效目标及下游，待审错误用review(revise)；evidence_pending只retry_evidence。

瓦片跨折线时，逐点法线跳变会使薄瓦自交。当前以瓦片中心的实际宿主cell法线作为整片固定偏移方向，基底点仍从离散宿主采样；不是每点法向等距层。翼角裁切瓦仍明确使用竖直厚度。宿主边界按1e-6 mm距离容差处理量化误差，并将容差内的负权重夹回真实三角边界，不外推未知区域。

工程修复 R02：阶段来自 MCP contracts/managed-contract.json；Ruby 常量由开发脚本生成并检查。上述 SU2019 记录属于历史基线，本轮合同调整尚未真机验收。

