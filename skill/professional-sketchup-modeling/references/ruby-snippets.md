# SketchUp Ruby 片段库

Use this file only after `SKILL.md` routes the task to Ruby geometry. It contains **copyable implementation**, not a generic modeling tutorial.

## 唯一生产入口

使用 managed sketchup-mcp，将辅助函数放入当前受管 build 文件，通过 sketchup_project_step 执行。旧端口可用也不能绕过受管生命周期。示例尺寸不是建筑设计依据。

<a id="entity-lifetime"></a>
## 实体引用与隔离构造

适用：编写 box/窗框/栏杆等辅助函数，或出现 `reference to deleted Face`、`All Entities must have a common parent`。

- 优先复用下方 `ai_box`：先在允许写入的父级创建空组，在 `g.entities` 内建面和挤出，最后给组赋材质。重复家族仍用真实组件；组用于组件内有编辑意义的板、框、玻璃等构件，不逐面套组。
- pushpull、相交、布尔、成组或 explode 等改变拓扑/归属的操作后，旧 Face/Edge **可能**失效或不再代表目标结果，不能假定一定保留，也不能声称每次都会删除。确实需要继续使用旧引用时先检查 `valid?`，再确认归属及目标；更稳妥的是从结果容器重新查找需要的实体。操作失败须抛出明确错误，不能 `rescue nil` 或跳过无效面后宣称构件完成。
- `all_connected` 表示连通几何，不是“本次新增几何”。禁止用 `f.pushpull(...); ents.add_group(f.all_connected)` 作为通用造盒收集方式，也不要改成给所有连通面涂色：相接的窗框、玻璃或板可能被一起收走或改材质。不要改成遍历整个模型/共享父级的所有面赋材质；仅操作本构件隔离容器或明确识别的结果面。
- `common parent` 错误先查传入实体是否有效、是否属于同一目标绘图上下文；`deleted Face` 先查报错调用和前一个拓扑操作。只凭错误文字不能断言具体失效机制。改变构造顺序解决原因，不靠删掉成组操作或反复扩大选择范围试错。
- 最小复查：在当前允许的受管阶段内建一对相接、材质不同的构件，确认两者容器独立、材质未串染、挤出方向和包围尺寸正确，再扩到完整原型。失败重试先按 managed-recovery 核对状态；超时不能盲目重放。不要为此操作另一个正在建模的会话。

2026-09-07 KIMI3 观察案例：原型脚本在 pushpull 后使用 `f.all_connected`，先报 common parent；改为连通面赋材质后又报 deleted Face。日志足以确认该收集策略不可靠，尚不足以证明第一次报错的精确内部原因。此补充是文档与既有隔离造盒模式的整理，本次未在其活动 SU 文档执行试验。

API 核对来源：SketchUp 官方 `Entities#add_group`（建议先空组后加几何）和 `Entity#valid?`；查阅日期 2026-09-07。

## 别自己写 box，用这个

自建 `box(ents,x,y,z,w,d,h,name,...)` 是最高频的返工来源，实测连续三轮都栽在同一处。
直接抄这个版本，它把三个坑都堵住了：

