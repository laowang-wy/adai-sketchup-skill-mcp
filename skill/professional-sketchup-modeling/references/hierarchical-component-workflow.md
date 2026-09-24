# Hierarchical Component Workflow

Read for every building-scale SketchUp task before route-specific modeling rules. This is the universal construction order; building-type references only change the geometry grammar inside it.

## Why This Workflow Exists

Human modelers solve low-frequency decisions before high-frequency decisions:

1. whole-site and whole-building proportion;
2. level system and repeated floor families;
3. controlled differences between levels;
4. repeated bays and assemblies;
5. local details and finish.

A weak model fails when it tries to decide all five scales in one Ruby batch. Early proportional errors then spread through hundreds of repeated objects and become expensive to diagnose.

## Evidence From The 50-Model Study

The transferable findings in `learned-architectural-features.md` are:

- useful models establish massing, adjacency, site hierarchy and arrival before facade decoration;
- repeated windows, balcony slabs, railing panels, facade modules, unit blocks, trees and lights are component definitions with instances, not unrelated raw copies;
- families use controlled variation in width, setback, roof, bay and orientation rather than one unique object for every occurrence;
- strong buildings combine a few large quiet planes with thin repeated systems such as frames, slabs, fins, screens and shadow gaps;
- one representative bay, unit or construction node must be validated before propagation;
- component reuse only helps when local origins, host contacts, transforms, bounds and terminations remain correct;
- landscape is architecturally important, but decorative landscape must not pollute building bounds or conceal an unresolved building hierarchy.

Evidence limit: the corpus is strongest for villas, residential/community, fourth-generation housing, grouped buildings and site composition. It is not authority for every office, ancient or curved detail. The **workflow** transfers; exact forms still come from the task source and route-specific rules.

## Canonical Model Tree

This is a semantic example, not a second root or manual phase plan. Map systems inside MCP-owned current phase containers; do not create sibling phases to match this tree:

```text
Project_<project_id>
├─ 00_Evidence_Datum
│  ├─ axes / grids / level markers
│  └─ source and uncertainty metadata
├─ 01_Massing
│  ├─ major solids
│  └─ major voids
├─ 02_Level_System
│  ├─ Level_Archetypes
│  │  ├─ DEF_Level_Typical_A
│  │  ├─ DEF_Level_Typical_B
│  │  ├─ DEF_Level_Podium
│  │  └─ DEF_Level_Roof
│  ├─ Level_Instances
│  │  ├─ Level_02 -> DEF_Level_Typical_A
│  │  ├─ Level_03 -> DEF_Level_Typical_A
│  │  └─ Level_04_Unique -> unique definition derived from Typical_A
│  └─ Level_Schedule metadata
├─ 03_Vertical_Systems
│  ├─ cores / stairs / shafts
│  └─ continuous columns / structural spines
├─ 04_Component_Kits
│  ├─ facade bay definitions
│  ├─ opening / railing / balcony definitions
│  ├─ roof / eave / tile definitions
│  └─ room / furniture / landscape definitions
├─ 05_Roof_Ground_Interface
│  ├─ roof and terminations
│  ├─ plinth / terrain / retaining structures
│  └─ arrival / circulation
├─ 90_Site
├─ 91_Vegetation
├─ 92_Lighting
└─ 99_Views_Delivery
```

Do not use tags as a substitute for hierarchy. Geometry ownership comes from groups/component definitions; tags control visibility.

## Phase 00 — Evidence, Datum And Level Schedule

Establish before geometry:

- source authority and confidence;
- units and metric anchor;
- world origin, axes and north/front convention;
- site datum and finished-floor datum;
- level names, Z values and floor-to-floor heights;
- structural/bay grid where known;
- primary solids, primary voids and unresolved hypotheses.

A level schedule is a contract, not an incidental array inside a build script.

```json
{
  "levels": [
    {"name": "L01", "z_mm": 0, "archetype": "Podium", "mode": "unique"},
    {"name": "L02", "z_mm": 4200, "archetype": "Typical_A", "mode": "instance"},
    {"name": "L03", "z_mm": 7500, "archetype": "Typical_A", "mode": "instance"},
    {"name": "L04", "z_mm": 10800, "archetype": "Typical_A", "mode": "unique", "variant_reason": "setback terrace"}
  ]
}
```

## Phase 01 — Massing

Build only major solids and voids. Massing answers:

- total width, depth and height;
- ground contact and site relationship;
- wings, courtyards, atria and dominant voids;
- large setbacks, cantilevers, roof silhouette and circulation blocks.

Do not create windows, railings, facade grids, furniture, planting or materials. Use the smallest source-supported set of masses; there is no minimum mass count for a simple isolated subject.

Pass only when plan, front, side and hero/reference views agree. If pending massing is wrong, submit managed revise; if already accepted, use supported separate-project correction. Do not manually replace accepted groups.

## Phase 02 — Level Archetype Definitions

Classify levels before building them. Common archetypes include:

- ground/podium;
- typical residential/office/hotel level;
- alternate typical level;
- transfer/mechanical level;
- terrace/setback level;
- roof/penthouse level.

Create one definition for each justified repeated archetype. Build geometry at a stable local origin, normally with the level datum at local `Z=0`. Complete and validate the representative archetype before adding any instances; do not leave its repeatable facade detail for a later phase.

The archetype should contain every source-visible system that repeats with it:

- floor/slab and major envelope zones;
- main partitions or unit modules when source-authoritative;
- complete balcony/terrace, opening recess, window/frame/mullion, railing, fin, screen and shadow-line systems that repeat with the archetype;
- nested repeated component instances where a smaller reusable family is justified.

It should not contain continuous multi-storey systems that must connect across level boundaries.

## Phase 03 — Level Instances

