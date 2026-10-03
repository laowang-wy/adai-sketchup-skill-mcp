# Managed SketchUp Ruby API

Read before writing a managed build. The MCP owns transactions, identity, scope, evidence and save. Guided projects use phases; new expert projects use architectural work units. In expert projects `context['phase_group']` is the current system container, not a teaching-stage restriction. Registration examples below are reusable in a complete expert system; headings describe their role, not mandatory separate calls.

## Entry Point

```ruby
require 'sketchup.rb'
module PipClawManagedBuild
  extend self
  def build(entities, context)
    g = context['geometry']
    # One part example, not a template for the whole building. All numbers below are mm.
    part = g.profile(entities, 'sloped_part',
      [[0,0], [4000,0], [4000,2200], [0,3000]], 200, 'xz', 0)
    { 'part_pid' => part.persistent_id }
  end
end
```

`context['geometry']` 提供已加载的构造方法；实体方法返回独立组，采样方法返回点数组：

- `profile(entities, name, outline_mm, depth_mm, plane='xz', offset_mm=0, material=nil)`：简单闭合无孔截面。`xy` 向 +Z，`xz` 向 +Y，`yz` 向 +X；depth 为正，offset 是挤出起始平面，结束位置为 offset+depth，居中时由中心减去半深度求 offset。outline 不必重复首点。适用于沿挤出方向不变的截面；截面宽高或方向变化时选截面连接/网格。
- `profile_with_holes(entities, name, outer_mm, holes_mm, depth_mm, plane='xy', offset_mm=0, material=nil)`：沿外轮廓和内部闭合孔环生成贯通开口实体。`holes_mm` 无孔传 `[]`，单孔传 `[hole]`，多孔传 `[hole1, hole2]`；每个 hole 是二维点数组。楼板/平屋面用 xy，墙板用 xz 或 yz；每个构件采用自身标高上的外轮廓和孔环；同一贯通空隙可跨层复用，局部开口只用于受影响的构件。板的 holes 是实际洞口；边框/压顶的 holes 是其内边界，两环之间才是构件宽度。按构件角色给边界，材质名称不改变占据范围。孔须完全位于外环内且互不接触；贴边门洞/缺口直接画进外轮廓。它是等截面挤出，不推断建筑边界、自动布尔或变化曲面。
- `loft_sections(entities, name, sections_mm, axis='x', material=nil)`：沿固定直轴连接宽高/横向位置可变的闭合截面，三角化侧面并封闭两端，返回独立组。每站为 `{'offset_mm'=>轴向位置, 'profile_mm'=>二维轮廓}`；x轴截面用YZ，y用XZ，z用XY。offset递增，各环点数相同，从对应部位起沿相同绕向取点；首尾点可省略重复。各站保持原给定轮廓，站间为直线连接，需要弯曲时沿来源变化增加截面。截面为无孔简单环；截面转向、开口壳、分叉及法向等厚仍用对应算法或网格。薄壳可直接给闭合的上下表面截面；厚度来自所给轮廓，不由此函数自动推算。它不判断所给截面是否符合图片。
- `box(entities, name, origin_mm, size_mm, material=nil)`：矩形部件，size 三项为正。不是完整建筑的默认表示。
- `shell_grid(entities, name, top_grid_mm, thickness_mm, material=nil)`：对应站点组成的二维XYZ毫米网格，自动三角成面、生成底面及周边封口。每行点数相同且至少2×2，行的首末点取该站的真实边界，因此平面边界可以弯曲、收分；首末整行或整列可用相同 XYZ 点收成一个端点，程序合并重复点并生成三角扇。内部站点保持可成面的网格。输入是XY上不折返的高度面，无孔洞；厚度沿局部-Z，不是法向等厚。它保留给定坐标及不同截面，不把扭曲四边形强行做平。垂直折叠、重叠、孔洞和法向等厚壳继续用显式网格/相应算法。
- `closed_band(entities, name, outer_bottom_mm, outer_top_mm, inner_bottom_mm, inner_top_mm, material=nil)`：连接四条对应的 XYZ 毫米闭合边界，生成中央留空、上下沿可起伏的带状实体，如曲边包边、女儿墙或围合构件。各环点数与绕向相同，从对应位置起；XY 投影为互不相交的简单环，内环在外环内，每个顶点高于对应底点。上下表面和内外侧面自动三角化、封闭；内外环决定厚度。适用于竖向围合，不处理环间扭转、自动曲线拟合或法向偏移；所给边界决定最终形态。
- `sample_profile(stations_mm, samples_per_span=6)`：输入递增位置的二维毫米站点 `[[位置,高度或宽度],…]`（至少两站），返回 C1 连续、经过各站且各段不越出端值的采样点。每段均分，原站点保留；两站是直线。不创建实体、不识别来源，也不自动闭合轮廓。适合单值光滑边缘；折返轮廓分别采样各支，真实尖角/折线分段保留。点可用于截面、网格或闭合挤出轮廓，不是用于所有建筑的固定曲线。
- `point_mm([x,y,z])`、`translation_mm([x,y,z])`：自定义几何和实例的单位转换。

