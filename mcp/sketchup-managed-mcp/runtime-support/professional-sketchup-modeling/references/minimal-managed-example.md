# 最小受管建模调用

这是调用方式，不是建筑模板；路径、尺寸、观察必须来自当前任务。

```text
sketchup_project_begin(mode=single_image,source_image=真实图片,
  output_directory=输出目录,task_text=原始任务)
→ 依 task_card.construction_brief 组织完整主形
→ sketchup_project_step(project_id,ruby_file=已写入的绝对路径)
→ 用宿主图像工具实际查看返回证据
→ sketchup_project_review(project_id,evidence_id,verdict,
    visual_review={state:pass|fail|unverified,
                   observations:实际观察,
                   inspected_views:实际看过的视图})
→ 修正或下一项 → ready_to_finish 后 sketchup_project_finish
```

也可用 step 的 `operations` 替代 Ruby；两者不能同时传。guided 替换当前阶段，expert 允许在实际受管单元内连续写入，再 `retry_evidence` 取证。新 expert 主形与代表构件各自确认，随后按建筑系统组织。

`visual_review` 是正常入口，机器检查由程序从封存附件组装，缺资料自动记未验证。兼容完整 `quality_review`，但不要求日常 Agent 抄写机器字段。主形包括定义性屋盖、主要开口及空间；单壳、计数或检查点不能冒充建筑完成。需要补充构造时看[受管 Ruby API](managed-ruby-api.md)。

用户提供多张图时，begin 传 `source_images:[<第一张绝对路径>,<第二张绝对路径>,...]`，逐张查看，保留用户提供的完整来源组。