```ruby
# 底面落在 z，向上长 h。x/y/z/w/d/h 均为 mm 裸数字
def ai_box(ents, x, y, z, w, d, h, name, mat = nil, lay = nil)
  raise "#{name}: 尺寸必须为正 (w=#{w} d=#{d} h=#{h})" if w <= 0 || d <= 0 || h <= 0
  g = ents.add_group
  f = g.entities.add_face([
    Geom::Point3d.new(x.mm,       y.mm,       z.mm),
    Geom::Point3d.new((x + w).mm, y.mm,       z.mm),
    Geom::Point3d.new((x + w).mm, (y + d).mm, z.mm),
    Geom::Point3d.new(x.mm,       (y + d).mm, z.mm),
  ])
  # ★ 先纠正、再断言。法线朝下就反向挤，保证永远朝 +Z 长。
  #   不要写成裸 pushpull(h.mm)——绕序相同的四点，SketchUp 仍可能给出朝下的法线，
  #   那一批构件会整体向下长一层，模型散成互不相连的漂浮层。
  f.pushpull(f.normal.z < 0 ? -h.mm : h.mm)
  g.name = name                      # 先 add_face 再命名，name 不参与几何
  g.material = mat if mat
  g.layer    = lay if lay
  # 兜底断言：纠正逻辑失效时当场抛错，不把错误几何留给下游
  zmin = g.bounds.min.z.to_mm
  zmax = g.bounds.max.z.to_mm
  raise "#{name}: 挤出方向反了（zmin=#{zmin.round}, 期望 #{z.round}）" if (zmin - z).abs > 1
  raise "#{name}: 高度不符（got=#{(zmax - zmin).round}, 期望 #{h.round}）" if ((zmax - zmin) - h).abs > 1
  g
end
```

同样的"法线定符号"写法适用于所有 `pushpull`：圆柱 `ai_cyl`、多边形棱柱 `ai_prism`
仅法向为 Z 时采用此检查；YZ/XZ 截面应检查 X/Y，不能对任意截面照抄 Z 判断。

三个必须记住的点：

1. **`.mm` 只能用在数字上。** `name.mm` 会报
   `NoMethodError: undefined method 'mm' for "窗框_一层_右":String`——
   这是参数顺序传错的典型症状（把名字塞到了坐标位）。参数多时用具名 Hash 而不是长位置列表。
2. **`pushpull(+h)` 不保证朝 +Z**，法线随顶点绕序变。**先读 `f.normal.z` 定符号，再用断言兜底**，
   不要等 46 个组全长反了再遍历 `transform!` 补——那会把"方向错"和"标高错"混在一起，
   还会对已经正确的构件产生二次位移。
   实测事故：自写的 `box()` 直接 `pushpull(h.mm)`，地面层构件整体向下长 3300，
   楼层与屋顶散成三段互不相连的漂浮体，而"组数=65、有屋顶、有阳台"这类存在性自检全部通过。
3. **颜色不能传字符串颜色名。** `x.color = 'LightGray'` 报
   `ArgumentError: Cannot find color named LightGray`。用 RGB 数组：

```ruby
def ai_mat(m, name, rgb, alpha = 1.0)
  x = m.materials[name] || m.materials.add(name)
  x.color = Sketchup::Color.new(*rgb)   # [211,211,211]，不是 'LightGray'
  x.alpha = alpha
  x
end
```

---

## 受管调用

辅助函数放在当前 PipClawManagedBuild 模块中，由 build(entities, context) 调用。传入受管 entities；不使用 active_entities、手动事务、直接保存/导图。错误抛给 MCP，由状态确认回滚。参见 [managed-ruby-api.md](managed-ruby-api.md)。

## 图层

```ruby
def ai_layer(m, name)
  m.layers[name] || m.layers.add(name)
end
```

建议图层名：`结构_墙体`、`结构_楼板`、`门窗`、`家具_固定`、`家具_活动`、`洁具`、`灯具`。

---

## 墙体（带洞口）

**不要用布尔运算挖洞**。实测（SketchUp 2024）`subtract` 对悬空洞口会静默失效，
返回未挖的原墙且不报错。正确做法是把洞口直接画进轮廓，一次挤出成型：

- **落地洞口**（门，`sill == 0`）→ 编进外轮廓，走出一个缺口
- **悬空洞口**（窗，`sill > 0`）→ 作为内环，画完删掉环内小面

两种混用也没问题，结果是 `manifold?` 为真的干净实体。

