# 歇山封山、脊交汇和翼角切瓦

使用时机：通用歇山需要补齐山面和翼角收口

复用 experience/recipes/xieshan-detailed.json；compile 已包含参数校验；把返回的 ruby_file 提交到当前受管项目并做真实读回和视觉复核。

## 规则

- detailed 加入山面封板、曲边封檐、底枋、竖条和六个脊接头。
- 四翼角按毫米瓦宽排列，在斜脊边界裁切；切边封闭8mm厚度。
- 接头为闭合搭接件，山面为素面推定做法。
- 端裙坡仍使用原有收分瓦域。

## 检查

- 看两侧山面、翼角俯视近景和脊端。
- 所有新封饰和切瓦必须闭合，SU再次检查。
- 切瓦保留名义宽，顶点不越斜脊裁剪线。

## 拒绝条件

- 将 detailed 用到未支持类型
- 把素面件称为历史雕刻复原
- 删除退化面或闭合断言

## 证据

- validation/xieshan-details-v04/review.json
- validation/xieshan-details-v04/live-build-result.json
- v4/cut_tiles.py
- v4/detail_geometry.py
- validation/details-v04-tests.txt

入口：`roof_tool.py`
