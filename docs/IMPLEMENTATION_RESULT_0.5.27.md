# 0.5.27 实施结果

## 已合并

- 共同建筑专业底座：来源边界、主次体量、尺度基准、负空间、定义性轮廓、构造关系、相机判别和表示选择，供 guided 与 autonomous 共同使用。
- guided 保留原阶段与分步帮助；autonomous 增加受管 `work_unit_id`、连续 bounded step (`continue_work_unit=true`) 和合并证据记录。连续操作仍经过项目绑定、事务回执、真实读回、证据封存和恢复保护。
- 几何 guard 通过不再被当作形态正确；Skill 要求按可比视角与来源图核对体量、比例、空间和表皮差异。
- 保留古建经验包：`AncientArchitectureExperience` 0.4 / 可执行工具包 0.4.4；随附 REF 1.4.0（以 MCP 包内 manifest 与实际读取路径为准）。

## 同构建包

- Skill ZIP: `dist/professional-sketchup-modeling-0.5.27-s1-s6-cpal-skill-card-ruby-tower-isolated-host-brief-recovery-cold-cycle-context-v2-20260921.zip`\n  - SHA256 `1ab559dfc663101b51650e621fbd146a18004b0595c262b48bdfcb19480b34b6`
- MCP ZIP: `dist/sketchup-managed-mcp-0.5.27-s1-s6-cpal-skill-card-ruby-tower-isolated-host-brief-recovery-cold-cycle-context-v2-20260921.zip`\n  - SHA256 `b0c9f559b4e0d23afc872044e9b203e285a9b1c2a8d3a9d73018854aa4f44532`

## 验证

- 发布器干净解压、Skill/MCP 同构建一致性、MCP initialize/tools/list、能力入口：通过。
- v3 候选资料：原 39 项 + 新工作单元上下文 12 项离线检查通过；这些检查不是 SU 真实建模验收。
- Node 真实入口冷启动返回 `serverInfo.version=0.5.27`、build_id 与 manifest 一致；tools/list 返回 30 个工具；`get_capabilities` 正常。

## 未测项

- 真实 SketchUp/SU2019 建模、来源图对照、重开编辑和第二台机器验收：`not_run`。
- autonomous 跨多个原阶段类别的完整真实工作单元、工具包组合和视觉合并审核：`not_run`；本版已接通 bounded work-unit 的 `continue_work_unit` + `next_phase`、逐笔证据保留与合并审核记录，未放开裸写或绕过阶段保护。
- 官方签名/远程发布服务：`not_run`。



