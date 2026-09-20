# 柱斗拱梁—椽—望板—屋面连接样段

使用时机：将已测承托面扩展为完整檐口层次

python eave_tool.py --width-mm 1200 --output work/eave；受管 ARKS_Eave 前缀诊断。

## 规则

- 仅长空阁 layered 源斗拱，宽900—1800mm；柱高1800、梁高180固定。
- 五根椽共享剖面站点；缺口平面接触梁顶，外肩5mm斜切。
- 望板下表面复用椽顶站点；望板25mm，屋面基层50mm。
- 单梁悬挑样段仅用于接触和层次诊断。
- 135点证据来自A轮；B轮仅瓦片边线平滑，取证超时，禁止称B轮已签名通过。

## 检查

- 柱斗拱、斗拱梁、梁椽、椽望板、望板基层共15组135个真实 SU 面采样点。
- 每侧均有真实面覆盖，误差限制0.03mm。
- 查看侧面和檐下，不以包围盒代替接触。

## 拒绝条件

- 未经研究自动转成转角样板
- 要求任意斗拱自动套接
- 将样点通过声称为结构验算

## 证据

- eave/managed_eave.rb
- eave_tool.py
- validation/details-v04-tests.txt
- validation/eave-v04/review.json
- validation/eave-v04/live-build-result.json

入口：`eave_tool.py`
