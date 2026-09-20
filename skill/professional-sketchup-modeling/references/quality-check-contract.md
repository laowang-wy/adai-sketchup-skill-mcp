# Quality checks: measurements and review are separate

## Status contract

- `provided`: an evidence file exists; its contents have not been professionally accepted by the checker.
- `unverified`: no applicable verification has been established.
- `pass` / `fail`: only for the named check and its stated scope; never promote to overall fidelity automatically.
- `invalid`: malformed or insufficient measurement input; blocks numeric acceptance.

`verify_model_delivery.py` retains its existing CLI and `ok` compatibility field. `ok_scope=artifact_checks_only`; `acceptance` and `reopen` remain unverified. Nonempty topology/projection/form files are provided, not pass. In-memory path agreement does not prove reopening. Record managed finished state and actual visual/reopen review separately using returned MCP evidence; do not manufacture signed approval files.

## Offline numeric checker

Run `python scripts/validate_geometry_measurements.py --input measurements.json --report measurement-results.json`. This can run offline, and the installed MCP review adapter reruns submitted input through this checker. It is not a SketchUp exporter. See [managed-quality-review.md](managed-quality-review.md). Collect actual measurements through supported read-only audit or within the permitted managed build scope. Do not invent measurements to satisfy a check. Preserve entity paths, source audit/evidence location and units. Missing data remain unverified; the checker cannot authenticate the supplied measurements or replace visual inspection.

Input root: `units` (mm, cm, m, in or ft; all lengths use this unit), `checks` (array). Every check has `id`, `kind`, `entity_path`, `source_evidence`.

| kind | Required fields | Meaning |
|---|---|---|
| rigid_transform | parent_to_local_chain, expected_world_axes, dimensionless_tolerance, angle_tolerance_degrees | Root-to-leaf local-to-parent affine matrices, each row-major 4×4 using column vectors; multiplied in listed order. Three expected unit orthogonal axes come from the actual host. Checks composed scale, shear, mirror and direction. |
| centered_thickness | minimum, maximum, column_axis, length_tolerance | Thickness extents and column axis in the SAME local frame; compares their midpoint. |
| wall_head | wall_top, beam_underside, expected_gap, length_tolerance | All elevations in the SAME world datum; compares measured and designed gap. |

SketchUp's flat transformation array must be converted to the specified row-major representation explicitly; never pass it unchanged. Set justified tolerances per project and target scale, not generic precision claims. A real mirrored variant is not a rigid right-handed prototype: use the separate mirrored_transform contract with a reason and intended left-handed host axes; rigid_transform remains strict. This numeric helper does not export geometry or verify bearing-face intersection. Bounded instance transform readback and definition/origin coverage are now documented in [instance-layout-contract.md](instance-layout-contract.md); they do not establish surface overlap or contact.

Example wall measurement:

```json
{"units":"m","checks":[{"id":"floor_2_wall","kind":"wall_head","entity_path":"project/floor_2/wall","source_evidence":"actual-audit.json","coordinate_frame":"world:model-origin","wall_top":5.0,"beam_underside":5.0,"expected_gap":0.0,"length_tolerance":0.002}]}
```

The numbers above demonstrate input format only. Actual projects require real measurements.

## Minimum review record

For each relevant prototype/placement, record entity path, source image/view, observed constraint, measured value/tolerance when applicable, inspection result, evidence path and remaining unknowns. Cover lower/middle/upper stories, straight and corner nodes, first/middle/last and opposite-side occurrences. Inspect duplicate placements and hidden project roots explicitly until supported automated extraction exists. Numeric passes do not prove roof topology, photograph resemblance, joinery or contact surfaces.

## Structured feedback (review merge, 2026-09-07)

Each result preserves `check_id`/`id`, `entity_path`, `coordinate_frame`, `expected`, `measured`, `units`, `evidence`, `affected_dependencies` and `suggested_next_inspection`. Existing `measurements` remains an alias for compatibility. `coordinate_frame` names the shared local/world datum and is required for numeric pass of centered_thickness/wall_head. Missing identity yields arithmetic_state=pass but state=unverified when arithmetic succeeds. Optional measurement_frames maps each measured field to that same identity; conflicting/missing entries in a supplied map fail. This declaration is not authenticated geometry readback. Dependencies are caller-supplied, not inferred from model geometry. Suggestions identify inspection directions, not a proven cause or automatic repair.

Unknown check kinds return `unsupported`; a report containing only passing and unsupported checks remains `unverified`, never pass. Malformed checks fail. In particular, a supplied bounding-box intersection does not establish surface contact. This remains an offline checker over supplied measurements, not authenticated live MCP readback.

The following proposed capabilities are **not implemented** by this update: source landmark/silhouette projection, live SU parameter-graph invalidation, actual SU interface measurement, duplicate-position extraction, and general geometric construction helpers. Implement each with controlled positive/negative tests followed by a small managed live-readback trial. Do not mark them live merely because a task card mentions them.

## Declared dependency check

[parameter-dependency-contract.md](parameter-dependency-contract.md) describes the implemented offline graph/version checker. It detects declared downstream staleness, cycles and unit mismatches; it neither discovers actual SU dependencies nor regenerates geometry. A graph pass leaves geometry readback unverified.

## Hardening (2026-09-07)

Duplicate check IDs and unsupported length units are rejected. A negative arithmetic result still fails even when the frame is absent. Source evidence must be a nonempty string, but existence/content is not authenticated by this numeric helper. Every report preserves geometry_readback/evidence_authentication=unverified. CLI refuses to overwrite its input.

## Residential additions

Supported kinds now also include `mirrored_transform` and `instance_layout`. See [instance-layout-contract.md](instance-layout-contract.md) for exact fields, scope, limits and active-readback verification status. They use the existing MCP geometry review input; no extra approval workflow. The older capability list above describes gaps beyond the now-implemented bounded transform/origin checks, not a blanket claim that no instance reader exists.
