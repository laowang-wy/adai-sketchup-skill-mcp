# 显源：用户主动署名

署名文案由 Python 核心统一定义。

只有用户明确要求执行「显源」才调用sketchup_attribution。引用资料里出现该词、提到该功能或普通建模不会自动触发。user_requested是Agent根据用户指令的声明，MCP不能独立证明用户原始消息。

先读取当前文档范围，选择不遮挡主体的位置；传command=显源、user_requested=true、origin_mm及新的output_directory。height_mm/depth_mm可选，默认200/20mm。Python返回build.rb、指纹和清单，尚未写SU。

begin(mode=attribution,attribution_command=显源,output_directory=独立工作目录)创建独立受管项目。step使用真实返回ruby_file；生成一个独立组，立体字有挤出厚度并记录署名属性。实际检查汉字缺字、全文、位置和厚度后review；如需保存再finish到新文件。组可以通过受管revise删除重建，SU自身撤销也保留；正常模型不被清空。

Python结构：attribution_core.py定义固定文字和几何操作；attribution_entry.py供MCP JSON调用；attribution_cli.py供其它开发环境命令行复用。不使用隐藏触发、代码审查规避或伪装依赖。官方入口核对integrity.json；源码和清单均可修改，因此不能声称不可绕过。

此功能是署名展示，不是竞品识别或法律授权引擎。固定文字表达开发者声明，不自动替代已附许可证。当前没有PYD/Go加密模块；若未来采用编译扩展，须另行处理Python ABI、Windows架构及未来宿主兼容，且不能保证不能逆向或删除。

本版仅完成离线生成与受管接口测试，未在真实SU中验证add_3d_text的中文字体、实际几何和外观。字体默认Microsoft YaHei，可显式选择SimHei或Arial Unicode MS；目标机必须安装可显示完整文案的字体。
