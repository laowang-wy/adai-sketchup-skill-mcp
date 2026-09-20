# 来源约束的古建样板工具

这是 AncientRoofKit 的补充入口。学习对象是用户指定的两个 SKP，导入真实构件网格与实例关系，保留原比例。它不把样板复用称作已经推导出通用古建构造法。

## 固定入口

在 AncientRoofKit 根目录执行（Python 3.10+、numpy）：

```powershell
python source_template_tool.py list
python source_template_tool.py preset --template changkong-layered --width-mm 1200 --output my-bracket.json
python source_template_tool.py validate my-bracket.json
python source_template_tool.py compile my-bracket.json --output my-bracket-build
```

输出目录必须尚不存在。修改 JSON 后重新编译，不让调用模型修改生成的 Ruby。编译文件内嵌全部源几何，不依赖运行中的 require 缓存，也不需要再次打开素材库文件。

## 可选择的样板

| ID | 来自哪里 | 支持的用途 |
|---|---|---|
| corridor-xieshan | 廊架古建，中央楼阁上层屋顶 G0366 | 保持源比例的歇山整组，含源瓦列、脊饰及檐下构件 |
| corridor-straight | 同模型 C0042 | 正身斗拱单件，或沿局部 X 方向等距排列 |
| corridor-corner | 同模型 C0044 | 转角斗拱单件；源拓扑独立，不能用正身旋转替代 |
| changkong-cross | 长空阁 C0730 | 低矮十字交叉斗拱样板 |
| changkong-layered | 长空阁 C0732 | 多层出跳斗拱样板；尚未认定历史制式或转角用途 |

视觉依据见 study/changkong-prototypes 和 study/user-corridor-prototypes。那些图是源几何分析图，页脚明确标注并非 SU 渲染。实际执行状态以 catalog.json 与 validation 中的本次 SU 记录为准。

## 参数合同

仅接受七个字段：schema、template、width_mm、origin_mm、rotation_deg、count、spacing_mm。

- schema 固定 ark-template-1；template 必须来自上述 ID。
- width_mm 是完整样板在源安装方向的 X 包围宽。按该宽度**等比**缩放三个方向；不是柱距、斗口或历史实测尺寸。Y 跨度和 Z 高度由源比例确定。
- origin_mm 是所有源几何的 XY 包围中心、最低 Z 点放置位置，单位 mm。它不是自动识别的柱头承托点。装到建筑上仍须核查承托与檐口接触。
- rotation_deg 绕 Z 轴旋转；只改变放置。
- count 默认 1，spacing_mm 默认 0。仅 corridor-straight 可 count > 1；间距至少为宽度的 1.02 倍，阵列沿样板局部 X 方向，整体再旋转。
- 不接受 depth、rise、gong_layers、scale_x 等额外字段。不能把非法字段删除后假装实现了请求。改变出跳层数、柱网角度或屋顶宽高比例，目前需另行建构造规则并验证。

## 受管验证与编辑

按 professional-sketchup-modeling 执行状态检查。编译结果目前限定 mode=test、ARKS_ 项目、massing 诊断阶段。取 manifest.ruby_file 调 sketchup_project_step；timeout_ms 与 CLI 超时均设为 manifest.recommended_timeout_ms。长任务后台运行，超过超时先核实原请求，不重复写入。

最终根组件以样板 ID 命名；内层定义保留源 ID 与源名，同一源构件使用共享定义。修改共享定义会影响其兄弟实例；只改一处时先 Make Unique。顶层根保存参数和源哈希。

必须实看透视、侧面及底面/承托细节。运行成功不证明结构安全，也不证明历史制式正确。当前工具不是无需审查的最终 SKP 交付入口。

## 来源和局限

两个原 SKP 经读取前后 SHA256 对照，未修改。源网络保留面内孔（三角化）、嵌套变换和可编辑组件；每个局部坐标重新定心，父级变换只作用一次。自动测试逐顶点比较重建与原安装方向坐标，误差需小于 0.000001 mm。

暂未迁移贴图 UV、原材质、游离线及图片。三角网格保持可编辑，原面内部三角化对角线作隐藏处理；不保证源模型本身每件都闭合。原作者简化构件仍是简化件，不能自动变成施工级斗拱。

1200/900/6000 mm 等默认宽度是样板演示尺寸，绝非素材库实测建筑尺寸。来源绑定工具与 v4 六类程序屋顶并存，不能声称源歇山已经替换并验证了 v4 通用算法。

## SU 小面精度处理

C API 三角化会产生近乎共线碎片，编译器记录并剔除面积小于 1e-7 局部 mm² 或夹角正弦量级低于 2e-9 的碎片。具有面积的小瓦饰仍保留：Ruby 在 1000 倍局部坐标下建定义，再通过顶层统一缩放恢复尺寸。源网络原始数据不改动，manifest 记录清理片数；每个源定义的预期/实际三角面数不相等仍报错，不把丢面当成功。

第一次实测还修复了网格顶点编号问题：始终使用 SU PolygonMesh.add_point 返回值，不假定 SketchUp 按输入顺序保留所有顶点。

尺寸复查使用实际 SU 顶点叠乘父级变换后的世界包围范围；嵌套旋转组件的保守包围盒另外记录，不拿它代替几何尺寸。

## 0.2 放置验证补强

编译时会生成 placement_contract，记录每个实例的世界几何边界、中心、阵列方向和净间距。运行时从 SU 实际顶点逐件读回，任一坐标边界与预期相差超过 0.2 mm 即报错；同时检查所有阵列实例共享同一组件定义。检查覆盖平移、旋转与阵列，不再只在 count=1 且 rotation=0 时检查尺寸。

几何净间距沿样板局部 X 计算。它只是重复件间距检查；没有柱头、檐檩或承托面的输入时，不宣称宿主接触通过。示例与经验条目见 ../experience/README.md。
