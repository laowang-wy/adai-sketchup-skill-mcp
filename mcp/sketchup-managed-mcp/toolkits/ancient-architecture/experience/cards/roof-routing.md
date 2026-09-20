# 屋顶类型与路线选择

使用时机：需要新建或修改古建屋顶时

先判断需要源样板保真复用，还是改变比例的通用屋壳。源样板使用 source_template_tool.py；通用屋面使用 roof_tool.py。

## 规则

- 源歇山只接受等比缩放，不能用 width 之外的字段强行改造。
- 六类名称代表算法入口；不代表岳阳楼或历史形制验收。
- 只有双坡剖面证据时，不外推为歇山、庑殿或盔顶。

## 检查

- 确定正脊、山面、翼角与檐线是否符合当前来源。
- 先检查屋壳，再启用ridge、tile_sample、tiled；歇山/盔顶可调用detailed配方。

## 拒绝条件

- 源样板和通用算法混用却未记录来源
- 用铺瓦遮掩主形缺陷

## 证据

- study/findings.md
- validation/xieshan-defect.json
- source_templates/catalog.json

入口：`roof_tool.py`
