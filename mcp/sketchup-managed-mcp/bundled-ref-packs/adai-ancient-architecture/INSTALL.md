# 安装

1. 先安装并注册 `ADAI SketchUp Skill/MCP 0.3.1` 的 SKILL 与 MCP。
2. 向专家发送：`安装这个 REF 包：<本文件夹或 ZIP 的绝对路径>`。
3. Agent 调用 `sketchup_ref(action=validate)` 后再 `import`。
4. 新建古建任务时，使用 `match(topics=[古建,屋顶], stages=[当前阶段])`，只读取匹配章节。

本包不会自动绕过受管阶段、质量审查或保存门禁。
