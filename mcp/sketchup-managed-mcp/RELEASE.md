# ADAI SketchUp 0.5.27

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
本版本没有完成真实 SketchUp 全流程建模、重开编辑、新机器及模型对照验收。历史 SketchUp 记录不自动继承为本版本验收。状态迁移、完整操作日志及后续工程任务仍未全部完成。

