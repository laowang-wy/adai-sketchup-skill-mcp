# ADAI SketchUp 0.5.25 安装

1. 安装 Windows、Node.js 18+、Python 3.10+；Python 依赖见 requirements.txt（古建源样板另需 numpy）。
2. 解压 MCP 到任意稳定目录。宿主以 node 启动该目录 launch.cjs 的绝对路径；支持标准 stdio JSON-RPC。不要依赖工作目录。
3. 将 SKILL 包中 professional-sketchup-modeling 目录放入 Agent 的 skills 目录。MCP 自带同版本运行支持，二者不依赖固定安装路径。
4. 在 SketchUp 扩展管理器安装 mcp/sketchup-mcp/plugin/su_mcp.rbz，然后重启 SU。升级前保存文档。不要同时加载旧版本的桥插件。
5. 调用 sketchup_runtime(action=bind_shortcut, shortcut_path=用户指定的完整 exe 或 lnk 路径, user_provided=true)。脚本不会猜选 C 盘或其它副本。用 runtime-support/professional-sketchup-modeling/scripts/start_local_sketchup.ps1 启动已绑定程序。
6. 调用 startup、instances，必要时 select_instance(process_id=目标PID)，然后 ping/模型摘要核对文档。本机令牌首次运行自动生成，不从其它电脑复制。

可选变量：PIPCLAW_SKILL_ROOT、PIPCLAW_BUNDLED_REF_ROOT、SKETCHUP_PYTHON、SKETCHUP_BRIDGE_DIR、SKETCHUP_BRIDGE_TOKEN_FILE、SKETCHUP_BRIDGE_MODE（默认 file）。自定义桥目录或令牌文件时，SU 和 MCP 两端必须一致。

两包包含运行代码、古建卡与配方、来源网格及必要图像；排除模型、日志、令牌、缓存、历史现场验证和重复上游安装归档。引用历史验证的说明不代表本包已通过该验证。

0.5.25 已进行离线回归与干净解压启动验证；本版本真实 SketchUp 建模、重开编辑及另一台电脑验收尚未执行。旧版本 SU2019 桥接测试属于历史记录，不代表当前建模验收通过。
