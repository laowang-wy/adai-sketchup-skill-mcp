# 宿主启用与接入

先按 [安装说明](../INSTALL.md) 登记 `launch.cjs` 并安装 SU 桥接插件。当前构建见 [BUILD.json](../BUILD.json)。

| 当前状态 | 下一步 |
|---|---|
| 会话能调用 `sketchup_runtime`、`sketchup_project_begin` | 按返回动作绑定实例并开始建模 |
| 文件已解压，工具不可见 | 核对宿主 MCP 配置及启用状态，重新加载后在新会话确认 |
| MCP 独立启动成功，SU 未连通 | 核对目标 SU 的插件加载、桥目录和实例登记 |

具体配置、受管命令行入口及恢复见同包 [接入指引](../runtime-support/professional-sketchup-modeling/references/HOST-ENABLEMENT.md)。文件已安装、宿主已启用、工具可见与真实 SU 成功是不同状态；以各自实际返回确认。
