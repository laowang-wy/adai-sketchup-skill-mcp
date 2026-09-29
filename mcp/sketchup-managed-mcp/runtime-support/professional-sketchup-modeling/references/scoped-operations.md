# 构造与局部修改（毫米）

`sketchup_project_step(project_id, operations=[...])` 或 `ruby_file`：一次受管事务，程序处理对象保护、回执与恢复。

新建：guided 按当前阶段替换，同批对象可互相引用；expert 默认追加到当前建筑系统，也可明确整组 `replace`。

局部修改：两模式都用 `operation_intent="update"`。typed 操作从 `target/wall` 自动取得范围（expert 需同时提供 `targets` 才启用定向范围，否则沿原单元更新）；Ruby 提供 `targets`，在 `context['edit_targets']` 取得真实对象。同一容器可同时修改多个相关对象，其他构件受保护。guided 核对后回到原进度，不清空后续阶段。

## 找到原对象

已有构件 ID 可直接用；不知道 ID 时调用 `sketchup_project_geometry_diagnose(project_id,query="栏杆")`。名称只检索，返回的 `target` 才用于修改。返回包含所在容器、持久 ID、局部/世界变换和共享定义数量。每页最多 20 项，用 `offset` 续读；不是全模型审计。

`targets` 接受现有 typed ID、geometry semantic_id、`pid:123` 或返回的 `path:根PID/容器PID/…/对象PID`。重复内部 PID 必须用实例路径；无标签的成熟 Ruby 构件同样可定位。

## 常用动作

| op | 必要输入 | 行为与可选输入 |
|---|---|---|
| box | id, size_mm:[X,Y,Z] | origin_mm；component:true 创建真实组件 |
| wall | id,width_mm,height_mm,thickness_mm | origin_mm、openings；X 长、Y 厚、Z 高 |
| update_wall_opening | target,opening,changes | 只修改指定洞的 x_mm/z_mm/width_mm/height_mm，保留其他洞口；关联窗框跟随，截面不拉伸 |
| set_wall_openings | target,openings | 明确替换全部洞口；删除洞口时删除所属框，保留墙组 |
| window_frame | id,wall,opening | frame_mm/depth_mm 默认 60，recess_mm 默认 0；真实四边框 |
| instance | id,prototype | origin_mm；同一真实定义的实例 |
| translate | target,delta_mm | space 可为 world/parent；定向更新默认 world，原单元操作默认 parent |
| rotate | target,axis:[X,Y,Z],angle_degrees | pivot_mm 可选，默认目标原点；space 同上 |
| material | target,rgb:[R,G,B] | alpha 可选；新建/复用颜色材质并赋给目标，不改共用旧材质 |
| mesh | id,vertices_mm,triangles | 零基三角索引，闭合网格；复杂曲面也可用现有生成器/Ruby |

例如只加宽左洞并移动，不需要重发其他洞：

```json
{"project_id":"已有项目", "operation_intent":"update", "targets":["wall"],
 "operations":[{"op":"update_wall_opening","target":"wall","opening":"left",
 "changes":{"width_mm":1800,"x_mm":900}}]}
```

洞口完整定义为 `{id,x_mm,z_mm,width_mm,height_mm}`。洞口须留墙边和墙顶；门洞可触底。无原始参数的普通几何不冒充参数墙，可用定向 Ruby 在目标组内重建形体。

## 共享与实际范围

移动/旋转/赋材质只作用于目标实例，不拆定义。定向 Ruby 默认 `edit_scope="instance"`，内部改形前程序使选中组件定义独立；组/组件身份保留。明确修改同类母型时用 `edit_scope="definition"` 和 Ruby，程序核对并覆盖当前项目、同容器中的全部关联实例。组件内部边面不保证永久身份。

当前一次定向更新限一个已有容器（可含多个目标及墙窗关联）；跨容器按容器分次提交。共享父定义内部的嵌套目标暂不自动拆分父定义，会在写入前说明；可选择外层实例，通过定向 Ruby 修改其内部。导入的普通 SKP、跨项目母型修改尚未开放。

## 观察与接续

guided 返回当前证据，实际看图并 review；拒绝保留几何，接着修目标或明确替换整阶段。expert 可连续修改后合并取图审核。已提交但取证失败只补取证，未知结果查询原回执。完成后明确续改使用同一入口，程序保留旧交付/审核并选择新文件名；没有新请求时 finished 仍无下一动作。
