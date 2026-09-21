# 按需接入（工具缺失才读）

0.5.27 分为独立 Skill 和 MCP 两个 ZIP。先用宿主资产管理分别导入两个包，并为当前 Agent/专家启用这份 Skill 与 MCP。仅导入 Skill 不会自动注册 MCP 工具，仅解压 MCP 也不会让所有 Agent 自动可见。MCP 的 command 为 node，args 为解压后 launch.cjs 的绝对路径。二者应来自同一发行版本。
如果当前技能列表或工具列表缺失，先核对该 Agent 的资产分配、MCP 启用状态和启动日志，再在宿主重新加载后使用新会话验证。文件已安装、宿主已启用、当前会话已发现工具和 SketchUp 桥接已连接是四个独立状态；不能据一个状态推断其他状态。用户要求本地 SketchUp 时，不因工具暂时缺失就改用 CAD 或网页平台。
首次在 SketchUp 扩展管理器安装 MCP 包内 `mcp/sketchup-mcp/plugin/su_mcp.rbz`。文件存在不等于插件加载。桥接插件启动后会在 `%APPDATA%\SketchUpLiveMCP\bridge\instances` 登记「PID + 会话 + 可执行文件路径 + 版本」，并用该可执行文件身份匹配绑定。运行后用 ping 核对真实版本和文档。
同一台机器可能同时有多个 SketchUp：MCP 只向已绑定可执行文件、且由 `runtime-instance.json` 选中的那一个发送请求；`sketchup_runtime(action=instances)` 列出候选，`action=select_instance process_id=...` 显式选择。多实例或选中的进程退出时返回 `AMBIGUOUS_INSTANCES` / `INSTANCE_CHANGED`，必须重新选择，不会自动切到别的进程。
开发测试不得起停他人的 SketchUp 或改写正在使用的 MCP；测试使用固定 MCP 副本，插件与 MCP 配置相同的独立 `SKETCHUP_BRIDGE_DIR`，TCP 通道如启用也需独立端口。普通建模不改 SU 的 `APPDATA`，不为隔离重建用户配置。
多个存活实例可正常选择，不等于桥争抢。已选目标反复消失或登记身份与进程不符时，停止写请求并核对一次，沿用当前项目的状态/回执恢复入口；不要反复启动 SU、新建 project_id 或自动换绑来隐藏未解决的问题。固定快照与独立桥只在确需隔离时配置，不是每阶段操作。
打开模型用 `sketchup_open_model`：只接受绝对路径的 .skp，当前文档有未保存改动时返回 `UNSAVED_MODEL` 且不改动任何文件；打开后用活动文档路径回读确认，路径不一致返回 `OPEN_MODEL_NOT_CONFIRMED`。

原生 MCP 可用直接调用。原生不可用且有已确认的本包入口时可使用随包客户端：
`node <Skill>/scripts/call_sketchup_mcp.mjs --server <MCP>/launch.cjs --tool sketchup_runtime --args '{"action":"startup"}'`
读取短卡后，后续调用按返回要求提供 `--ack-startup <card_sha256>`。这是受管桥接而非原生宿主验收。每次显式指定本包入口，避免旧绑定；写请求状态不明时先查状态，不切通道重放。

需要永久登记时，使用从 0.5.7 保留的独立安装辅助脚本：
`python <Skill>/scripts/install_managed_mcp.py --entry <MCP>/launch.cjs --config <宿主配置绝对路径> --check`
确定本包入口和目标配置后才执行同命令的 `--install`。仅适用于所支持的 TOML 宿主，非 TOML 宿主用其资产管理。辅助脚本会备份并只修改目标段；不复制 Skill/MCP，不包含自动覆盖安装或嵌套 OneClick。入口版本不匹配会在写配置前拒绝。
配置改变后重启 Agent 宿主并新建会话；旧会话看不到新工具不代表注册失败。包落盘、配置登记、会话可见和 SU 实机成功分开报告。

入口由宿主资产清单、用户或已确认绑定提供，不扫盘猜入口。实际门禁错误允许按 SOURCE-DIAGNOSIS.md 定向阅读本包实现，无需为找安装路径通读源码。

## 宿主完成判定（接入开发者）

宿主应以当前项目、阶段和请求的工具结果更新进度，不能把 Agent 的“完成”文字当作执行回执。阶段推进需成功的 step、对应证据及接受该阶段的 review；最终交付需 finish 返回 finished，并核对文件与证据。
若模型返回 `finish_reason=length`（或供应商等价的截断状态），标记本轮输出不完整，勿把半截脚本或工具参数提交执行，也勿标记任务成功；先查已发工具的结果，保留已成功操作，再续写未完成部分。该检查属于 PipClaw/Codex 宿主接入职责，MCP 无法仅凭工具调用获知聊天截断状态；本包未证明宿主已实现此检查。它不新增建模表单，也不替代现有阶段、证据和交付门禁。

