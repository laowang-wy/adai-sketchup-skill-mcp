# 柱头—斗拱—檐梁实际承托面

使用时机：将独立斗拱放到柱头或连接檐梁时

先运行 bearing_tool.py inspect，确认源几何具有可识别承托面，再生成仅用于接触验证的柱—斗拱—梁样段。

## 规则

- 底座中心从源底部平面测得，不等于整个斗拱包围盒中心。
- 当前仅识别由两片三角面组成的极值水平矩形垫面；其他面型明确拒绝，不自动猜承托点。
- 柱和檐梁是演示宿主，尺寸按测得垫面与明确输入推导，不声称复原源建筑木构。
- 面积范围与逐点接触是几何证据，不是结构安全或历史制式认证。

## 检查

- 每个指定垫面采用9个内点，分别从真实SU柱/斗拱/梁表面计算高度差。
- 只接受两侧都有真实面覆盖且高度差不超过0.03mm的采样。
- 看侧面和底座近景；自动拒绝不能明确识别的源面。

## 拒绝条件

- 仅用整体包围盒中心放柱
- 只有AABB重叠就声称接触
- 借自动装配掩盖未知的构件做法

## 证据

- bearing_tool.py
- bearing/managed_bearing.rb
- validation/bearing-v03/tests.txt
- validation/bearing-v03/review.json
- validation/bearing-v03/live-build-result.json

入口：`bearing_tool.py`
