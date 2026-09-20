# 实例读回、排列及有意镜像

## 活动文档 MCP 读回

`sketchup_read_instance_layout` 为只读接口，参数：

```json
{"expected_path":"D:/your-project/model.skp","scope_path":[],"max_instances":1000,"max_depth":12}
```

- 必须匹配当前已保存文档的绝对路径；不打开文件、不保存、不修改模型/相机/选择或属性。新版 MCP 直接返回实例读回 JSON（含 ok、instances、truncated、source、transport），无需解析 result_inspect。不可把传输成功当成排列/几何验收通过。
- scope_path 为根到目标容器的 persistent ID 字符串数组。空数组从根读取；取得真实路径后逐级缩小到一个系统。按出现路径遍历共享定义，不能按 definition 去重后漏掉其它实例。
- 返回该范围内子容器的完整路径、definition GUID、名称、世界原点、完整父级矩阵链、世界矩阵、轴长、行列式，以及自身隐藏/标签属性。所有平移为米；矩阵是行主序、列向量 convention，不是 SketchUp 原始扁平数组。
- 上限为 5,000 件、32 层，默认 1,000 件、12 层；数量、深度、待处理队列或循环截断会设置 truncated。截断结果不能用于全覆盖验收，应缩小 scope。所有隐藏容器也被读取，未求完整继承/场景可见性。
- 返回 source 的 path/guid/modified 前后信息；这是读取期间的基本身份核对，不是签名证据或整个几何无变化的密码学证明。几何接触保持 unverified。
- 生产任务仍应先 status 确认项目/文档。这个只读工具不授予阶段通过，不替代受管绑定与 evidence 校验。未保存项目没有文件路径时不要擅自保存来满足参数，使用许可范围内的读回或明确能力缺口。

本轮用真实 server 路由和模拟 bridge 验证接口发现、参数限制和编码；未运行活动 SU 端到端试验。常驻旧 MCP 需要正常重新加载才显示新工具，不为此强关用户文档。

## 已保存 SKP 的只读快照路径

先按 [只读读取器](read-only-corpus-reader.md) 生成 model-audit.json，再运行：

```text
python scripts/read_instance_layout.py --audit model-audit.json --output NEW-layout.json --scope ROOT/0 --limit 1000 --depth 12
```

这是既有 C API 审计的世界变换展开；source_sha256、audit_sha256 标识来源。ROOT/0 等路径是该审计的子索引路径，definition_id 为该快照的 C/G 编号。它们不能当作活动 SU 的 persistent ID/GUID，也不能用于认证当前未保存模型。输出文件不得覆盖已有文件。

## 排列检查输入

仍由 `validate_geometry_measurements.py` 和 MCP quality_review 的 geometry 通道执行，kind 为 instance_layout。输入根单位必须与读回一致，通常为 m。每条检查包含 id、entity_path、source_evidence、coordinate_frame、length_tolerance、truncated:false：

```json
{
  "id":"balcony_array", "kind":"instance_layout",
  "entity_path":"actual/assembly/path", "source_evidence":"actual-layout.json",
  "coordinate_frame":"world:model-origin", "length_tolerance":0.001, "truncated":false,
  "instances":[{"entity_path":"actual/instance/path","definition_id":"actual-definition-id","origin":[0,0,3]}],
  "expected_slots":[{"slot_id":"floor_2_bay_1","definition_id":"actual-definition-id","origin":[0,0,3]}]
}
```

示例是假数据，只展示格式。实际 instances 从读回选取属于目标排列的直接实例或指定家族，不把其子栏杆/窗框也当一件标准层。truncated:false 必须来自完整范围的真实读回，不能人为抹掉截断。

expected_slots 由源图/楼层表/宿主基准建立，转换到相同世界坐标；不能把实测位置全部复制成预期来制造通过。每边最多 1,000 条，按装配分批。检查定义 ID 与原点在容差内一对一覆盖：缺槽、多件、同槽多匹配、一个实例匹配多个预期槽都失败。不同方向却原点相同的对象可能产生歧义，应缩小到相应家族或用明确基准区分，不能把歧义直接宣称为几何重叠。

该检查验证数量/位置/定义覆盖，不验证旋转、缩放、实体接触；方向另跑 transform 检查。缺坐标系时不能通过，已知算术失败仍失败。校验器接受的是提供的数据；活动读回真实性与当前证据的对应仍需代理保持，MCP 的输入绑定并不独立认证每一行测量。

## 有意镜像

使用 kind=mirrored_transform，字段与 rigid_transform 相同，另需非空 mirror_reason。expected_world_axes 明确给出来源要求的左手正交单位轴，不能自动取实际轴作为预期。它只接受最终行列式为负、无缩放/剪切且方向符合预期的完整变换。

例如 X 镜像的预期轴为 `[[-1,0,0],[0,1,0],[0,0,1]]`，实际宿主旋转后须相应转换预期轴。普通 rigid_transform 仍要求右手系；两次镜像最终为右手时按实际目标使用 rigid_transform，不因历史发生过镜像就套 mirrored_transform。

通过只说明最终变换满足目标，不能证明镜像后非对称构件、正反面或纹理朝向正确；这些需实际视图/局部检查。


## 返回通道修复（2026-09-07）

旧版把 JSON 字符串交给桥接 `result_inspect`，该调试字段在 10,000 字符处截断；大量实例会得到无法解析的字符串。新版只读工具在已有 stdout 捕获通道输出带本次随机标识、字节数及 SHA256 的 Base64 帧，MCP 校验完整性后返回普通 JSON；Ruby 表达式返回 nil，避免同一数据又被 inspect 一遍。不修改桥接插件，不需要重启 SketchUp。

- `transport.complete=true` 仅表示本次传输完整，不是遍历完整或验收通过。`truncated=true`、`truncation_reasons` 原样保留；达到 max_instances/max_depth 等上限仍须缩小 scope 后重新读取，不能抹掉标志。
- 无有效帧、重复帧、损坏/截断、身份/范围不符、JSON 非法均报错，不回退解析旧 result_inspect，也不以空列表伪装成功。
- JSON 传输上限 32 MiB，超限报错并要求缩小范围，不静默剪裁。需要完整数据时将整个 MCP 返回 JSON 保存到工作区，再读概要/筛选目标家族；界面显示的文本预览被折叠/裁剪不能据此拼接测量。
- 本次变更覆盖 server.js 和新增 instance-readback-transport.js。只更新磁盘服务器；常驻进程需自然重载，新建服务器进程即读取新版。不要为更新终止正在建模的 SU 或修改别人的活动文档。
- 离线验证覆盖真实 server 路由（桥接替身）、超过 10,000 字符及 1 MiB 的 Unicode 数据、损坏/重复/缺失帧、身份/范围错误与真实遍历截断标志保留。未在活动 SU 运行新版端到端测试，不把替身测试声明为现场验收。
