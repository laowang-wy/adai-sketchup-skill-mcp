# 0.5.29 新增硬阀对照审计

日期：2026-09-23

## 基线

对照包：

`C:\Users\Administrator\Downloads\SU-SKILL-MCP-Plain-20260908\SU-SKILL-MCP-Plain-20260908`

运行包：`mcp/sketchup-managed-mcp`

静态对照不是把旧包当成“正确形态判定器”。旧包已经具备投影摘要、反薄片体量、原型真实几何、真实组件复制、可见细部、一次性细节、生命周期限制和分阶段审核；这些保护在新包中继续保留。旧包本身也没有照片相似度自动判定，不能把这些门禁解释成形态验收。

## 本轮识别

### 保留的原始保护

- 来源图和单图投影主体登记。
- 体量审计中的反薄片/细长体提示。
- archetype 的实际几何和真实可复用原型。
- replication 的真实实例、定义一致性、数量和当前对象身份。
- 可见细部与一次性细节的实际对象读回。
- Ruby 生命周期限制、受管事务、对象绑定、回执、证据文件完整性和当前模型读回。
- guided 的阶段路线与 `revise_from` 回退；autonomous 的工作单元、范围指纹和当前成果审核。

这些是建筑来源、真实对象或安全边界，不能因为它们让流程变长就删除。

### 新增但只检查“脚本长什么样”的门禁

1. `ADAI_COMPILED_PHASE` 注释必须等于当前阶段。
2. 古建脚本出现 `upturn` 时，源码还必须出现三个控制字段名。
3. refinement 的 `primary_corrections` 必须在源码中出现 `register_primary_correction`。
4. 古建 guided 阶段必须返回 `roof_control_contract`，并把字段完整性当作继续条件。
5. 0.5.28 新增的 `requireActual:true` 把可见细部登记再升级为“必须有可计数实例”。

这五类不能证明屋面、轮廓、负空间或修正目标真的正确。它们会让模型补关键词、补登记、补返回字段或补简单实例来过流程，正是“流程看起来完整”而不是建筑判断。

## 修改

- 删除前三个源码关键词/注释拒绝。
- `roof_control_contract` 保留为可选构造线索和诊断结果；缺失或不完整时返回 `ROOF_CONTROL_UNVERIFIED` 提示，不再阻塞 step。真实 SU 读回、来源对照和视觉审核仍然有效。
- 可见细部仍核对登记映射和任务要求；live instance 数量改为可选诊断，不再作为通用交付硬阀。
- 同步修改两份相同的 `geometry-guard.md`，把 contract 说明改为诊断性要求；没有把 guided 阶段改成自由跳过，也没有删除原始注册和对象保护。
- 没有删除 replication 的 PID/定义/放置一致性检查，也没有删除证据、回执、绑定或事务门禁。

## 构造能力恢复

原始包中真正有帮助的 `references/ruby-snippets.md` 已恢复到 Skill 和 MCP runtime 两处，包含受管范围内可复用的 `ai_box`、带门窗洞口的 `ai_wall`、楼板、门扇、朝向构件、材质和实体生命周期处理。旧的保存/开文档/直接事务方式没有恢复。Skill、guided 和 expert 只在需要自定义 Ruby 时定向读取该文件，不把它变成每个任务的必读材料。

## 反例与正例

新增回归覆盖：

- 阶段注释与实际调用阶段不同：不再因注释阻塞。
- 古建脚本包含 upturn 但没有字段名：不再因词法扫描阻塞；仍需真实几何和审核。
- refinement 脚本不写登记关键词：不再因源码关键词阻塞。
- 古建 guided massing 缺少 contract：返回 advisory，不抛硬错误。
- 原始 archetype/replication 注册门禁仍分别拒绝缺少 `register_archetype`、`instantiate_archetype` 的脚本。
- 现有全量回归继续覆盖对象、证据、事务、恢复、来源尺寸和公开入口。

## 测试

命令：

`node --test engineering/tests/*.test.cjs`

结果：**60/60 通过**。

恢复的 Ruby 片段另取出 9 个 `ruby` 代码块运行 `ruby -c`，**9/9 通过**；这只是语法检查，不代表已经在 SU2019 中执行。

`git diff --check`：通过。

本轮没有把离线测试替代真实 SketchUp 视觉验收；尚未重新运行完整黄鹤楼实机建模，也没有宣称新包已经证明照片相似度。下一次实机重点应观察：去掉这些代理硬阀后，模型是否把时间用于屋面曲线、檐线、层间比例和开敞空间，而不是补登记字段。
