# 经验包（REF pack）格式与加载

经验包只补充建模方法，不改变 MCP 的事务、证据、审查或保存门禁。普通经验包可以在 PipClaw 和 Codex 共用。

## 目录格式

```text
my-pack/
├── REF.md                  # 必需
├── assets/                 # 可选：图片、剖面、对照图
└── body/                   # 可选：原始复盘或来源材料
```

包内只放文本和图片；不要放 `.exe`、`.bat`、`.ps1`、路径穿越条目或模型文件。

## REF.md 最小格式

```markdown
---
id: chinese-ancient
name: 中式古建
version: 1.0.0
state: draft
topics: [古建, 屋顶, 斗拱]
stages: [massing, archetypes]
scope: shared
verified_by:
evidence:
notes: 适用范围说明
---

# 章节标题

## [massing] 什么时候使用

写清可观察的判断标准、构造方法、常见错误和检查方式。没有实测依据就写比例关系，不编造尺寸。
```

`state: draft` 不会自动参与生产匹配；在真实项目中复核后，补 `verified_by` 与 `evidence`，再改为 `verified`。章节标题要唯一；阶段可用 `massing`、`archetypes`、`replication`、`variants`、`facade_detail`、`finish`。

## 加载流程

1. 将文件夹或 ZIP 放入 MCP 返回的 `sketchup_ref(action=list)` 的 `inbox` 目录。
2. 用 `sketchup_ref(action=validate, path=...)` 检查，再用 `action=list` 确认已登记。
3. 建模前按主题和阶段调用 `action=match`，只读取命中的章节，不整包搬运。
4. 记录本次使用的包 ID、版本和内容指纹；冲突交给用户选择。
5. 暂停使用用 `action=disable`，删除安装副本用 `action=remove confirm=true`。

PipClaw 与 Codex 只需安装同一 MCP 和 Skill；REF 包由 MCP 的本机 store 管理，不写入模型，也不要求开发者改核心代码。
