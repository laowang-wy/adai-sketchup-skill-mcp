# 经验包（REF pack）写法与安装

底座负责操作 SketchUp，经验包负责指导该怎么建。**装什么包，就增加哪方面的做法。**

## 一、给不写代码的人：三步装好

1. 拿到一个经验包文件夹（里面应该有一个 `REF.md`），或者它的 `.zip`。
2. 让 Agent 调 `sketchup_ref action=list`，它会返回一个 `inbox` 目录的完整路径，例如
   `%APPDATA%\SketchUpLiveMCP\ref-packs\inbox`。
3. 把经验包文件夹（或 .zip）**直接拖进这个目录**，然后让 Agent 再调一次 `action=list`。装好了。

之后 Agent 每次建模前会自动按任务类型和当前阶段查这个包。想暂时不用：

- 让 Agent 调 `sketchup_ref action=disable pack_id=包ID`：不再参与匹配，已有模型和已保存文件不受影响。
- 想彻底删掉安装副本：`action=remove pack_id=包ID confirm=true`。你导入时的原始文件夹不会被删。

## 二、一个经验包长什么样

```text
中式古建/
├─ REF.md                必须，正文与元信息
├─ assets/               可选，图片证据（正确做法 / 反面案例）
│   ├─ 正确-斗拱分层样板.png
│   └─ 反面-承托歪斜.png
└─ body/                 可选，原始对照材料（完整文档、复盘记录）
    └─ yellow-crane-tower-lessons.md
```

只有 `REF.md` 是必需的。普通包内**只能放文本和图片**：出现 `.exe` `.bat` `.ps1` 这类可执行文件会被直接拒收，压缩包里的 `../` 路径穿越也会被拒收。

## 三、REF.md 模板（复制改内容即可）

```markdown
---
id: chinese-ancient              # 必填。英文/数字/._-，2-64 位，全局唯一
name: 中式古建                    # 必填。显示名
version: 1.0.0                   # 必填。改了内容就升版本
state: draft                     # 模板默认草稿，验证后再改 verified
topics: [古建, 楼阁, 斗拱, 屋顶]    # 必填。这个包管哪些主题
stages: [massing, archetypes]    # 可选。包级概览，章节级更精确
scope: shared                    # 可选。shared（通用）/ company（公司标准）/ project（单项目）
verified_by:                     # 验证后填真实维护者
evidence:                        # 验证后填实际证据
notes: 一句话说明适用范围
---

# 中文标题

一两句话说明这个包解决什么问题。如果内容来自真实复盘，写清来源。

## [massing] 章节标题

`[massing]` 是阶段标签。可用阶段：massing / archetypes / replication /
variants / facade_detail / finish。写多个用竖线：`## [massing|archetypes] 标题`。
不写标签的章节对所有阶段都返回（适合放通用检查）。

正文写：什么时候用、建议怎么做、常见错误长什么样、怎么检查。

## 通用检查

