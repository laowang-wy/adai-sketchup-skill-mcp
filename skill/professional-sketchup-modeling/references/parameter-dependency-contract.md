# 参数依赖与版本检查

适用：共享檐线/曲线、标高、柱轴、重复组件参数发生修改时。此工具是离线工作记录检查，不读取或修改 SU 实体，不修改 MCP 状态，不替代受管审查。

这些记录优先由生成器/受管工具维护，普通Agent不逐条手写消费哈希。以下格式供生成器接入和维护时使用；缺少自动数据时明确未验证，不能要求模型重填一套表来替代现场事实。

## 使用

`python scripts/validate_parameter_dependencies.py --input dependency-graph.json --report dependency-report.json`

输入根包含 `schema_version: 2`（兼容读取 1） 和 `nodes` 数组。每个节点需要唯一 `id`、`kind`、非空字符串 `revision`、来源/生成器路径 `evidence` 和 `depends_on` 数组。支持三种节点：

- parameter：一个数值来源，必须有有限数值 `value` 和 `units`（mm、m、degrees、dimensionless），不能依赖其它节点；可设置 `positive: true` 检查正尺寸。
- derived：依赖上游的曲线、标高或边界记录。
- assembly：依赖参数或派生节点的组件/组合记录。

消费者 derived/assembly 必须有非空 depends_on，以及 `built_from` 对象，保存实际生成时所使用的各直接依赖指纹；还需要 `built_self` 保存该消费者实际生成时自身参数/版本的指纹（报告字段 `self_fingerprints[id]`）。缺少或改变自身凭据也会使该节点及下游待复核。可加 `entity_path` 指向宿主，`expected_units` 声明直接依赖的预期单位。工具不做隐式单位换算，不求解任意公式，也不根据 CAD/SU 自动发现依赖。

指纹包括节点参数/版本及其全部上游指纹；不含 built_from、built_self、证据路径和实体路径。改变数值但忘记增加 revision 也会改变指纹。生成器代码的改变必须更新 revision，当前工具不会自行读取/哈希生成器源码。引用路径和版本都是输入声明，不是独立认证证据。

## 工作流程

1. 使用实际源参数建立工作区 dependency-graph.json；不要写入受管签名证据目录。
2. 首次消费者 built_from 可为空、built_self 可缺失，此时应返回 needs_review，而不是假造通过。检查报告给出当前上游指纹。
3. 在受管阶段中完成实际生成和证据检查，记录生成器实际使用的上游指纹和自身输入指纹。不能直接复制报告中的新哈希到旧几何的记录来“修复”。
4. 修改参数后再次运行。按 report.recheck 的上游优先顺序，检查或重新生成受影响对象；未依赖该参数的分支不受影响。
5. guided在原项目使用revise_from处理受影响阶段；新expert在已授权单元内修改或明确替换，再核对新结果。不得另起项目、手改签名或把依赖报告当任意删除许可。

报告状态：pass 仅表示声明图结构/单位及消费版本一致；needs_review 表示自身生成输入或下游消费记录缺失/过期；invalid 表示缺失引用、重复来源、循环、非法尺度或输入；空图 unverified。所有结果的 geometry_readback 都是 unverified。自报正确的图不能证明实际构件接触或参数更新成功。

## 反例验证

本工具自测覆盖：正确基线、檐线改变使封檐与瓦面传递失效、无关窗格变化不影响屋顶、单位不匹配、缺引用、循环依赖、非有限数值、重复 ID、上游自身失效但下游已抄新哈希、空图。另有工作区 CLI 正反例报告；未做本轮真实 SU 自动再生成试验。

## v2 迁移和回归

旧版 schema=1 可以读取，缺少 built_self 会进入 needs_review；不能批量自动填入新指纹来宣称旧几何已验证。生成器源码没有自动读回，revision 仍需随真实代码改动维护。

新增独立回归 `scripts/test_parameter_dependencies.py` 覆盖末端自身版本/局部参数变化、中间自身变化、旧记录缺凭据、kind/units/positive/built_from 畸形类型，以及 1500 层依赖链。拓扑遍历不再使用递归。CLI 读取失败生成 invalid 报告，禁止报告覆盖输入。

MCP 的报告重跑与绑定见 [managed-quality-review.md](managed-quality-review.md)。MCP 仍不会自动提取实际模型依赖。

本 build 的 `sketchup_project_patch` 正式入口已关闭，工具发现不发布，直接调用返回 `PATCH_NOT_RELEASED`。内部单实例平移、显式保护冲突拒绝、回退重取证和保存已有 SU2019 工程试件记录；未知结果恢复、完整祖先路径与依赖保护尚未全部闭合。生产修正继续使用受管阶段与 `revise_from`，不能把内部试件结果当作通用对象编辑能力。
