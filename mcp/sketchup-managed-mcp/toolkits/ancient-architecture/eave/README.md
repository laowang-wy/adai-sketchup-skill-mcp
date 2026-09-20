# 完整檐口连接样段

```powershell
python eave_tool.py --width-mm 1200 --output work/eave
```

宽900—1800mm。固定长空阁多层斗拱，柱高1800mm、梁高180mm。输出 build.rb、data.json、manifest.json；输出目录必须新建。受管 mode=test，project_id=ARKS_Eave_...，step 使用返回的 ruby_file，timeout_ms=300000。

源斗拱保留定义网络。五根椽复用剖面站点，缺口坐实梁顶，外肩5mm斜切。望板25mm、基层50mm，瓦片独立厚度。宿主尺寸是推定诊断参数，非源建筑榫卯测绘。

原承托36点、新增99点，共15组135个真实SU面接触样点。必须读回执并看侧面与檐下。单梁悬挑样段不等于整栋木构；瓦片搭接未做全空间碰撞分析。
