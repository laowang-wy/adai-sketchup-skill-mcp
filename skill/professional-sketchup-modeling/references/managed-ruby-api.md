# Managed SketchUp Ruby API

Read before writing a managed build. The MCP owns transactions, identity, scope, evidence and save. Guided projects use phases; new expert projects use architectural work units. In expert projects `context['phase_group']` is the current system container, not a teaching-stage restriction. Registration examples below are reusable in a complete expert system; headings describe their role, not mandatory separate calls.

## Entry Point

```ruby
require 'sketchup.rb'
module PipClawManagedBuild
  extend self
  def build(entities, context)
    { 'created' => 0 }
  end
end
```

Useful context keys: `model`, `phase_group`, `project_root`, `project_id`, `phase`, `step_index`, `working_units`, `meters_to_inches`, `mm_to_inches`, `projection_brief`.

Never save/open/export, clear model entities, write outside `entities`, or manually alter managed state.

## Massing — Bind Real Projection Geometry

For `single_image`, bind every projection target to the actual visible-mass group:

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

Register at least one reusable source-visible system contained by the archetype; add further systems when the source/task contract calls for them:

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

Use true instances where repetition is actually required. In guided replication, reuse the reviewed prototype rather than redrawing it; expert may create a complete prototype and instances in one authorized unit. For guided projects, if an accepted prototype is wrong, call `sketchup_project_revise_from(project_id, target_phase, reason)` while the project is in an allowed state; it preserves a checkpoint and invalidates affected downstream phases. If the current operation is `evidence_pending` or `result_unknown`, finish the existing recovery chain first; do not replay the write.

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
construction algorithm. Return that mapping in `geometry_readback` with the actual
parameter/generator hashes, dependencies and write/readback timing; the existing
materializer builds review attachments. A returned report is not visual approval
or a whole-surface contact certificate. The `parametric-facade-bay` toolkit provides
a runnable example using ordinary face extrusion, including a finish readback.

- Use `.mm` on numeric values only.
- SketchUp `BoundingBox#width`, `#height`, and `#depth` are X, Y, and Z spans. For architecture report them as width=X, plan depth=Y, and building height=Z. Never label `bounds.height` as vertical height.
- Normalize face orientation before `pushpull`; verify resulting bounds.
- For a prism or extrusion, normalize and prune one canonical polygon ring before creating any side faces or caps. Triangulation, collinear-point removal and index remapping must use that same ring; never build side walls from the original ring and caps from a reduced ring. A closed solid must report `boundary_edges=0` in the actual guard readback.
- Before writing geometry helpers, read [entity lifetime and isolated construction](ruby-snippets.md#entity-lifetime). Create the empty owning group first; do not rely on an old Face or `all_connected` to collect results after topology changes.
- Keep definition geometry local and apply parent transforms once.
- Preserve host contact; inspect first/middle/last instances.
- Return a small Hash describing created geometry and required registries.
- Use `ruby-snippets.md` for tested openings, boxes and transform patterns.

## Verified lifecycle boundary

On 2026-09-06 a live SketchUp 2019 diagnostic completed all managed phases, reviews, `save_copy`, final audit and evidence sealing. This validates the managed lifecycle and dimensional audit only. It is not evidence of reference-image similarity. When the source or review sheet cannot be visually inspected, use `test` mode for diagnostics and say that visual reconstruction remains unverified; do not submit `continue` in a production `single_image` project based only on counts or hashes.

## Phase-method task cards (2026-09-07)

MCP task cards now include additive `method` fields with decisions, evidence checks, rejection conditions and a concise review-record schema. They are procedural guidance, not new tool arguments, automatic visual validation or permission to bypass phase restrictions. Project status also returns the current task card for resumed sessions. The runtime source is `modeling-method-cards.json` beside managed-project.js; SKILL's modeling-method-playbook.md supplies fuller explanations. The agent workbook remains outside signed evidence/state. Normal process reload is required for an already-running server to load code changes.

## Expert system operations

New expert projects may combine the above registrations and geometry methods in one system. Use `step` with existing `work_unit_id` or a descriptive `work_unit_name`; intent append/update/replace is bounded by the actual unit. A reviewed system may be edited again; capture and review the new result. Existing phase-based projects keep their saved strategy. See [expert operation](expert-operation.md) and [typed operations](scoped-operations.md).
