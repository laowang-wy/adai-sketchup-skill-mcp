# ADAI SketchUp Skill + Managed MCP

![ADAI SketchUp 建模系统](docs/adai-sketchup-overview.png)

这是 ADAI 的可分发 SketchUp 建模包：一个面向 **PipClaw 与 Codex** 的 `professional-sketchup-modeling` Skill，加上配套的 `sketchup-managed` MCP。它让 Agent 先理解建筑空间与来源，再通过受管 Ruby、真实读回和视图复核交付可编辑 SKP。

## 当前版本

- 版本：`0.5.25`
- 构建：`0.5.25-s1-s6-cpal-skill-card-ruby-tower-isolated-host-brief-recovery-cold-cycle-context-v2-20260921`
- 许可：CPAL-1.0（见 `LICENSE`）
- 运行入口：MCP 的 `launch.cjs`
- 适配基线：Windows、Node.js 18+、Python 3.10+、SketchUp 2018/2019；更高版本需按宿主实际 Ruby/API 复核。

## 包内容

- `skill/professional-sketchup-modeling/`：可直接安装到 Codex 或 PipClaw 的 Skill。
- `mcp/sketchup-managed-mcp/`：MCP 运行包，包含桥接、受管项目、公开工具包和随附 REF。
- `dist/`：同一构建生成的两个 ZIP。
- `docs/EXPERIENCE-PACKS.md`：经验包格式、加载与验证方式。

仓库不包含开发测试、工程证据、临时日志、SKP 模型、私钥或本机配置。

## 内置经验包与 GPT6 触发词

当前发行包只内置一个经验包：`adai-ancient-architecture`（古建，随 MCP 提供）。其他 REF 包需要按 [`docs/EXPERIENCE-PACKS.md`](docs/EXPERIENCE-PACKS.md) 单独加载；用户自建包不会被覆盖。

使用 GPT6 建模时，建议把下面任一行放在任务第一条非空行，以减少 Skill 的重复教程和流程提示：

```text
ADAI老王，开启专家模式
开启ADAI老王专家模式
```

这两个触发词只选择 `autonomous` 辅助模式，不放宽权限、保护、质量检查或恢复门禁。使用其他模型时不需要触发词，默认 `guided` 模式即可。

## 安装

把 `skill/professional-sketchup-modeling` 复制到当前宿主的 Skill 目录：Codex 使用 `$CODEX_HOME/skills/`；PipClaw 使用其 `codex-home/skills/`。把 MCP 目录复制到用户本机的 MCP 目录，并让 PipClaw/Codex 的 MCP 配置指向该目录中的 `launch.cjs`。安装器应在本机生成路径；发行包不写死用户目录、SketchUp 路径、PID 或会话令牌。

首次运行只绑定用户明确指定的 SketchUp.exe。启动后先读取短卡、状态、ping 和模型摘要；未保存文档与多实例保护仍由 MCP 负责。

## 经验包

经验包使用 `REF.md` 元数据和按阶段章节，按主题匹配后按需读取。请先看 [`docs/EXPERIENCE-PACKS.md`](docs/EXPERIENCE-PACKS.md)。经验包只提供方法和来源经验，不能替代实时几何读回、视觉审查或交付门禁。

## 后续版本更新

后续版本继续推送到本仓库：更新 Skill/MCP 源码和版本号，生成新的干净 ZIP，更新构建标识与 `SHA256SUMS.txt`，然后提交并推送到 `main`。保留旧版本目录和校验值，不覆盖用户自建 REF 包、旧 MCP 槽位或现有项目；发布前重新运行发布器自带的安装冒烟检查。

本构建已通过离线回归与独立包冷启动检查；本构建的真实 SketchUp 建模、建筑来源对照和第二台机器验收仍为 `not_run`。

本仓库当前是可分发的工程回归候选；官方签名服务尚未配置，不能把“能安装”表述为官方签名。

## Attribution

建筑建模 Skill 由 ADAI 老王提供。ADAI 标识只用于许可要求的归属，不写入 SKP 几何或隐藏模型属性。
