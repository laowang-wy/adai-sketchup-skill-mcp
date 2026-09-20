# ADAI SketchUp 0.5.24

本次 build_id：`0.5.24-u00-u05-c1-c2-su2019-20260919`。以此 ID 和安装包 SHA-256 区分之前同版本 ZIP。

U00—U05 增量：当前阶段重取证与保护边界、检查点恢复、交付保存与辅助回执修复；review 简写由程序核验封存附件；正常取证去掉重复旧五图；配方和同阶段批量例子复用现有算法。52 项离线回归通过，SU2019 工程小样含屋盖变体与原型/镜像批量实例正反例。性能仅有取证段实测，不等同端到端 Agent 提速；完整范围以随包 IMPLEMENTATION_RESULT.md 为准。以下为继承的历史验证说明。

本版本分别提供 professional-sketchup-modeling Skill 和 sketchup-managed-mcp 两个独立安装包。MCP 内含同版本 Skill 运行支持，独立解压即可定位其脚本；Agent 侧仍须单独启用 Skill 和 MCP。

## 相对 0.5.23 的优化
- 读取签名状态时不重新生成缺失密钥；拒绝损坏状态、非法版本和 revision；写入加入项目互斥与 revision 冲突检查。
- 事务失败区分已回滚和结果未知；结果未知时保留恢复门禁，避免重放写操作。
- 加强几何与外观摘要、祖先变换、受保护对象指纹、主体统计、实例与组件定义的核对。
- 证据附件校验文件、大小、哈希及当前模型绑定；最终保存前重新检查项目审计。
- 正式几何适配器 0.2.0 接入 massing、roof_profile、archetypes、primary_corrections、facade_detail；要求来源、任务契约和对应登记映射。refinement 是模式，不是阶段。
- 修复工具包切瓦边界与重复点处理，补齐发行文档和验证夹具；统一入口、安装辅助脚本版本及包内运行支持。

## 安装
Skill ZIP 导入宿主 Skill/专家能力管理并分配给当前 Agent；MCP ZIP 独立导入 MCP 管理并启用，以 node 启动 launch.cjs。首次安装桥插件见 INSTALL.md。宿主加载新资产后在新会话验证 sketchup_runtime、sketchup_project_step 等工具可见。

## 验证边界
完成的验证为离线契约/行为回归、JSON/Python/Node 检查、ZIP 完整性、干净目录解压及空 APPDATA 下 MCP 初始化、工具发现、startup 和经验包检查。精确结果在安装 ZIP 外的验证报告中。
本轮已在真实 SU2019 19.0.685 / Ruby2.5.1 完成工程试件的建模、审查、回执恢复、保存及重开编辑。修复实机发现的 File EXCL、filter_map、细部相机与多项目可见性摘要兼容问题。建筑来源匹配、新机器、SU2018 和模型能力对照仍为 not_run。完整跨动作恢复尚未闭合，因此 patch 正式入口关闭；详见 references/verification-0.5.24-r3.md。
