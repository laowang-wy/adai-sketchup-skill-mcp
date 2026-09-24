# CAD-to-SU Source Fidelity

Read whenever CAD, a floor plan, or user-confirmed layout is authoritative. Use [trace-manifest-schema.md](trace-manifest-schema.md) as the **only** trace-manifest schema; do not invent a project-local variant. This document defines what the source controls and how to prove the generated SketchUp model still matches it.

## Authority Boundary

The source controls object count, XY coordinates, footprint, rotation, room assignment, host/contact relationship, and opening direction. SketchUp may add Z dimension, construction detail, materials, seams, frames, handles, and nested component hierarchy **inside the validated footprint**. It may not redesign the plan.

Explicit source information overrides convention. Missing information becomes a recorded assumption, never a silent ergonomic/design improvement.

## Workflow

1. **Audit source read-only:** units, extents, every nonempty layer, entity count, block references/definitions, text, room labels.
2. **Classify layers:** retained, new, demolition/reference, furniture, fixture, annotation, or explicit exclusion. Every relevant nonempty layer must be mapped or excluded with authority and reason.
3. **Inspect block internals:** recover axes, anchors, contacts, rotation, and semantic role. Names and bounding boxes alone are insufficient.
4. **Write and validate `trace_manifest.json`:** use `validate_trace_manifest` or `scripts/validate_trace.py`; fix every ERROR before geometry.
5. **Generate source-aligned low-detail groups:** attach `source_handle`, `source_layer`, `source_kind`, and confidence to each target group.
6. **Validate against source:** coverage, counts, position, size, rotation, semantic anchors, host/contact, and approved additions.
7. **Freeze layout, then detail:** replace only the internals with professional components that keep validated transforms and footprints.
8. **Revalidate after refinement:** then run collision/circulation and save/readback validation.

## Default Exact-Interior Tolerances

Declare actual project tolerances in the trace manifest. If native source coordinates are available, start with:

| Check | Default |
|---|---|
| Wall/opening position | ≤2 mm |
| Furniture center or anchor | ≤5 mm |
| Footprint size | ≤10 mm |
| Rotation | ≤0.5° |
| Semantic counts | exact match |

Compare more than world AABBs: walls need centerline/face/thickness/joins/openings; doors/windows need host, operation, panel/track count, sill/head; beds need headboard/wall relation; seating needs room, rotation, count, and table relation; cabinets/fixtures need functional area, facing, contacts, clearance, and subparts.

## Known Failure Classes

- **Template substitution:** visually plausible furniture changes source anchor, role, or facing. Match footprint/anchor/rotation/count first.
- **Layer filtering:** selecting one wall layer and calling it complete omits retained/new/demolition/finish semantics. Inspect names, geometry, color, text, and user direction together.
- **False validation:** collision-free, richly detailed, or successfully saved geometry can still be source-wrong. Compare source and target, not target with itself.

## Permission and Reporting

Never silently add, remove, rotate, move, merge, or reclassify a source object. Do not add an unrequested lamp/plant/art/rug/chair/cabinet/wall; do not omit an unreadable block; do not merge retained/new walls into an untraceable group.

Final evidence reports layer coverage/exclusions, mapped counts by semantic class, maximum position/size/rotation error, missing source objects, unapproved additions, semantic-anchor mismatches, paired top-view/overlay evidence, collision/circulation result, final `.skp` path, and readback result. Source-fidelity errors are blocking; visual richness cannot compensate.
