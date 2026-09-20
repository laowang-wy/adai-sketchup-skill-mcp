# 配方使用约定

先复制需要的JSON；仅调整其中已有字段。所有长度mm，输出必须是新目录。

- `xieshan-detailed.json`：本轮通过实机检查的通用歇山比例，detailed包含封山、脊接头与四翼角切瓦。
- `helmet-source-informed.json`：来源约束盔顶候选，尺寸与曲线的推定边界见 study/helmet-source。
- 其他JSON沿用各自 schema；ark-template-1 用 source_template_tool.py，schema_version=4 用 roof_tool.py。

完整檐口的参数入口是 `python eave_tool.py --width-mm 1200 --output work/eave`，允许900—1800mm，固定长空阁layered源样板；不要自造JSON字段。

编译成功只是得到受管Ruby。按根目录PACKAGE-GUIDE.md完成SU生成、实际视图检查和回执读回。若要将样段装配到整栋建筑，重新审查放置、邻接和转角，不直接复制“已验证”标签。
