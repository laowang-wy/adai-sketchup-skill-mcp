# 受管类型化操作（毫米）

`sketchup_project_step(project_id, operations=[...])`。与`ruby_file`互斥；同一批在同一个受管事务内执行。默认当前建筑系统，可选`work_unit_name`命名或选择已有`work_unit_id`。`operation_intent`默认`append`，也支持`update`、明确的`replace`。程序绑定范围和回执；不需要另外提交登记表。

专家可在授权工作单元内追加、更新或替换。guided 也可使用同一接口减轻重复 Ruby，但仍按当前阶段替换：批内只能引用前面已创建的对象，不能借此修改旧阶段或跨阶段对象；需要更新旧对象时继续走 guided 的返修/阶段入口。

| op | 必要字段 | 可选字段/含义 |
|---|---|---|
| box | id, size_mm:[X,Y,Z] | origin_mm:[X,Y,Z]，component:true生成真实组件原型 |
| wall | id,width_mm,height_mm,thickness_mm | origin_mm，openings数组；墙沿X、厚度Y、高度Z |
| set_wall_openings | target,openings | 替换该参数墙的洞口定义，保留墙组身份；原有参数窗框随同名洞口更新，删除洞口则删除所属框 |
| window_frame | id,wall,opening | frame_mm/depth_mm默认60，recess_mm默认0；矩形四边框，真实墙洞，不生成未要求的玻璃 |
| instance | id,prototype | origin_mm；prototype必须是真实组件；不重画重复件 |
| translate | target,delta_mm | 当前父坐标系中的平移；共享父定义的歧义目标拒绝 |
| material | target,rgb:[0…255整数] | alpha:0…1；作用于目标实例/组，不修改共用旧材质 |
| mesh | id,vertices_mm,triangles | 零基三角索引、真实闭网格；复杂几何优先已有生成器文件 |

`id/target`是单元内有意义的稳定构件名，由同批输入复用，不是后台PID抄写。最多128个操作是传输资源限额，不是建筑质量或阶段要求；大模型用多次调用或已有生成器文件。

洞口形状：`{id,x_mm,z_mm,width_mm,height_mm}`。矩形洞需留墙边和墙顶，门洞可触底；重叠/相触洞应先合并合理边界或使用自定义构造。范围不合法会回滚本次事务，不损坏之前成功的操作。

```json
{
  "project_id":"从begin返回的项目ID",
  "operations":[
    {"op":"wall","id":"wall","width_mm":5000,"height_mm":3200,"thickness_mm":200,
     "openings":[{"id":"window","x_mm":1200,"z_mm":900,"width_mm":1500,"height_mm":1500}]},
    {"op":"window_frame","id":"window_frame","wall":"wall","opening":"window","frame_mm":60,"depth_mm":80,"recess_mm":40}
  ]
}
```

连续修改不切阶段：对`wall`用`set_wall_openings`更新参数，再按需取证查看。复杂曲面或其他构造调用现有经验包生成器，或者提交`PipClawManagedBuild.build(entities,context)`；`context['phase_group']`在新专家项目表示当前真实单元。该API兼容名不意味着只准构造某个旧阶段。

系统之外、锁定对象、未经接受的用户手改受保护。当前提供单元级范围，不宣称任意拓扑补丁或跨单元共享定义编辑已开放。源码结果和几何数据不等于图像一致性通过，仍需看图和实际核对。
