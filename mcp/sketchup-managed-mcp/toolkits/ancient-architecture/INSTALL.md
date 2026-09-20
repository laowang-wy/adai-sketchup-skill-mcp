# 安装标准化古建经验包
解压整个目录，勿单独复制MD或PY。先用底座developer-kit/pack_tool.py check检查。
知识：sketchup_ref(action=validate,path=本目录下ref-pack的绝对路径)，通过后import该目录。
工具：sketchup_toolkit(action=inspect,path=本目录绝对路径)，明确信任代码后register(trusted_code=true)。
若MCP已经内置同ID工具，直接使用内置版，不重复注册；同ID不会静默覆盖。知识包升级按显式import及overwrite处理，先保留公司定制内容。
一次安装总包；每次任务只读所需经验卡并调用对应工具。PACKAGE-GUIDE.md为说明，不安装成Skill。
标准manifest描述依赖和验证范围，不自动安装依赖或给真实SU验收盖章。
