# AncientArchitectureExperience 0.4

供弱模型直接调用的古建参数工具与经验包。先读 [PACKAGE-GUIDE.md](PACKAGE-GUIDE.md)，再选择一张匹配经验卡；不用重新猜曲线或编写Ruby。

本轮范围：歇山山面封饰、六处脊交汇、四翼角切瓦；长空阁承托样段连接椽、望板与屋面；盔顶来源与连续剖面深化。

```powershell
python experience_tool.py list
python experience_tool.py show xieshan-closures
python roof_tool.py compile experience/recipes/xieshan-detailed.json --output work/xieshan
python roof_tool.py compile experience/recipes/helmet-source-informed.json --output work/helmet
python eave_tool.py --width-mm 1200 --output work/eave
```

输出新目录。编译完成仍需本机受管MCP执行，并查看实际图和回执。`roof-types.json`是当前能力表；`experience/roadmap.json`列出本轮完成边界。12张卡、7个严格屋顶/源模板配方。

- [歇山检查](validation/xieshan-details-v04/review.json)
- [完整檐口说明](eave/README.md)
- [盔顶来源](study/helmet-source/README.md)
- [源SKP复用](source_templates/README.md)

所有屋面是独立可编辑网格/组件；源斗拱保留定义网络。细节是素面推定构件，非历史雕刻认证。完整檐口只验证指定接触样点；不等于结构设计或全模型碰撞验算。盔顶参数有来源说明，但没有已确认的盔顶实测SKP。

本包交付工具、配方及诊断证据。受管检查点SKP保留旧隐藏项目与人物，不作为纯净最终建筑模型交付；整栋岳阳楼不在本轮范围。
