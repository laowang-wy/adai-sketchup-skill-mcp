# ADAI SketchUp 0.5.24 恢复候选

当前发行版为 0.5.24，在 0.5.23 基础上合入状态与并发保护、事务恢复、实际读回与证据校验、保存前审计及正式几何适配器修复。版本改动和验证边界见 RELEASE.md。文中历史实机记录不代表 0.5.24 已通过实机建模验收。接入参见 runtime-support/professional-sketchup-modeling/references/HOST-ENABLEMENT.md。

## MCP 功能与接入

独立的 stdio MCP 资产，用于受管 SketchUp 建模、证据、审查、保存、运行时绑定和可插拔 REF。由 ADAI 开发。

## 官方入口

- command: `node`
- args: `["launch.cjs"]`
- transport: `stdio`

`launch.cjs` 默认把 `PIPCLAW_SKILL_ROOT` 指向本资产内的 `runtime-support/professional-sketchup-modeling`，因此 MCP 不依赖另一个 Skill 被安装到固定目录。宿主显式提供 `PIPCLAW_SKILL_ROOT` 时才覆盖默认值。

## 运行依赖

- Windows
- Node.js 18 或更高版本
- Python 3.10+，numpy 1.24+（源样板）；完整依赖见 requirements.txt
- SketchUp 2018/2019；主要开发环境为 2019
- 在 SketchUp 扩展管理器安装 `mcp/sketchup-mcp/plugin/su_mcp.rbz`

其它 SketchUp 版本必须适配插件、截图、保存和 Ruby API 后再实测。历史 0.5.6 基线曾验证隔离 SU2019 六类默认屋壳、瓦脊与合成接触样板；离线 MCP 启动和工具发现不等于真实建模验收。

## 内置知识库

本 MCP 内置 `adai-ancient-architecture@1.4.0`，由老王开发、ADAI 整理与发布。首次调用 `sketchup_ref(action=list)` 时安装到本机 REF store；后续仍通过 match/read 分页按需读取。它不是独立 Skill，也不改变 MCP 安全策略。

## 古建工具

sketchup_ancient_tool 可列出12张卡、7份配方、5个来源样板与6类屋面候选，并校验/编译参数。代码随本资产安装在相对目录 toolkits/ancient-architecture，无需素材库盘符或另一份Skill路径。Python 可由宿主设置 SKETCHUP_PYTHON 为明确可执行文件，默认使用 PATH 的 python；运行时不联网安装依赖。
REF仅是知识，工具资产是可执行代码，两者在本MCP内分开。只有一个主Skill。读取 [古建工具指南](toolkits/ancient-architecture/PACKAGE-GUIDE.md) 了解诊断限制。SDK提取器需显式 SKETCHUP_SDK_DIR，常规生成无需SDK。
历史 0.5.6 基线的限定小样实机回归记录为通过；完整建筑、全参数和新机器仍需复验。升级不自动覆盖用户同ID经验包；REF list返回升级信息，再明确import overwrite。

## 通用扩展

sketchup_toolkit提供显式信任注册及固定指纹调用。见docs/TOOLKIT-PROTOCOL.md、templates/toolkit-example。许可政策见docs/LICENSING-POLICY-DRAFT.md（未生效）。此版是候选版，不具备竞品硬封禁，也未完成新版SU适配。

公共geometry阶段适配、当前源缺陷及验证边界见 [几何守卫](runtime-support/professional-sketchup-modeling/references/geometry-guard.md)。古建工具0.4.4、几何核心0.1.1。
