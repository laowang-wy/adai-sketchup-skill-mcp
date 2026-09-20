# SU 小面精度、取证与失败恢复

使用时机：导入报索引、丢面、尺寸或超时错误时

用已内化的确定性处理排查；长任务只提交一次，等待明确回执与状态核对。

## 规则

- PolygonMesh 使用 add_point 返回编号。
- 小面在放大局部坐标建成后整体等比恢复，记录近共线碎片处理。
- 检查实际顶点几何范围；嵌套实例 AABB 只作参考。
- 超时并不代表未生成；先检查原请求及迟到回执。

## 检查

- 看真实 SU 图证，白图或被遮挡图不能验收。
- 保留用户现有文档，诊断检查点不是最终干净 SKP。

## 拒绝条件

- 超时盲目重放
- 删除断言以掩盖丢面
- 编辑受管状态冒充成功
- 将生成脚本称为成品 SKP

## 证据

- validation/source-import-regressions.json
- source_templates/managed_builder.rb

入口：`source_template_tool.py`
