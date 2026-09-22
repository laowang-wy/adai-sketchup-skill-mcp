# 参考图与当前成果：保留原图，按问题比较

`sketchup_project_retry_evidence`负责当前成果采集。新expert默认参考相机一张，模型可选择`views`中的reference、perspective、front、side、plan、underside；图数不代表覆盖，必要的空间/背面应实际查看。

图像辅助已接在封存之前：全图并排、EXIF方向、原始尺寸、共同显示比例与面板映射写入审查附件。默认不配准、不自动warp、不裁掉画外误差，没有建筑相似度通过分数。

当前疑点需放大时，可一次提供`comparison.regions`，例如：

```json
{"regions":[{"name":"roof","source_box":[0.2,0.1,0.8,0.5],"candidate_box":[0.2,0.1,0.8,0.5]}]}
```

坐标为EXIF纠正后图像的归一化0…1区域；不得越界或零像素。保留全图入口，局部结果不代表全楼。无需每次裁图；程序输出文件、映射和hash，不让模型重抄。

仅已确认相同像素画幅且确实可比时设置`comparison.aligned=true`，产生叠图/差分辅助。它只是调用方的配准声明，不是程序证明相机一致；相同像素尺寸也不证明透视可比。不得调镜头或自动裁切让差分变小。

可选独立复核用`status(section=review_packet,question=具体问题)`得到原始条件引用、当前证据和缺口，按需要读取。不会自动创建第二个Agent，不复制所有历史，不把packet成功当审核通过。

相机/窗口与实际SU渲染支持需要真机验证；工具只声明实际执行过的采集结果。只读status不捕捉、不保存模型。图片未看过，不得提交视觉pass。
