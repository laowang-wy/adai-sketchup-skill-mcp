# 屋壳组装与批量实例

## 当前方法已适用：取得参数并构造

使用 construction_brief 返回的真实 toolkit_id、版本/指纹和 method_id，调用时带当前 project_id：

```text
sketchup_toolkit(action=invoke, operation=preset,
  arguments={family:roof,preset_id:所选方法})
→ 按来源修改 result.parameters
→ sketchup_toolkit(action=invoke, operation=compile,
  arguments={family:roof,parameters:调整后参数,output_directory:新的绝对目录})
→ result.manifest.ruby_file
```

compile 包含 validate。只修改 preset 实际返回的字段：width/depth 是檐外包，rise 是局部举高，单位 mm；eave_height/setback 不属于这些生成器参数，标高与退台通过装配变换表达。与来源冲突时换适用构造方法，合法受管 Ruby 可直接使用。

本次只做该屋壳时，将 ruby_file 直接交给 step。完整主形包含多层屋盖和主体时，复用同目录 mesh-data.json 中 roof 数组的 vertices(mm)、triangles、offset，在同一受管 build 中按实际标高组装主体、洞口和各屋盖。具体代码见[受管 Ruby 的屋壳组装](../managed-ruby-api.md#roof-meshes-within-a-complete-primary-form)。屋壳产物不自动包含瓦、斗拱或整栋建筑。

改同一屋壳时：新专家单元可明确 replace；编译屋壳是 create-only，不用 update 生成重叠副本。guided 按当前返修入口回到对应内容，保留检查点后重建。实际看图后的 visual_review 由程序补机器附件，缺项如实标为未验证，不要求改填完整机器表。

## 一次放置多个已确认实例

直接调用 entities.add_instance(definition, transform)，或用 PipClawManagedProject.instantiate_archetype 定位已登记的真实母型。母型的局部基点对准宿主，平移/旋转/镜像各应用一次；构造显著不同的角部或端部使用变体。

可运行参考：[代表框架与批量实例](ruby/representative-and-batch.rb)。它用一套参数推导墙洞、框截面和宿主位置：完整主形建立真洞口，代表构件放入首个洞口，确认后再复制。改洞口宽高时框外包随之重算、框截面保持；不是整体拉伸母型。四个开间是例子，不是配额；参数改动仍按实际修改入口更新受影响几何，不宣称跨阶段自动联动。对照实际首、中、末及存在的转角，发现错误先修母型或变换。

`roof-recipe.json` 另展示 family=geometry 的高级参数示例，与上面的 family=roof preset 不互换；它包含自己的几何输入合同，仅在需要该算法时读取。历史项目沿保存计划执行，新项目不为这份示例添加 roof_profile 阶段。