Create the building stack from archetype instances placed at explicit level transforms.

Required metadata per instance:

- `level_id`;
- `z_mm`;
- `archetype`;
- `mode=shared` or `mode=unique`;
- source/confidence where applicable.

Validate:

- instance count and names;
- strictly ordered Z levels;
- floor-to-floor heights;
- alignment to axes/grids;
- total building height;
- first and last instance bounds;
- no unexpected non-uniform scaling.

Editing the archetype definition updates all shared instances. Use that behavior intentionally.

## Phase 04 — Unique Level Variants

A copied level remains shared until a real difference is established. Before changing only one level:

1. identify the source evidence or design reason;
2. create an owned variant instance in the current phase; use make_unique only on a current-phase instance;
3. rename its definition and instance;
4. record `derived_from` and `variant_reason`;
5. edit only the unique definition;
6. verify shared sibling instances did not change.

Valid variant reasons include a setback, terrace, transfer structure, double-height space, sky garden, roof transition, ground entrance or source-confirmed plan change.

Invalid reasons include “easier to edit”, “the model looked repetitive”, or accidental changes caused by editing a shared definition.

## Phase 05 — One-Off Detail And Interface Closure

Reusable kits belong inside the accepted archetype before Phase 03 replication. This later phase adds source-visible details that cannot be represented by the repeated component system.

| One-off condition | Geometry to build | Rule |
|---|---|---|
| entrance | canopy, portal, steps, lobby opening or signage frame | bind to the real podium/ground host; do not duplicate across typical levels |
| crown/roof | unique cap, penthouse interface, parapet termination | preserve the accepted archetype stack below |
| corner/end | end-bay closure, return frame, exposed slab edge | solve the actual termination, not a generic repeated bay |
| transfer/interface | podium-tower joint, bridge, expansion or structural transition | keep contact and hierarchy explicit |
| ancient/curved termination | end bracket, ridge end, tangent termination or special node | validate local views and host contact |

Do not rebuild repeated systems here. A wrong accepted archetype requires supported separate-project correction; this phase cannot rewind it.

## Definition, Instance Or Unique Group?

| Situation | Use |
|---|---|
| identical geometry repeated | one component definition + instances |
| same family with a few explicit variants | base definition + named variant definitions |
| one copied floor differs locally | `make_unique`, then edit and record reason |
| one-off mass or irregular site boundary | named group |
| continuous core/shaft/terrain system | separate named group or dedicated definition, not duplicated inside each floor |
| uncertain placeholder | reversible named group with confidence metadata |

## SketchUp/Ruby Rules

- Create prototype geometry inside `definition.entities`; place it with `entities.add_instance(definition, transform)`.
- Keep definition geometry local. Apply world placement once at the instance.
- Do not rotate a world-space bounding box again and do not multiply parent transformations twice.
- Avoid non-uniform instance scaling for architectural variants; create a named variant definition instead.
- Do not explode components during normal refinement.
- MCP owns abort/rollback. Resolve the original outcome before retry; do not manually abort or clean a phase.
- Implement the current scale in a `PipClawManagedBuild.build(entities, context)` file and pass it to `sketchup_project_step`; the MCP owns phase replacement and rollback.

Use [managed-ruby-api.md](managed-ruby-api.md) for separate archetype, replication and variant examples. Never target active_entities or edit already accepted instances.

## Different Building Types, Same Logic

- **Villa:** massing → complete ground/upper archetypes with window/railing detail → instances → unique entry/roof → site.
- **Residential/high-rise:** tower/podium massing → complete typical archetypes with facade bays → level instances → unique sky-garden/setback/entry/crown details.
- **Hotel/office/public building:** massing/atria → complete public/service level archetypes → level stack → unique lobby/terrace/mechanical/interface details.
- **Courtyard/grouped buildings:** site/courtyard massing → one building/unit archetype → rotated/setback instances → approved variants → gates/links/landscape.
- **Ancient building:** platform/bay/frame/roof massing → one bay or structural-node definition → measured instances → unique end bays/corners and one-off closures; repeated roof/eave/tile kits belong in archetypes before replication.
- **Curved building:** curve/shell massing → one tangent-aligned facade bay → parameterized instances → unique terminations → floor edges/caps.
- **Interior:** room/ceiling massing → one cabinet/furniture/lighting assembly definition → repeated instances → unique end/transition assemblies → material/detail pass.

## Gates For Weak Models

A weak model receives only the current phase packet. It must not be asked to produce the final building while deciding the massing.

At each gate report:

```text
Current phase:
Created definitions:
Created instances:
Unique variants and reasons:
Views checked:
Remaining mismatches:
Dependent phases invalidated:
Next permitted phase:
```

If the current phase fails, the next permitted phase remains unchanged.

## Anti-Patterns

Reject these states:

- one monolithic Ruby script builds massing, all floors, facade, site and export without intermediate audits;
- every floor is unique even though most are identical;
- every floor is a raw group copy rather than a component instance;
- a shared component is edited for a local exception;
- facade elements are copied before one host-scale sample passes;
- details are added to compensate for wrong total proportions;
- trees/site objects contaminate subject bounds or hide the building;
- downstream phases silently change massing dimensions;
- the whole model is cleared when only one phase is wrong.

## Final Audit

Before delivery verify:

- massing dimensions still match the accepted contract;
- definitions and instances have meaningful names;
- repeated levels use shared definitions where appropriate;
- unique levels have `derived_from` and `variant_reason`;
- nested component transforms are applied exactly once;
- first/last instances and unique variants pass host/bounds checks;
- continuous systems connect across levels;
- site/context is separated from subject bounds;
- verify final saved file and evidence; if supported reopen is possible without disrupting user work, check the exact saved path. Otherwise report reopen as unverified, never infer it from an in-memory audit.
