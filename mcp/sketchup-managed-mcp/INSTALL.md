# ADAI SketchUp 安装

本文适用于当前 **0.5.38** 发行包。Skill 与 MCP 使用同一构建；分别打开包内 `BUILD.json` 核对 `version`、`build_id` 和 `source_digest`。改动与验证范围见各包 `RELEASE.md`。

1. 准备 Windows、Node.js 18+、Python 3.10+；Python 依赖见 MCP 包内 `requirements.txt`。
2. 将 MCP 解压到稳定目录。宿主以 `node` 启动该目录 `launch.cjs` 的绝对路径，传输使用 stdio。
3. 将 `professional-sketchup-modeling` 放入当前宿主 Skill 目录，并启用这份 Skill 与 MCP；MCP 也自带同构建运行支持。
4. 保存当前文档，再在目标 SketchUp 的扩展管理器安装 MCP 内 `mcp/sketchup-mcp/plugin/su_mcp.rbz`，重启目标实例。只加载这份桥接插件。
5. 首次调用 `sketchup_runtime(action=bind_shortcut, shortcut_path=<用户指定的 exe 或 lnk 绝对路径>, user_provided=true)` 绑定程序，再调用 `startup`。按返回动作启动或选择实例；多实例时用 `instances/select_instance`。
6. 用 `sketchup_ping`、`sketchup_get_model_summary` 核对真实版本和文档。本机令牌首次运行生成，不从其他机器复制。

TOML 宿主需要登记时可先检查：

```text
python <Skill目录>/scripts/install_managed_mcp.py --entry <MCP目录>/launch.cjs --config <宿主配置绝对路径> --check
```

用相同参数改为 `--install` 后登记；它会备份目标配置。MCP 独立包内的 Skill 目录为 `runtime-support/professional-sketchup-modeling`。配置变更后让宿主重新加载，并在新会话核对工具可见性。非 TOML 宿主使用其资产管理入口。

可选变量：`PIPCLAW_SKILL_ROOT`、`PIPCLAW_BUNDLED_REF_ROOT`、`SKETCHUP_PYTHON`、`SKETCHUP_BRIDGE_DIR`、`SKETCHUP_BRIDGE_TOKEN_FILE`、`SKETCHUP_BRIDGE_MODE`（默认 file）。显式指定桥目录或令牌时，SU 与 MCP 两端一致。

RBZ、Skill 和 MCP 来自同一构建。安装成功、工具可见、SU 连通和建模质量分别核对；本轮 SU2019 的实际构造与保存重开记录不代表其他版本或第二台机器已验证。升级保留用户模型、项目和自建经验包。