可直接用项目坐标，也可在组内局部构造后变换整组；曲面计算函数的输入需与其坐标基准一致。真正共边的部位共用点，悬挑、退进、留缝仍保留各自边界。material 可传现有 SketchUp 材质、可识别颜色或 nil；自定义材质名先创建对应材质。

颜色可直接传 `Sketchup::Color.new(220,220,220)`。需要命名材质时，在 `build` 内用 `mat=Sketchup.active_model.materials.add('本项目材质名')`、`mat.color=Sketchup::Color.new(r,g,b)` 创建，再把 `mat` 传给构造方法；这样取得自己的材质对象，不改写其他对象共享的同名材质。仅传自定义名称不会创建材质；默认显示用 `nil`。

这些输入是毫米数值，内部转换一次并处理面朝向；不要先 `.mm` 再传入。如果设计参数习惯用米，在组装输入数组前统一换成毫米，例如 `width_mm = 38 * 1000.0`、`height_mm = 18 * 1000.0`，然后用这些变量构造三个轴；构件截面仍可直接用毫米参数。直接用原生 SketchUp API 时，裸数值是英寸，使用 `1000.mm`。轮廓、标高、出挑与构件尺寸来自同一组来源参数；执行后返回的 `model_extent.span_xyz` 是项目世界包围盒 XYZ 毫米跨度，可发现单位或摆放错误，不证明造型正确。

从已判断的控制站点构造光滑边缘（数值仅示范接口，实际站点由来源确定）：

```ruby
g = context['geometry']
edge = g.sample_profile([[0,1800],[1700,4200],[4600,4500],[7500,2200]], 8)
# 将同一边缘用于两条对应网格行；有横向变化时给出该方向自己的控制关系。
grid = edge.map { |x,z| [[x,0,z], [x,1200,z]] }
part = g.shell_grid(entities, 'curved_strip', grid, 180)
```

先修改站点位置和高度来贴近来源，再调整采样密度；平滑插值不会让错误站点变成正确形态。算法为无外部运行依赖的 PCHIP，不替代空间关系判断。

变化截面示例（局部毫米坐标；各行位置与高度来自来源，以下仅说明接口）：

```ruby
grid = [
  [[0,0,2000], [0,1800,3600], [0,4000,2200]],
  [[3000,-400,1600], [3000,1400,4200], [3000,4500,1900]],
  [[6500,200,2400], [6500,1700,3200], [6500,3800,1800]]
]
roof = context['geometry'].shell_grid(entities, 'roof', grid, 180)
```

这样增减站点只改变输入几何，底面、封口、三角化和单位转换由方法完成。调整控制点后再提高采样密度；切向连续处可柔化内部边，真实折线保留。

曲面外边缘需要紧接包边时，[共边构造示例](examples/shared-boundary-shell.md)直接从上述网格取周边点再构造包边，避免另画一套近似轮廓。它不替主体、悬挑或分缝部位决定边界。

Useful context keys: `geometry`, `model`, `phase_group`, `project_root`, `project_id`, `phase`, `step_index`, `working_units`, `meters_to_inches`, `mm_to_inches`, `projection_brief`.

