# 配方与同阶段批量示例

这是两个独立工程小样，不代表客户建筑或古建形制验收。项目 ID、输出目录和来源说明须替换；输出用新的绝对目录，不能覆盖旧产物。尺寸单位为 mm，SketchUp 2019 可运行。

## 屋盖：直接使用现有 shell 配方

1. 读取一次 [roof-recipe.json](roof-recipe.json)，按真实任务修改 `project_id`、`phase`、来源和控制参数。示例为 12000 × 9000、rise 3200 的 wu_dian shell；它不是所有特殊屋面的替代方案。
2. 调用 `sketchup_ancient_tool(action="compile", family="geometry", parameters=<该对象>, output_directory=<新绝对目录>)`。compile 已包含校验，不必为同输入再调 validate；单独诊断仍可使用 validate。
3. 直接把返回的 `result.manifest.ruby_file` 交给 `sketchup_project_step(project_id=..., ruby_file=...)`。不读回整个 parts.json、不重写生成 Ruby、不补注释绕过预检查。项目先通过 `sketchup_project_begin` 建立；示例可选 freeform、features=["curved_eave"]、repetition="none" 并说明没有复制系统。massing 与 roof_profile 分别编译对应阶段，阶段边界仍须审查。
4. 查看 step 返回的真实全景、剖向和底部近景。存在已封存的自动测量附件时，`sketchup_project_review(..., verdict="continue", visual_review={state:"pass", observations:<实际观察>, inspected_views:[<实际看过的返回图片路径>]})` 自动运行机器检查。未检查图片不能填 pass；缺少数值附件时用完整 quality_review 明确未知项。step 的 checkpoint 是可编辑 SKP 阶段副本，不等于最终建筑交付。
5. 合法尺寸变体：rise 改为 3500，并同步 ridge_profile 和 corner_lift_section 中对应脊高。单独新项目，或通过 `sketchup_project_revise_from` 回到受影响阶段，再编译到新目录并重建、重审。不要把两张重叠的同位 shell 当作变体验收。
6. 非法反例：width=-1，或删除 source_evidence；compile 必须失败，不应进入 step。

几何、语义 ID、真实实体读回和依赖附件由程序生成。仍需人工判断来源和形态；示例不包含瓦件、斗拱、历史形制或完整建筑交付。没有匹配 recipe 时继续用受管自定义 Ruby。

## 重复框架：一个原型，三个额外实例

文件：[representative-and-batch.rb](ruby/representative-and-batch.rb)。用独立 cad 工程项目，按 source_alignment → archetypes → replication 依次把同一个文件交给 step；每阶段查看真实图像并 review。不要跨过原型审查。

source_alignment 建工程基座；archetypes 建两根立柱与一根横梁，转换为真实 ComponentInstance，注册 frame 原型以及立柱、横梁两个实际可见系统。replication 在**一次 step** 中循环现有 `instantiate_archetype`，使用 x=2500、5000、8700 的变换，末个做 X 镜像。最后一个镜像的实体占据 x=7500..8700。

成品计数为 **4 个框架 = 1 个代表原型 + 3 个额外实例**。replication audit 的 actual_instances 是 3，不包含原型。全部保持共享 Definition、独立真实路径和可编辑关系；expected_transform 记录每个预期变换，镜像不应误拒绝。

错位反例只在隔离测试副本执行：在 replication 创建完实例后，将第一个新实例再平移 `[0,150.mm,0]`，保留原 expected_transform。结构审计和 continue 必须拒绝；查看证据后可直接 `review(verdict="revise")` 撤回当前复制阶段，原型保持，再运行合法原文件。不要把错误位置写成新期望来通过。

接近现有限制时按现有受管阶段和资源规则处理；未知结果先查原 operation_id 并 reconcile，禁止整批重放。本例未提供绕过限制或一键整楼入口。
