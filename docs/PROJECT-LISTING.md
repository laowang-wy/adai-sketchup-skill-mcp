# SketchUp MCP + Skill — 项目简介

用于仓库 About 与目录介绍；名称保留 `adai-sketchup-skill-mcp`，不变更包 ID、工具名或专家口令。

## English

SketchUp MCP + Skill for AI modeling: managed Ruby transactions, geometry readback, source-image review and local edits. Codex/PipClaw on Windows.

## 中文

SketchUp MCP + Skill：让 AI Agent 根据图片、CAD、文字和已有模型建模，提供分阶段引导、受管 Ruby 事务、真实几何回读与局部修改。面向 Codex/PipClaw、Windows。

## 兼容性与机制

- 产品显示名：SketchUp MCP + Skill for AI Modeling — ADAI。
- 客户端：Codex、PipClaw；其他 MCP 客户端需单独验证。
- Windows；SketchUp 2018/2019 列入适配目录，真机验证集中在 2019。
- MCP 为 stdio；本地 SketchUp Ruby 桥接默认使用文件通道。
- guided 图片/文字建模六阶段逐个执行审核；专家使用工作单元，可连续构造与合并观察。
- 可选尺寸目标绑定、真实读回、事务与回执恢复、对象定向更新；视觉判断由 Agent 实际看图完成。
- 不宣传自动相似度认证、完整依赖图最小重检、工程量统计或木工连接专业认证。

## 标签

sketchup, mcp, model-context-protocol, mcp-server, ai-agent, 3d-modeling, ai-modeling, codex, pipclaw, automation, cad, skill, staged-construction, geometry-readback, dimension-constraints

## 目录使用

项目地址：[GitHub](https://github.com/laowang-wy/adai-sketchup-skill-mcp) · [Gitee](https://gitee.com/laowang2026/adai-sketchup-skill-mcp)。安装、版本与限制以仓库 README 及包内 BUILD.json 为准。

本文提供可复用的 listing 文案，不代表已在 LobeHub、Glama、Smithery 或 MCP Registry 注册、提交或认领。官方注册名须在实际完成注册后公布。