```ruby
# p1/p2: 墙中线两端 [x, y]（mm）; h: 墙高; t: 墙厚
# openings: [{at:, w:, sill:, h:}]  at = 洞口中心距 p1 距离(mm)，门传 sill: 0
def ai_wall(m, ents, p1, p2, h, t, name, openings = [])
  dx = p2[0] - p1[0]
  dy = p2[1] - p1[1]
  len = Math.sqrt(dx * dx + dy * dy)
  raise ArgumentError, "墙长为 0: #{name}" if len < 1

  # 先在 XZ 平面(y=0)沿 X 轴画立面，最后整体变换到位
  ground = []   # 落地洞口 [x1, x2, 高]
  float  = []   # 悬空洞口 [x1, x2, z1, z2]
  openings.each do |o|
    x1 = o[:at] - o[:w] / 2.0
    x2 = o[:at] + o[:w] / 2.0
    raise ArgumentError, "洞口超出墙长: #{name}" if x1 < 0 || x2 > len
    if (o[:sill] || 0) <= 0
      ground << [x1, x2, o[:h]]
    else
      float << [x1, x2, o[:sill], o[:sill] + o[:h]]
    end
  end
  ground.sort_by!(&:first)

  # 外轮廓：沿底边从左到右，遇到落地洞口就绕上去再下来
  pts = [[0, 0]]
  ground.each do |x1, x2, oh|
    pts << [x1, 0] << [x1, oh] << [x2, oh] << [x2, 0]
  end
  pts << [len, 0] << [len, h] << [0, h]

  g = ents.add_group
  ge = g.entities
  ge.add_face(pts.map { |x, z| Geom::Point3d.new(x.mm, 0, z.mm) })

  # 悬空洞口画成内环，再把环内的小面删掉
  float.each do |x1, x2, z1, z2|
    ge.add_face([
      Geom::Point3d.new(x1.mm, 0, z1.mm), Geom::Point3d.new(x2.mm, 0, z1.mm),
      Geom::Point3d.new(x2.mm, 0, z2.mm), Geom::Point3d.new(x1.mm, 0, z2.mm)])
  end
  faces = ge.grep(Sketchup::Face).sort_by { |f| -f.area }
  faces[1..-1].each { |f| f.erase! if f.valid? } if faces.length > 1

  shell = ge.grep(Sketchup::Face).first
  raise "轮廓成面失败: #{name}" unless shell
  shell.reverse! if shell.normal.y < 0       # 局部截面先统一 +Y 法向
  shell.pushpull(t.mm)                       # 沿 +Y 挤出墙厚

  # 立面建在 y=0，挤出后占 y∈[0,t]；平移使墙中线落在 p1→p2 上
  ang = Math.atan2(dy, dx)
  g.transform!(
    Geom::Transformation.translation(Geom::Vector3d.new(p1[0].mm, p1[1].mm, 0)) *
    Geom::Transformation.rotation(ORIGIN, Z_AXIS, ang) *
    Geom::Transformation.translation(Geom::Vector3d.new(0, -t.mm / 2.0, 0)))
  g.name = name
  raise "墙体非实体（洞口可能重叠）: #{name}" unless g.manifold?
  g
end
```

用法：

```ruby
w = ai_wall(m, ents, [0, 0], [6000, 0], 2800, 240, '南墙',
            [{ at: 1500, w: 900,  sill: 0,   h: 2100 },    # 门，落地
             { at: 4200, w: 1500, sill: 900, h: 1500 }])   # 窗，悬空
w.layer = ai_layer(m, '结构_墙体')
made << w.entityID
```

manifold? 不是全部洞口约束的证明。调用前检查正尺寸、墙顶范围、重叠与退化轮廓；结果还需读回及近景。本轮法向修正未做真实 SU 回归。

---

## 楼板

```ruby
# corners: [[x,y], ...] 顺序闭合轮廓（mm）; t: 板厚; z: 板底标高
def ai_slab(m, ents, corners, t, z, name)
  g = ents.add_group
  pts = corners.map { |c| Geom::Point3d.new(c[0].mm, c[1].mm, z.mm) }
  f = g.entities.add_face(pts)
  f.pushpull(f.normal.z < 0 ? -t.mm : t.mm)
  g.name = name
  raise "楼板挤出方向错误: #{name}" if g.bounds.min.z.to_mm.round < z.round
  g
end
```