Never save/open/export, clear model entities, write outside `entities`, or manually alter managed state.

## Massing — Bind Real Projection Geometry

Optional projection registration identifies actual visible geometry for comparisons; it is not a construction or visual-quality quota:

```ruby
main = entities.add_group
# build major mass in main.entities
PipClawManagedProject.register_projection_subject(
  context['phase_group'], main,
  { 'id'=>'main', 'role'=>'focal_building' }
)
```

The MCP measures real screen-space bounds. Text metadata cannot substitute for geometry.

## Archetypes — Complete Reusable Components

An archetype is a real `Sketchup::ComponentInstance`, never a Group. Build the complete repeatable visual kit inside the definition before replication: slab/body, opening recess, frame/mullion, balcony, railing, fins or shadow lines shown by the source.

```ruby
definition = context['model'].definitions.add('TypicalBalconyBay')
# build complete local reusable geometry in definition.entities
prototype = entities.add_instance(definition, Geom::Transformation.new)

PipClawManagedProject.register_archetype(
  context['phase_group'], prototype,
  {
    'id'=>'typical_balcony_bay',
    'family'=>'balcony_window_level',
    'source_cue'=>'repeated balcony/window rhythm'
  }
)
```

When useful for locating a real system, register the source-visible geometry already contained by the archetype; no minimum registration count is required:

```ruby
PipClawManagedProject.register_visible_detail(context['phase_group'], {
  'id'=>'window_mullion_bay',
  'kind'=>'recessed_window_and_mullion',
  'source_cue'=>'dark recessed glazing with narrow vertical divisions',
  'instances'=>6,
  'prototype'=>'typical_balcony_bay',
  'host'=>'typical level'
})
```

Registration describes geometry already built into the component; it is not permission to return metadata without geometry.

## Replication — Instance Accepted Archetypes

```ruby
PipClawManagedProject.instantiate_archetype(
  context['phase_group'], entities, context['project_root'],
  'typical_balcony_bay',
  Geom::Transformation.translation([0, 0, 3400.mm]),
  { 'system_id'=>'upper_floor_stack', 'source_cue'=>'repeated upper floors' }
)
```

`system_id` identifies one prototype definition in the current replication readback. When a facade uses different width or height definitions, use distinct stable system IDs for those families; this does not require extra geometry or registration solely to meet a quota.

Use true instances where repetition is actually required. In guided replication, reuse the reviewed prototype rather than redrawing it; expert may create a complete prototype and instances in one authorized unit. For a local defect in either mode, use `sketchup_project_step(operation_intent=update, targets=[exact_target])`; typed operations or Ruby `context['edit_targets']` preserve unrelated geometry. To change the shared prototype within the supported container, use targeted Ruby with `edit_scope=definition`; inspect its affected instances. Use `sketchup_project_revise_from(project_id, target_phase, reason)` only when deliberately rebuilding a phase and its dependent downstream work; it preserves a checkpoint. If the current operation is `evidence_pending` or `result_unknown`, finish the existing recovery chain first; do not replay the write.

## Variants — Controlled Differences

Use `register_variant` for a real source-visible exception such as podium, roof, transfer, corner, terrace, setback or termination. Give it a stable `id`, `kind` and `source_cue`. Do not mutate a shared archetype to force one local condition.

## Facade Detail — One-Off Geometry

This phase supplements details that cannot belong to a reusable component: entrance, canopy, crown ornament, podium interface, corner closure, expansion/connection node or unique termination.

```ruby
detail = entities.add_group
detail.name = 'UniqueEntryCanopy'
# build the actual one-off geometry in detail.entities

item = PipClawManagedProject.register_unique_detail(
  context['phase_group'], detail,
  {
    'id'=>'entry_canopy',
    'kind'=>'entry_canopy',
    'source_cue'=>'single projecting canopy at the focal entrance',
    'host'=>'podium entry'
  }
)

{ 'created'=>1, 'unique_details'=>[item] }
```

The helper seals the actual entity persistent ID. Metadata without valid geometry fails audit.

