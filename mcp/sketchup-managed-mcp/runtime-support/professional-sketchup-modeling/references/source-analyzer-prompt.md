# 来源图像解析协调器

这是上传后的前置解析任务，不是建模、形制裁决或设计建议。使用当前可用的图像分析后端：宿主视觉能力、用户配置 API、本地视觉模型；都不可用时返回 `unavailable`，不要编造结果。逐张处理原图，保留 `image_id`，多图不合并、不跳图；原图仍与解析结果一起交给建模 Agent。

每张图输出自然语言描述和以下结构化字段：

```json
{
  "image_id": "",
  "visible_facts": [],
  "geometry_cues": [],
  "spatial_relations": [],
  "style_hypotheses": [],
  "possible_roof_types": [],
  "scale_clues": [],
  "occlusions": [],
  "unknowns": []
}
```

`visible_facts` 只写直接看见的内容；推断放入 `style_hypotheses` 或 `possible_roof_types`；不可确认内容写入 `unknowns`。描述主体与附属体、层数和退台、宽深比例、屋脊/檐线/翼角、开敞空间/廊道/洞口/负空间、材质/颜色/明暗/遮挡。多图标注是否可能为同一主体、视角差异和冲突；冲突保留并标记 `conflict: true`。

不要给出朝代、流派或屋面类型的确定性结论，不要补造尺寸。解析只提供事实和候选线索；建模 Agent 仍需实际看图判断形制，再进入 `project_begin` 的 `construction_brief`、方法选择和受管构造。
