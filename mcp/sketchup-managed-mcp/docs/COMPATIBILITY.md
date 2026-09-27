# 版本与验证范围

当前主包为 **0.5.37**；构建见 [BUILD.json](../BUILD.json)，本构建与先前验证的关系见 [RELEASE.md](../RELEASE.md)。主包版本、古建工具版本、REF 版本分别维护。

| 环境或能力 | 当前范围 |
|---|---|
| Windows / SketchUp 2019 / Ruby 2.5.1 | 0.5.37 功能构建完成定向构造、取景、保存与公开入口重开；不等于全部参数和建筑来源质量通过 |
| SketchUp 2018 | 在适配目录中，本轮真机 not_run |
| SketchUp 2024/2025 | planned_not_implemented |
| 其他 SU 版本或第二台机器 | 需独立适配与验证，不能沿用 SU2019 的结论 |
| 独立强弱模型表现、token/费用收益 | 本轮 not_run |

`sketchup_runtime` 的能力目录说明已声明支持范围；`startup/status` 核对用户指定程序及实际实例，目录存在不等于验收通过。

新任务默认 guided，完整专家口令选择 autonomous；保存后的项目沿用自己的策略。参数与操作说明见随包 [Skill](../runtime-support/professional-sketchup-modeling/SKILL.md)、[引导操作](../runtime-support/professional-sketchup-modeling/references/guided-operation.md)及[专家操作](../runtime-support/professional-sketchup-modeling/references/expert-operation.md)。两种模式共用来源判断、文档/对象保护、事务、回执和未知结果恢复。

局部修改用现有 `step(operation_intent=update)`；无重复系统时可用 `task_profile.repetition=none` 表达任务范围。实际状态、可用动作和历史项目兼容以保存策略及工具返回为准。
