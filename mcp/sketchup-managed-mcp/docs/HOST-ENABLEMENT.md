# 宿主启用与接入（安装≠启用）

本包只提供 Skill 与 MCP 文件。**文件存在或被单独启动通过，不代表宿主已经启用该 MCP，也不代表会话里能列出 `sketchup_*` 工具。** 三者要分开验收。

## 1. 先判断当前状态

| 现象 | 结论 | 处理 |
|---|---|---|
| 会话工具列表里有 `sketchup_runtime`、`sketchup_project_begin` | 宿主已启用 | 直接调用，不要用命令行兜底 |
| 工具列表里没有 `sketchup_*` | 未启用或未加载 | 按第 2 节启用；不要搜索磁盘、不要读 MCP 源码 |
| 独立 `node launch.cjs` 能跑通，但会话无工具 | 仅证明程序可运行 | 仍按第 2 节启用 |

## 2. 在宿主里启用

1. 找到宿主实际使用的 MCP 配置，登记本包入口 `launch.cjs` 的**绝对路径**。
2. 确认该条目 `enabled` 为真。PipClaw/Codex 风格配置示例：

```toml
[mcp_servers.sketchup-mcp]
enabled = true
command = "node"
args = ['<包目录>\launch.cjs']
cwd = '<包目录>'

[mcp_servers.sketchup-mcp.env]
SKETCHUP_BRIDGE_MODE = "file"
# 默认由当前用户 APPDATA 推导，无需填写绝对路径
# 令牌由 SketchUp 插件首次启动时自动生成
```

Windows 路径写在 TOML 基本字符串里必须转义反斜杠，或整体改用单引号字面量字符串。写错的转义会让整份配置解析失败，表现为「所有 MCP 都不见了」。可用包内 `scripts/enable_host_mcp.py --status` 检查、`--enable` 修改（会自动备份并回读校验）。

3. 重启宿主或刷新 MCP 注册，再新建会话；已打开的旧会话不会自动获得新工具。
4. 新会话确认：能列出 `sketchup_runtime`、`sketchup_ref`、`sketchup_ancient_tool`、`sketchup_project_begin`。

## 3. 没有原生工具时的兜底（受限）

仅在宿主暂时无法启用时使用，且必须显式给入口，不允许猜：

```powershell
node <包目录>\runtime-support\professional-sketchup-modeling\scripts\call_sketchup_mcp.mjs --tool sketchup_runtime --args '{"action":"startup"}'
```

- 首次可执行 `sketchup_runtime(action=client_binding)`，把入口写到 `<用户 APPDATA>\SketchUpLiveMCP\mcp-client.json`，之后脚本可直接运行。
- 没有绑定、也没有 `--server` 时，脚本以 `MCP_ENTRY_REQUIRED` 立即失败并给出下一步，**不会扫描磁盘**。
- 脚本会先确认已读起手短卡；结果过长时落盘并只回摘要，避免把整份 JSON 读进上下文。
- 兜底路径只用于过渡；长期应按第 2 节启用原生工具。

## 4. 接入排查的时间与上下文预算

- 同类接入失败连续 2 次且没有新证据：停止继续搜索与阅读实现，报告状态、已证事实、待证假设、下一步。
- 单条命令输出超过约 4000 字符：写文件，只读需要的字段。
- 不要通读 MCP 源码、验证记录或整份参考库来推断调用方式。
- 不把「服务能独立启动」写成「本机已可用」；报告时区分：文件已安装 / 宿主已启用 / 会话可见 / 实机已验收。

## 宿主完成判定（接入开发者）

宿主应以当前项目、阶段和请求的工具结果更新进度，不能把 Agent 的“完成”文字当作执行回执。阶段推进需成功的 step、对应证据及接受该阶段的 review；最终交付需 finish 返回 finished，并核对文件与证据。
若模型返回 `finish_reason=length`（或供应商等价的截断状态），标记本轮输出不完整，勿把半截脚本或工具参数提交执行，也勿标记任务成功；先查已发工具的结果，保留已成功操作，再续写未完成部分。该检查属于 PipClaw/Codex 宿主接入职责，MCP 无法仅凭工具调用获知聊天截断状态；本包未证明宿主已实现此检查。它不新增建模表单，也不替代现有阶段、证据和交付门禁。
