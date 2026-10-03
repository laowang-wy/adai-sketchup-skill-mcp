# ADAI SketchUp Managed MCP

当前产品版本：**0.5.39**。准确构建标识见 [BUILD.json](BUILD.json)，改动与验证边界见 [RELEASE.md](RELEASE.md)。这是面向 PipClaw 与 Codex 的本地 stdio MCP，由 ADAI 开发。

## 安装与启动

- Windows、Node.js 18+、Python 3.10+；Python 依赖见 `requirements.txt`。
- SketchUp 2018/2019 列入适配目录；本轮真机验证使用 SU2019，SU2018 与其他版本需分别验证。
- 宿主使用 `node` 启动本目录 `launch.cjs` 的绝对路径。
- SketchUp 扩展管理器安装 `mcp/sketchup-mcp/plugin/su_mcp.rbz`；保存工作后重启目标实例。

完整步骤见 [INSTALL.md](INSTALL.md)，工具不可见时读 [宿主接入](docs/HOST-ENABLEMENT.md)。`launch.cjs` 默认使用包内 `runtime-support/professional-sketchup-modeling`，不要求另一份 Skill 位于固定目录；显式的 `PIPCLAW_SKILL_ROOT` 才会覆盖此默认值。

## 当前建模入口

使用 `sketchup_project_begin/step/review/finish`，按返回的 `task_card.construction_brief` 取得当前方法；状态与恢复从 `sketchup_project_status` 和原操作回执接续。完整主形、真实宿主上的代表构件、复用与细化共用同一专业方法。

guided 使用保存的分步计划；专家以完整口令启用，完成起步的主形和适用代表构件确认后，可连续组织工作单元并合并审核。局部修改使用现有受管 update 路径，保留无关成果。准确用法见随包 [Skill](runtime-support/professional-sketchup-modeling/SKILL.md)。

## 方法与独立包版本

| 内容 | 当前随附版本 | 用途 |
|---|---|---|
| 古建可执行工具包 | 0.4.7 | `sketchup_ancient_tool` 的参数、生成与编译 |
| 古建经验集合 | 0.4.3 | 工具包内 `experience-pack.json` |
| 默认古建 REF | 1.4.0 | 首次 REF list 安装到本机 store，按问题读取 |
| 工具包内历史 REF 副本 | 1.3.0 | 保留来源版本，不与默认 REF 混称 |
| 公共几何核心 | 0.1.1 | 网格合法性和真实读回 |

它们的版本独立于 MCP。以实际读取路径、版本和指纹确认使用对象；用户已有同 ID 包不会被静默覆盖。旧 REF 中的版本记录不替代当前工具合同。

根据来源特征选择候选方法，需要屋壳时沿 `preset → compile → ruby_file → step` 构造；合法受管 Ruby 同样可用。见 [古建工具指南](toolkits/ancient-architecture/PACKAGE-GUIDE.md) 与 [几何契约](runtime-support/professional-sketchup-modeling/references/geometry-guard.md)。方法可用于相符的现代或古建形体，建筑名称不决定算法。

扩展工具使用 `sketchup_toolkit` 注册和固定指纹调用；见 [工具包协议](docs/TOOLKIT-PROTOCOL.md)。许可与归属见本目录 `LICENSE`、`NOTICE`，新机器和新 SU 版本的验证范围见 [兼容性说明](docs/COMPATIBILITY.md)。
