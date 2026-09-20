# 源 SKP 层级与几何保真

使用时机：读取素材库并内化成可编辑工具时

源文件只读，绑定哈希；提取定义网络、内孔和全部实例变换，逐定义复用重建。

## 规则

- 使用 MeshHelper 三角化保留孔洞；外环派生图只作分析。
- 局部定义先定心，父级变换一次作用，旋转缩放不可遗漏。
- 明确未传递的材质 UV、游离线和历史构造未知。

## 检查

- 读取前后源 SHA256 一致。
- 逐顶点检查重建坐标与来源位置。
- 每个定义保留面数、清理记录和 live triangle 断言。

## 拒绝条件

- 把素材文件夹误认为模型工程目录
- 漏掉内孔
- 合成变换两次
- 把作者简化几何称为实物测绘

## 证据

- study/extract_source_network.py
- validation/source-files-final-hashes.json
- validation/source-template-tests.txt

入口：`source_template_tool.py`
