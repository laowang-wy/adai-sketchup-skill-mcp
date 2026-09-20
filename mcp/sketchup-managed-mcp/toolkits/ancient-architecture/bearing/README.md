# 承托面工具（第一阶段）

入口为根目录 bearing_tool.py。inspect 只读工具已提取的源网络，不修改源SKP。它寻找最高/最低处由两片三角面组成的轴向矩形；未识别时给出明确拒绝原因。

当前已通过真实SU验证：changkong-layered，演示宽1200mm，柱高1800mm，梁高180mm。以底座中心落柱、三个最高矩形垫面放梁。36个内点通过真实面覆盖及不超过0.03mm的高度差检查。

此处柱、梁是诊断几何，尚未建椽、望板、瓦面及完整柱网。不能将它称为施工做法或岳阳楼实测装配。其他宽度/家族仍要重新编译和受管验证。

```powershell
python bearing_tool.py inspect --template changkong-layered --width-mm 1200
python bearing_tool.py compile --template changkong-layered --width-mm 1200 --column-height-mm 1800 --beam-height-mm 180 --output work/seat-example
python bearing/test_bearing.py
```

若返回 NO_UNAMBIGUOUS_RECTANGULAR_EXTREME_SEAT，说明这个限定识别器不能确定该样板承托面。需要查看来源构造与实际平面，而不是关闭断言、使用包围盒底面或任意移动构件。