### 挤出方向：先自检，别事后修

`add_face` 的法线方向取决于顶点绕序，**`pushpull(+h)` 沿法线走，不保证朝 +Z**。
逆时针（俯视）绕序法线朝上，顺时针朝下——写自建 `box` 辅助函数时最容易在这里翻车：
一整批构件全部向下长，包围盒 `zmin` 变成负值。

**在辅助函数内部就断言标高**，像上面那样比对 `g.bounds.min.z` 与传入的 `z`：

```ruby
f.pushpull(f.normal.z < 0 ? -h.mm : h.mm)
# 想让底面落在 z，长完就核对；方向反了当场抛错，而不是让 23 个组都错完再遍历修
raise "挤出方向错误: #{name}" if g.bounds.min.z.to_mm.round < z.round
```

方向确实需要反转时用 `f.pushpull(-h.mm)`，或建面后 `f.reverse!`。
**不要靠事后 `transform!` 平移一个 `bounds.depth` 去补**——那会把"方向错"和"标高错"混在一起，
且对已经正确的构件产生二次位移。

---

## 门扇

```ruby
# hinge: 铰点 [x,y]; w: 门宽; h: 门高; ang: 开启角度(度); dir: 1/-1 开启方向
def ai_door(m, ents, hinge, w, h, ang, dir, name, thick = 40)
  g = ents.add_group
  ge = g.entities
  f = ge.add_face([
    [0,      0,          0],
    [w.mm,   0,          0],
    [w.mm,   thick.mm,   0],
    [0,      thick.mm,   0],
  ])
  f.pushpull(f.normal.z < 0 ? -h.mm : h.mm)
  g.name = name
  rot = Geom::Transformation.rotation(ORIGIN, Z_AXIS, dir * ang.degrees)
  g.transform!(Geom::Transformation.translation(
    Geom::Vector3d.new(hinge[0].mm, hinge[1].mm, 0)) * rot)
  g
end
```

---

## 家具占位体（带朝向）

朝向是语义要求，必须体现在几何上而不只是名字里。

```ruby
# ctr: 中心 [x,y]; w/d/h: 宽深高; face_ang: 正面朝向角(度, 0=+X)
def ai_box_at(m, ents, ctr, w, d, h, face_ang, name, z = 0)
  g = ents.add_group
  f = g.entities.add_face([
    [-w.mm / 2, -d.mm / 2, z.mm],
    [ w.mm / 2, -d.mm / 2, z.mm],
    [ w.mm / 2,  d.mm / 2, z.mm],
    [-w.mm / 2,  d.mm / 2, z.mm],
  ])
  f.pushpull(f.normal.z < 0 ? -h.mm : h.mm)
  g.name = name
  g.transform!(
    Geom::Transformation.translation(Geom::Vector3d.new(ctr[0].mm, ctr[1].mm, 0)) *
    Geom::Transformation.rotation(ORIGIN, Z_AXIS, face_ang.degrees))
  # 把朝向写进属性字典，供后续校验
  g.set_attribute('ai_meta', 'face_ang', face_ang)
  g
end
```

床头贴墙、电视朝向这类要求，用 `face_ang` 表达，并在 `ai_meta` 里留痕，
后续可以用 `g.get_attribute('ai_meta', 'face_ang')` 查回来验证，而不是靠名字猜。

---

## 提交、保存与证据

保存、文档切换和事务由 MCP 维护。guided 按当前保存阶段提交；expert 按授权建筑系统组织脚本，可以一次完成完整小模型，也可以分多笔相关构造。辅助函数不另行限制阶段、文件数量或审核轮次。保存由 `sketchup_project_finish` 完成，截图由 MCP 返回；失败按 `evidence_pending/retry_evidence` 处理。

旧事务、批量载体、直接保存/导图已移到 [历史片段](archive/ruby-snippets-legacy-before-20260907.md)，仅供迁移审查，不能作为生产入口。
