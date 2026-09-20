# 源歇山：正身、山面和翼角

使用时机：用户要求廊架古建中央楼阁式歇山

使用 corridor-xieshan 还原已提取组件网络。源正身瓦带沿主坡平行排列，转角采用独立构件。

## 规则

- 保留长正脊、上部山面、侧坡和翼角的不同区域。
- 从 G0366 复用整体；源瓦带 C0029/C0030 不能直接声称为施工级单瓦。
- 本样板包含源脊饰与檐下结构；通用生成器不因此获得这些细节能力。
- 0.3另有通用歇山分区改进：中央平行、翼角收分，仍非源样板自由变形或最终历史还原。

## 检查

- 实际查看透视、山面和檐下。
- 核对瓦列方向与山面交接，不仅统计面数。

## 拒绝条件

- 将全宽瓦列汇聚到短正脊
- 把小双坡放到巨大四坡裙上并直接认可

## 证据

- study/user-corridor-findings.md
- validation/source-corridor-xieshan-d/review.json
- validation/xieshan-parallel-v03/review.json

入口：`source_template_tool.py`