## Geometry Invariants

The managed helper loads the shared `ADAIGeometryGuard` kernel. A custom method may
call `audit(part.entities, semantic_id, true)` on actual closed geometry, `tag` the
part with that report, then `mapping(entities, expected_ids)` for fresh meshes,
persistent IDs and transformed bounds. This does not choose or constrain the
construction algorithm. A generator may return that mapping in `geometry_readback` with its actual
parameter/generator hashes and dependencies; the program materializes machine
attachments. Custom Ruby does not have to hand-fill a quality contract. A returned report is not visual approval
or a whole-surface contact certificate. The `parametric-facade-bay` toolkit provides
a runnable example using ordinary face extrusion, including a finish readback.

- Use `.mm` on numeric values only.
- SketchUp `BoundingBox#width`, `#height`, and `#depth` are X, Y, and Z spans. For architecture report them as width=X, plan depth=Y, and building height=Z. Never label `bounds.height` as vertical height.
- Normalize face orientation before `pushpull`; verify resulting bounds.
- For a prism or extrusion, normalize and prune one canonical polygon ring before creating any side faces or caps. Triangulation, collinear-point removal and index remapping must use that same ring; never build side walls from the original ring and caps from a reduced ring. A closed solid must report `boundary_edges=0` in the actual guard readback.
- Before writing geometry helpers, read [entity lifetime and isolated construction](ruby-snippets.md#entity-lifetime). Create the empty owning group first; do not rely on an old Face or `all_connected` to collect results after topology changes.
- Keep definition geometry local and apply parent transforms once.
- Preserve host contact; inspect first/middle/last instances.
- Return a small Hash describing the actual construction result.
- Use `ruby-snippets.md` for tested openings, boxes and transform patterns.

## Expert system operations

New expert projects may combine the above registrations and geometry methods in one system. Use `step` with existing `work_unit_id` or a descriptive `work_unit_name`; intent append/update/replace is bounded by the actual unit. A reviewed system may be edited again; capture and review the new result. Existing phase-based projects keep their saved strategy. See [expert operation](expert-operation.md) and [typed operations](scoped-operations.md).

## Roof meshes within a complete primary form

The roof compiler returns a self-contained roof script and a sibling `mesh-data.json`.
When the current step is a complete building form, combine the required roof shells,
primary bodies and real openings within one managed build instead of treating one
roof-only step as the complete building. The array entries contain `vertices` in mm,
`triangles` and `offset`; the latter is a display offset, not a source-derived datum.

```ruby
# Inside PipClawManagedBuild.build; replace paths and transform from this source.
roofs = JSON.parse(File.read(mesh_path, encoding: 'UTF-8'))
roofs.each_with_index do |roof, i|
  shell = entities.add_group
  shell.name = "PrimaryRoof_#{i}"
  ADAIGeometryGuard.add_mesh(shell.entities, roof.fetch('vertices'),
                            roof.fetch('triangles'), shell.name, true)
  shell.transform!(source_placement_for_this_roof)
end
# Build the source-defined bodies/openings in the same scope, then return a Hash.
# This snippet assembles shells only; tile/ridge detail is not automatically copied.
```

For nested polygon eaves, require the installed
`references/examples/ruby/polygon-eave-shell.rb` and call
`ADAIPolygonEaveShell.build(entities,name,parameters,material=nil)`.
Use `outer_xy_mm` and corresponding `inner_xy_mm` (strictly convex CCW rings),
`base_z_mm`, `rise_mm`, `thickness_mm`, `corner_lift_mm`,
`span_segments`, `slope_segments`. The shell retains an open centre and vertical
thickness; it does not generate gables, a ridge cap, a whole tower or tile detail.
The managed geometry guard checks actual faces; this is not visual acceptance.

Other installed geometry helpers use mm: `profile_prism`, `section_sweep` and
`curved_corner` in `examples/ruby/ancient-construction-patterns.rb`. The last
two connect parallel sections; rotating sections need a different construction.
None of these methods is restricted to a teaching phase. Load files via their
actual installed path, not a historical workstation path.
