
# 古建工具与经验包指南

当前 MCP 发行版 0.5.33；来源算法 0.4，经验包 0.4.2，可执行工具包 0.4.5。经验包内的 REF 1.3.0 与 MCP 默认随附 REF 1.4.0 为不同副本，以实际读取路径及版本为准。

先读 `roof-types.json` 与 `experience/README.md`。六类基础屋壳均有独立算法；最新运行范围以对应 review.json 为准，不能把闭合网格等同古制还原。

唯一通用屋面入口 `roof_tool.py`；不要调用旧 ancient_roof_generator.rb。源SKP斗拱/屋顶入口 `source_template_tool.py`，源承托面检查 `bearing_tool.py`，完整檐口样段 `eave_tool.py`。

当前任务只加载对应经验卡：

```powershell
python experience_tool.py show xieshan-closures
python experience_tool.py show full-eave
python experience_tool.py show helmet-provenance
python experience_tool.py check
```

## 无需重写Ruby的直接调用

```powershell
python roof_tool.py validate experience/recipes/xieshan-detailed.json
python roof_tool.py compile experience/recipes/xieshan-detailed.json --output work/xieshan
python roof_tool.py compile experience/recipes/helmet-source-informed.json --output work/helmet
python eave_tool.py --width-mm 1200 --output work/eave
```

输出目录必须新建。参数变化后重新编译，禁止手改生成的 build.rb。屋面编译器一次只接受一个 tiled/detailed 屋顶，最多230000展开面。

屋面细节：shell / ridge / tile_sample / tiled / detailed。detailed 仅支持歇山和盔顶。歇山含两山面素封板、曲边封檐、底枋、竖条、六脊交点和四翼角实际切瓦。盔顶含来源约束八站母线、四曲脊、六珠简化宝顶。其他四类不自动获得这些细节。

## 参数边界

schema_version=4。width/depth是最外檐口尺寸mm；rise从中檐口上表面Z=0至脊/冠顶；thickness竖向向下。ridge_length仅歇山/庑殿/简化四坡非零。gable_span_ratio与apron_rise_ratio仅歇山自定义。corner_lift是角部抬升。sides仅攒尖4/6/8，其余4。参数字段须完全匹配，不猜字段。

全铺瓦沿曲面采样；detailed歇山四翼角保持固定名义瓦宽后裁切，端裙坡仍收分。接头有意搭接，非布尔融合。素面封饰与六珠比例为推定做法，不宣称历史雕刻、施工图或岳阳楼实测。

## 受管执行和审查

按本机 professional-sketchup-modeling Skill核对文档、桥接和真实渲染状态。屋面编译结果可直接用于当前受管项目的 `project_id`（无需测试前缀）；step 仅提交返回的 `ruby_file`，timeout_ms=300000。输出Ruby内嵌几何，不依赖SU常驻require缓存。

古建屋面路线可在当前项目的 `massing` 步骤执行；它不是只供测试项目的诊断脚本。不能冒充整栋项目finished。review_required后打开实际透视、两向立面、檐下及问题近景。超时先检查原请求和项目状态，禁止并发写入或盲目重放。检查点含旧隐藏项目与人物，不是纯净最终SKP。

## 失败处理

FIELD_MISMATCH：修正拼写或用preset生成完整字段。HEIGHT_CHAIN/APRON_LIFT_CONFLICT：修正尺寸，不删断言。DETAIL_FAMILY_NOT_IMPLEMENTED：换支持的细节级。TILE_BUDGET_EXCEEDED：缩小样段或合理增大瓦尺度。NOT_MANIFOLD/LIVE_EDGE_INCIDENCE/NO_LIVE_CONTACT_SURFACE：停留当前阶段修正，不给通过。

## 来源模板与完整檐口

源模型模板见 source_templates/README.md：只等比缩放、完整变换、已验证正身阵列；不猜层数、转角或任意柱网。

完整檐口见 eave/README.md。长空阁layered宽900—1800mm，柱高1800、梁高180固定。135点接触测试覆盖柱—斗拱—梁—椽—望板—屋面基层，仅指定承托面的采样，非结构安全或全模型碰撞证明。

## 来源深化与验证

盔顶 sources.json 与 profile.json 分开公开文字和推定剖面；未找到确认的盔顶源SKP。不能声称来源三维实测。

最新证据目录：validation/xieshan-details-v04、validation/eave-v04、validation/helmet-source-v04。数值回归：v4/test_roofs.py、v4/test_details.py、source_templates与bearing测试。经验包只交付工具、配方及诊断证据；整栋岳阳楼不在本轮范围。

