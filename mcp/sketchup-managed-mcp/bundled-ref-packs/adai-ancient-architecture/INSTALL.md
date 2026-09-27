# 安装

1. 先安装并注册 同一当前构建的 ADAI SketchUp Skill 与 MCP（准确版本见主包 BUILD.json）。
2. 向专家发送：`安装这个 REF 包：<本文件夹或 ZIP 的绝对路径>`。
3. Agent 调用 `sketchup_ref(action=validate)` 后再 `import`。
4. 项目已有适用构造指引时直接使用；需要补充经验时，用 `match(topics=[古建,屋顶], stages=[当前阶段])` 定向读取，不整包加载。

本包不会自动绕过受管阶段、质量审查或保存门禁。