不分阶段的检查点写在这里。
```

### 写作要求（这决定了 Agent 能不能用上）

1. **写判断标准，不写形容词。** "翼角不能只用一段窄条代替" 比 "翼角要做精致" 有用。
2. **写错在哪一层。** 例如"承托歪斜先查坐标与缩放，再查造型"——告诉 Agent 先改哪里。
3. **写判不过的样子。** Agent 需要能对照证据判断"还没过"。
4. **不要编数字。** 没有实测依据就不要写具体尺寸；写比例关系或"从照片量取"。
5. **一节只说一件事。** 章节标题会变成稳定的 `section_id`，不要用重复标题。

## 四、自检清单

写完包后，让 Agent 执行：

```text
sketchup_ref action=validate path=你的包目录
```

逐项确认：

- [ ] `ok: true`，没有 `errors`
- [ ] `section_count` 与预期一致
- [ ] 每个章节的 `stages` 解析正确（通用章节应为空数组）
- [ ] 章节标题没有重复
- [ ] `state: verified` 时写了 `verified_by` 和 `evidence`
- [ ] 包里没有可执行文件，单文件小于 2 MiB，总量小于 8 MiB
- [ ] `warnings` 为空，或每一条都确认合理

再验证匹配：

```text
sketchup_ref action=match topics=[你的主题] stages=[massing]
```

确认该命中的章节真的出现，不该出现的没有出现。

## 五、经验怎么长大（草稿 → 验证 → 入包）

Agent 在真实项目里修好一个问题后，可以让它写一条草稿：

```text
sketchup_ref action=draft title=下檐瓦不贴合 topics=[古建] stages=[finish] symptom=... fix=... evidence=...
```

草稿写到 `drafts` 目录，`state: draft`，**不会自动生效、不会自动进入任何包**。维护者看过、在真实项目里复现确认后，把内容并入正式包并把 `state` 改为 `verified`，再 `action=import overwrite=true` 覆盖安装。

这样经验库不会被"一次没验证的猜测"污染。

## 六、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `list` 里看不到刚拖进去的包 | 拖进了 store 根目录而不是 `inbox` | 放到 `action=list` 返回的 `inbox` 路径里 |
| `validate` 报 `missing REF.md` | 文件夹多套了一层 | 让 `REF.md` 直接位于包文件夹第一层 |
| 报 `absolute path` / `path traversal` | 压缩包里有 `../` 或绝对路径条目 | 重新打包：在包文件夹内部选中内容再压缩，不要从上层目录打包 |
| 报 `executable content is not allowed` | 包里有 `.exe/.bat/.ps1` 等 | 删掉这些文件；经验包只放文本和图片 |
| `match` 返回 `conflicts` | 多个包声明了同一主题或同名章节 | 让用户决定用哪一套，不要合并 |
| `match` 返回 `no_pack_loaded: true` | 没有装覆盖该类型的包 | 按底座通用流程建模，并在交付说明里写明 |
| 报 `Registry unreadable` | `registry.json` 被损坏 | 原文件已保留，修复或删除该文件后重装经验包 |

## 七、给 Agent 的固定动作

1. 先按实际来源附件路由经验：上传图片/效果图先加载图片一致性底座；上传 CAD 先加载 CAD 建筑包；古建、楼阁或塔类再叠加中式古建包。按附件类型和内容判断，不按项目名称猜。
2. 建模前只调用一次 `action=list`，按来源选定明确 `pack_id`（图片一致性底座是 Skill 内置章节；CAD 用 CAD 包；古建用指定的中式古建包），再以 `pack_ids` 限定 `action=match` → `action=read`。每包只读当前问题的 1—2 节，不把无关经验包整包塞进上下文。没有成功 `read` 不得开始主形构造。
3. `match` 的 `query` 用“楼阁”“屋顶”“斗拱”等短关键词分别查询，不把整句描述当作一个连续关键词；多个包规则重叠时先选适用包，不能把所有命中包一起读取。
4. 匹配结果里的 `packs_used`（版本 + 内容指纹）由程序留档；不要求 Agent 填运行时证明表。
5. 冲突必须交给用户；经验包不能改事务、证据、审查、保存策略。交付说明写明实际使用的包与版本。

## 八、可选 Go 编译包

公开底座不包含私有经验。所有者可运行 `node tools/compile-pack.cjs 源包目录 新输出目录`，需要本地 Go 工具链；使用编译包的机器不需要 Go。源目录只读，输出必须是新目录。编译包含公开目录 REF.md、provider.json、provider.exe。

这类包会执行本地程序。先核对来源，再由用户明确授权 `sketchup_ref(action=import,path=...,trusted_provider=true)` 或 CLI 的 `--trust-provider`。收件箱不会自动信任程序；校验、列表和匹配不执行 provider。每次读取前核验文件指纹；指纹和 identity 标识不是发布者签名，也不能证明程序安全。

Go/AES 包提高直接复制源码的成本，离线端拥有程序和密钥，不能保证无法逆向；返回给 Agent 的内容也可被调用者看到。不要声称可防止所有提取或提示词诱导。

普通包单文件 2 MiB、总内容 8 MiB、最多 200 文件；编译程序另限 32 MiB。SKP 放外部案例目录。使用底座 templates/experience-pack 模板记录构造选择、失败与修正；不要只增加“必须精细”的口号。
