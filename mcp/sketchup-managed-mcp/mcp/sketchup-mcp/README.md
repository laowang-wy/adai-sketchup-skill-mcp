# SketchUp Managed MCP

Current managed-server version: 0.5.24.

This MCP controls the active SketchUp session through the local Ruby bridge while keeping production modeling behind a small managed API. Version 0.5.24 makes the standard human modeling order tool-enforced: massing → archetypes → replication → variants → visible facade detail → finish.

## Production API

Use only:

1. `sketchup_project_begin`
2. `sketchup_project_step`
3. `sketchup_project_review`
4. `sketchup_project_finish`
5. `sketchup_project_status` for recovery/readback
6. `sketchup_project_revise_from` for managed upstream revisions

Read-only ping, summary, audit and manifest validators remain public. Raw geometry, arbitrary Ruby, clear, transform and save tools are hidden from normal discovery and reject direct production calls.

### Assistance mode selection

New projects default to `guided`. The first non-empty task line `ADAI老王，开启专家模式` selects `autonomous`; `ADAI老王，开启引导模式` selects `guided`. The compatibility value `auto` also resolves to `guided`. The selected mode is saved in project state and isolated per project, so a restart does not re-route by model name. Guided mode provides more parameter help and method suggestions; autonomous mode keeps the same permissions, protections, quality gates and recovery rules while reducing repeated tutorial text. The host must identify the raw user command before MCP receives it; MCP-only tests report that boundary as `not_run`.

### Object patch boundary

`sketchup_project_patch` is closed in build `0.5.24-r3-su2019-20260919`: it is absent from production discovery and direct calls return `PATCH_NOT_RELEASED`. Internal engineering tests exercised unique-instance translation, protected-target refusal, review, rollback, recapture and save in SU2019. Recovery of unknown patch results, all shared ancestry paths and dependency-aware protection remain incomplete; these internal positive tests do not enable production use.

## Build-file contract

A step consumes a local Ruby file defining:

```ruby
module PipClawManagedBuild
  extend self

  def build(entities, context)
    # Add only the current scale of geometry to entities.
    { 'created' => 0 }
  end
end
```

The MCP owns the SketchUp transaction, managed root, phase group, rollback, current-document binding, evidence export and final save-copy. A build that changes geometry outside the managed root is aborted.

## Evidence barrier

Every successful geometry step automatically produces signed evidence and changes the project to `review_required`. Another geometry step is rejected until the Agent calls `sketchup_project_review` with `continue` or `revise`. `revise` removes only the current phase.

Evidence includes project-only recursive audit JSON, validation images, source comparison sheets when applicable, three automatic facade close-ups at the detail step, source/script/output hashes, phase counts/bounds, scale diagnostics and chained review records. State is stored at:

```text
%APPDATA%\SketchUpLiveMCP\managed-projects\<project_id>\
```

Records are tamper-evident through HMAC signatures. This prevents accidental or weak-Agent fabrication; it is not an OS security boundary against the same logged-in user.


## Quality gates (v0.2.1)

- A massing step has a geometric-complexity ceiling, preventing a whole detailed building from being generated before the massing review.
- The `archetypes` step must register at least two source-visible reusable systems. The `facade_detail` step registers source-visible one-off geometry with register_unique_detail; repeated balcony/window systems belong in the archetypes.
- The Ruby-side audit records these systems on the managed phase. Delivery is blocked if the final audited project has no such detail records.
- Detail review emits lower/middle/upper close-ups automatically; a generic material grid or line pattern is not accepted as a detail system.

## Final delivery

`sketchup_project_finish` uses SketchUp `save_copy`, verifies a nonzero file and SHA-256, writes a project-only final audit and preview, and seals the evidence chain. It intentionally does not reopen the copy because opening another model can trigger a dirty-model modal. The final evidence reports `save_copy_verified_nonzero` rather than overclaiming reopen verification.

## Diagnostic bypass

`SKETCHUP_MCP_UNSAFE_DIAGNOSTIC=true` exists only for MCP development, bridge self-tests and disposable cleanup. The supplied normal MCP preset does not enable it. Never use it for production modeling.

## Bridge installation

The SketchUp extension installer is `plugin/su_mcp.rbz`. Install it from SketchUp Extension Manager and restart SketchUp once. The default preset uses the local file bridge under `%APPDATA%\SketchUpLiveMCP\bridge`.

## Projection validation correction (2026-09-06)

Single-image projects accept 1–8 observed targets and require an actual focal/primary/main subject. Background-only briefs are rejected. Brief coordinates and audited projected bounds must be finite numeric ordered rectangles; malformed audits cannot pass via NaN comparisons. Tolerance must be finite and positive when supplied.

Review revision currently removes only the current phase, not earlier accepted phases. Massing geometry remains present in later phases; authors must plan retained cores and openings explicitly. These corrections were tested at the validator level; reference-image visual reconstruction has not been verified by this patch.

## Live lifecycle and axis validation (2026-09-06)

A real SketchUp 2019 run completed begin, all six managed steps, evidence review, ready-to-finish, save-copy and final evidence sealing. A diagnostic solid asserted X=4000 mm, Y=3000 mm and Z=6000 mm inside SketchUp. The previous audit incorrectly treated `BoundingBox#height` as architectural Z height and `BoundingBox#depth` as plan depth. In the SketchUp Ruby API these accessors map to X/Y/Z as `width/height/depth`; managed architectural reporting now maps them to width/depth/height as X/Y/Z.

