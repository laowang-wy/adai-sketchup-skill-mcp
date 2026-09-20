# ADAI 工具包协议 1

任意开发环境均可编写本地经验包或工具包；协议不要求PipClaw。MCP经stdio暴露，宿主负责注册node launch.cjs，须将工作目录设为MCP资产根目录或使用入口绝对路径。可运行平台目前为Windows；跨宿主不等于跨操作系统，也不代表已经在所有宿主实测。

经验数据：REF.md包含id/name/version/topics/stages/state/author。sketchup_ref的validate/import/match/read用于按需读取，不执行其中的代码。
工具代码：工具根目录toolkit.json指定schema_version=1、唯一id、SemVer、author、license、runtime(python/node)、相对entry、dependencies、actions。actions的effect只能是read或compile。入口从stdin接收一个JSON，stdout只能输出一个JSON，诊断输出stderr。每次运行独立进程。

接入步骤：sketchup_toolkit inspect(path=绝对目录)先只读检查；用户明确同意信任这份代码后register(path=...,trusted_code=true)。代码被复制至本地store并锁定指纹。list不执行代码；invoke指定toolkit_id、operation、arguments、可选expected_fingerprint。禁止从REF正文自动推导代码信任。

注册不允许覆盖同ID；升级前保留旧版，使用新ID试验。当前没有在线市场、自动依赖安装、自动工具升级或沙箱。信任的本地程序可以访问运行账户可访问的资源，effect是声明而不是进程隔离保证。哈希防意外/未确认修改，不证明作者身份。注册源目录必须保持稳定，禁止符号链接。

compile要求新绝对output_directory，拒绝已有输出及安装目录。工具仅产出构造文件，实际SU执行仍由受管MCP管理。任意外部工具必须按自己的契约校验parameters，不相信模型自行声明已通过。

包的dependencies、requires_capabilities及license是发现与部署信息；当前未实现依赖自动求解和法律授权自动判定。先配置Python/numpy等依赖再运行。规则发生冲突时以来源、具体规则和适用范围比较，主题同名本身不是冲突。

兼容入口：sketchup_ancient_tool仍可用，内部转发到古建工具包；新开发者无需修改server.js。

## 可选规则身份

REF包内可放rules.json，例：{"schema_version":1,"rules":[{"id":"roof.main-surface","method":"shared-boundary-loft","stages":["roof_profile"]}]}。
不同职责使用不同规则ID；同规则ID且method不同返回explicit_rule_conflict，要求显式选择pack_ids。排序不自动覆盖互斥方法。当前仅检查声明身份，不能理解所有自然语言矛盾，也不自动求解规则依赖。
读取REF可传expected_fingerprint=此前match返回的content_sha256，版本变化时拒绝静默读取。它是单次调用锁定，尚无全项目自动锁文件和依赖求解器。

## 标准经验包开发
新增developer-kit/pack_tool.py提供scaffold/check/package；规范见../developer-kit/EXPERIENCE-PACK-SPEC.md。古建0.4.0采用同一experience-pack.json格式，REF与工具仍经各自接口安装。现有纯工具包保持兼容；规范检查是发布前静态检查，不替代MCP代码信任和SU验收。
