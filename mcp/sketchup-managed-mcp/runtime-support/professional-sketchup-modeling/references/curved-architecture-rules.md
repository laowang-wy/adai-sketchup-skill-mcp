# Curved Architecture Modeling Rules

Read for curved towers, rounded corners, arched facades, curved curtain walls, shells, canopies, and freeform roofs. This is the production protocol. Use the current source and managed readback as evidence; historical regression archives are not part of the distributable runtime.

## 1. Classify Before Geometry

Choose the actual construction type: circular arc, ellipse, spline, ruled surface, or doubly curved shell. Record its governing parameters before generating geometry:

- arc/ellipse: center, inner/outer radius, start/end angle, floor datum, segment tolerance;
- freeform shell: outer boundary, crown/ridge, support/eave line, inner opening boundary, underside offset, thickness, and guide-station correspondence;
- image-only source: mark this as an **inferred topology candidate**, not learned source geometry, even after visual review; passing views does not turn inferred geometry into measured source geometry.

Do not trace a perspective silhouette into a box or use a world-axis AABB as a curve parameter.

## 2. Select the Geometry Construction Pattern

Historical raw primitive names below describe algorithms, not permitted production calls. Adapt geometry inside managed build entities; raw-write tools remain locked.

| Need | Historical tool / construction |
|---|---|
| One continuous curved wall, cap, gutter, frame or constant profile | `sketchup_sweep_profile_path` along a measured guide |
| Changing profile across corresponding sections | `sketchup_loft_sections`; equal point count and intentional caps only |
| Guide surface / early membrane without thickness | `sketchup_surface_grid` |
| Physical roof/facade shell with soffit and closed perimeter | `sketchup_shell_grid` |
| Repeated facade/mullion/rafter members | One validated local component, then `sketchup_array_on_path` or a measured tangent transform |

A shell system is never one surface: keep shell, slabs/floor edges, parapet/cap, mullions, glazing/infill, sill/head, gutters/seams, and termination modules as separate named groups.

## 3. Curved Facades and Repetition

1. Build one representative bay at the real radius: host wall contact, sill/head, frame depth, glazing/infill, vertical frame, horizontal transom, and floor-edge/spandrel closure.
2. In plan, derive instance position from curve center/guide and rotate it to its local tangent or radial direction. Apply the parent transform once; do not rotate a world-space bounding box again.
3. Validate top, middle, and termination bays separately. Corners/end conditions are independent definitions when their geometry differs.
4. Only then convert the bay to a reusable definition and distribute it. A curved shell with planar floating windows is a failed envelope, regardless of entity or instance count.

For developed tower quality, include continuous shell/glazing curvature, frame depth, vertical/horizontal grid, sill/head, floor edge or spandrel, roof/parapet cap, and termination modules. Component reuse is required for fidelity but no target entity count is a quality gate.

## 4. Freeform Shells, Openings, and Pavilions

Decompose a freeform reference into independent systems: perimeter/curtain wall, closed thick roof shell, skylight/infill shell, edge/seam bands, and connectors/supports. Skin and support topology are separate: a shell may overhang, but its bearing interval must be explicit.

- Use a shared control topology that encodes taper and vertical rise together. Raising only the center row creates a tent, not a leaf/petal shell.
- Build top patches, underside offset, perimeter closure, and opening reveals as a watertight patch network. A glass panel over an unbroken roof does not create a skylight.
- Every roof, reveal, cap/frame, and glazing part around an opening uses the same explicit inner boundary and point correspondence.
- Triangulate non-planar shell cells, glazing, perimeter closures, and reveals. SketchUp 2019 does not make a twisted quad reliable.
- Curved connector necks are lofted/shelled transitions derived from host width and tangent; rectangular connector boxes are only layout diagnostics.
- For a presentation leaf/petal roof, use enough stations to make continuous silhouette: 5×7 is diagnostic only; start around 7–9 longitudinal and 11–15 transverse stations, then add stations only where curvature changes.
- Smooth/hide tangent internal triangulation for normal-shaded review; preserve intentional seams, frames, and perimeter edges.

## 5. SketchUp 2019 Gates

- Use `definition.entities.length == 0`, not newer collection assumptions. For a triangulated shell inside an uninstantiated definition, prefer `Geom::PolygonMesh` + `add_faces_from_mesh`; repeated `add_face` may yield an empty definition.
- Reject an array with `added_face_count == 0` even if it returns instance IDs. Require nonzero definition faces and visible normal-shaded shell area before propagation.
- Ruby camera numbers are internal inches unless written with `.mm`; missing conversion makes a screenshot roughly 25.4× too distant and invalid.
- Build and inspect one sample before a floor/radial array. If a local frame tangent is degenerate, fix it before repetition; do not conceal a broken tangent with material or smoothing.
- For radial shell propagation, create and validate the shell in a named reversible Ruby workflow, convert to component in that same operation, and inspect face count before adding rotated instances.

## 6. Acceptance and Recovery

For a complex shell select sufficient normal-shaded perspective, orthogonal, plan and underside views to check the relationships below. Use [change-focused review](change-focused-review.md) to reuse adequate evidence; a simple curved member does not require five redundant captures:

- continuous curvature at shell, opening line, sill/head, and cap/parapet edge;
- wall-to-roof/support bearing, shell thickness, perimeter closure, opening reveal and skylight embedment;
- no planar panes, floating frames, self-intersections, roof penetrations, or faceted/stepped opening boundary;
- true plan taper and shared station correspondence;
- building-scale and relevant local views exist; add site-scale evidence only when site relationships are in scope.

If a shell looks valid in plan but fails close views, repair the topology/guide relationship—not the camera, material, or seam overlay. If a component array is empty, rebuild the definition in the named Ruby workflow. If the result is visually too coarse, increase station density and redistribute curvature before adding more decoration.

## Corpus Calibration

The 13 ancient and 7 curved readable samples support a layered construction grammar: parameterized curve → validated facade bay → tangent-aligned component array → floor-edge/spandrel → cap/termination → site. Use [targeted-ancient-curved-study.md](targeted-ancient-curved-study.md) for the evidence-backed bay sequence. The historical curved-tower regression demonstrates that many definitions without actual reuse is still a fidelity gap: convert a validated bay, mullion, transom, sill/head, slab edge, and terminations into reused definitions before claiming corpus-level fidelity.


2026-09-07 补充：按任务需要复用已确认的组件结构、宿主变换和建筑/环境边界；样本尺寸、功能和形态不是通用标准。
