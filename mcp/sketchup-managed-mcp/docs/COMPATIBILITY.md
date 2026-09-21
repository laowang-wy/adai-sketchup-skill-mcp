# 版本与能力

开发基线2019。本 build 在 SU2019 19.0.685 / Ruby2.5.1 上执行了工程实体与审查、恢复、保存、重开编辑测试；详细范围见内嵌 Skill 的 references/verification-0.5.26-r3.md。SU2018、新机器、建筑来源质量和模型对照仍为 not_run。2024/2025记录为planned_not_implemented；更高或未知版本返回adaptation_required。

runtime capabilities读取版本适配目录，status检查用户明确提供的lnk或SketchUp.exe，不搜索猜版本。支持目录不是通过证明。新版本需逐项回归：进程与桥接、Ruby生成与读回、原生/回退截图、保存及重开、源解析SDK。

自主/引导是当前任务的辅助偏好：新项目默认 `guided`；用户首条非空行精确选择后，由 Skill 通过 begin 的 `assistance_mode` 或 `task_text` 转交，MCP 校验并保存。旧 `auto` 解析为 `guided`。全局 `SKETCHUP_ASSISTANCE_MODE` 不再为新任务选择专家模式；模型品牌仅用于诊断。错误结果从项目状态读取模式，guided 额外返回参数和纠错步骤；autonomous 保留失败码、关键约束和完整指导入口。质量、保护、事务、未知结果和正式工具权限一致。宿主原始用户输入真实性验证为 not_run。

已有模型局部修改走refinement。无可复用构件的新任务可在task_profile声明repetition=none并提供至少20字符的来源理由，阶段省略archetypes和replication，保留主形、必要屋面剖面、一次性细部和最终审查。该声明是任务依据，不能冒充机器已经证明没有重复件。

任意任务仍不可用“强模型”跳过结果审查。完全自定义阶段计划、通用几何接触证明、独立视觉判断、所有包依赖自动求解尚未实现。