The same correction is applied to project massing summaries, dominant-body footprints, facade close-up targeting, subject-bounds audit and active-model audit. Keep raw bounds arrays ordered `[min_x,min_y,min_z,max_x,max_y,max_z]`; label architectural sizes explicitly as `[x_width,y_depth,z_height]`.

A lifecycle diagnostic is not a source-fidelity approval. Test-mode evidence may omit a source comparison sheet and only proves transactions, isolation, review barriers, rollback, audit and delivery. Never cite it as proof that an image reconstruction resembles its reference.

## 2026-09-06 live fixes: evidence, isolation and stability

The curved-photo test reached `finished` on project `CurvedTerrace20260906C` after the following changes:

- Single-target image briefs no longer trigger generic multi-mass footprint rejection. Perspective, nonempty geometry, projection and visual review remain enforced.
- Archetype evidence includes signed prototype above/underside views. Numeric camera state is restored afterward; downstream source screenshots explicitly restore the accepted source camera.
- Before image export, `automaticEvidence` writes `phase-checkpoint.skp`, verifies nonzero output, and updates model binding if the save-copy fallback saved an unsaved model. It seals the checkpoint with phase evidence. Checkpoints are full-document, intermediate copies, not isolated final delivery or proof of review approval.
- A failed automatic-evidence rollback is no longer swallowed. It sets `recovery_required`, records the error and blocks replay. `status` reports `last_checkpoint` and an explicit recovery action.
- The Ruby helper supports opt-in machine-local `runtime-render-profile.json` under SketchUpLiveMCP. `disable_material_transparency: true` disables viewport transparent rendering without changing material alpha. This is a tested workaround for two local `nvoglv64.dll + 0xc3b6d4` access violations, not a universal driver repair. Three identical prototype build/export/remove cycles and the subsequent production lifecycle passed. Fast Feedback/AA changes alone had not prevented the second crash.
- External fingerprints treat face-camera component yaw and displayed world bounds as view-dependent, retaining definition geometry, placement, scale and tilt checks. Failed isolation writes a diagnostic diff instead of silently permitting external edits.

Development-time regression artifacts (single-subject-regression.cjs, rollback-regression.cjs, crash archives, phase evidence, BUGFIX-REPORT.md) are not shipped with this base; recreate them under your own project workspace when you need to re-run a regression. Existing 22 projection-validation checks still pass. The earlier test tower remains a simplified inferred study with opaque viewport glass; do not equate a successful lifecycle with photographic fidelity.


### Desktop viewport evidence and interrupted capture (2026-09-06)

Explicit machine-local `runtime-render-profile.json` `capture_backend: "desktop_viewport"` opts into real OS viewport captures and avoids offscreen `write_image` for phase/final evidence. Requires Python/Pillow, interactive Windows desktop and exact bridge SketchUp PID. The tool prepares viewport size before camera setup, validates foreground/modal/occlusion, compares actual camera before and after capture, and restores selection/camera. Evidence images are not composited substitutes.

`sketchup_project_diagnose_viewport(project_id)` captures diagnostic views without advancing status. `sketchup_project_retry_evidence(project_id)` handles `evidence_pending` without executing geometry: checkpoint/source hashes and live audit must match; successful capture returns `review_required`, never automatic approval. Normal step calls are blocked while evidence is pending. Restart/binding failure still requires supported recovery.

The local NVIDIA transparency workaround regressed. Isolated Mesa + desktop-only capture completed the detailed tower with transparent glass on 2026-09-06; neither renderer nor capture alone is proven universally stable. See professional-sketchup-modeling/references/managed-recovery.md for measured outcomes and limitations.


### Installed window_print backend (2026-09-06; supersedes desktop focus capture)

Machine-local `capture_backend: "window_print"` is active. Legacy `desktop_viewport` selects the same non-activating implementation. `capture_window.py` uses PrintWindow against the bridge PID and crops its model viewport. No mouse movement, foreground calls or resizing; a minimized window is temporarily restored without activation and minimized in finally. Pixel bounds/blank checks and camera checks remain; window failures use evidence_pending and retry_evidence, never an automatic focus fallback. Real six-view managed diagnostic passed with unchanged cursor/foreground. The compatibility capture_viewport.py no longer includes the old behavior. Recovery and Skill entry instructions were updated.


## Instance readback transport correction (2026-09-07)

`sketchup_read_instance_layout` now returns decoded readback JSON directly, with `transport.complete`, `transport.bytes` and SHA256, rather than the bridge's truncated `result_inspect`. It uses the existing captured stdout channel with a per-call frame marker. No bridge extension change or SketchUp restart is required. Missing, damaged or oversized (32 MiB JSON) transport fails explicitly. Traversal `truncated` and reasons remain separate and are never cleared. The checksum establishes transport integrity only, not signed geometry or visual acceptance. Existing server processes need normal reload; do not interrupt active modeling. Offline regressions: SKILL scripts/test_instance_transport.cjs and test_instance_readback_server.cjs; live SU round-trip remains unverified.
