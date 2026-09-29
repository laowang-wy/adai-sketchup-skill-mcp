# SketchUp Managed MCP

Current product version: **0.5.38**. Read [manifest.json](../../manifest.json) and [BUILD.json](../../BUILD.json) for package identity, and [RELEASE.md](../../RELEASE.md) for changes and validation scope. Start this package through `launch.cjs` as described in [INSTALL.md](../../INSTALL.md).

## Managed modeling

Use `sketchup_project_begin`, `step`, `review` and `finish`. The current task card supplies construction methods and the next action. A step accepts a `ruby_file` defining `PipClawManagedBuild.build(entities, context)`, or supported typed `operations`. MCP owns transactions, document binding, object protection, receipts and saved copies.

Guided projects follow their saved phase plan and review the current result before advancing. New expert projects use work units: after the required primary-form and applicable representative-component observations, related writes can continue before one review of the current result. Existing projects retain their saved strategy. See the bundled [Skill](../../runtime-support/professional-sketchup-modeling/SKILL.md) for exact mode commands and [expert guidance](../../runtime-support/professional-sketchup-modeling/references/expert-operation.md).

## Local changes and recovery

Use `step(operation_intent=update)` for supported local edits; find targets through existing object IDs or `geometry_diagnose`. This preserves unrelated geometry and can continue after an explicit post-delivery change request. `review(revise)` and `revise_from` remain available for broader revisions; choose their actual scope before applying them. [Operation reference](../../runtime-support/professional-sketchup-modeling/references/scoped-operations.md).

`sketchup_project_patch` remains absent from public discovery; direct calls return `PATCH_NOT_RELEASED`. This does not disable the released step/update path.

For unknown writes, inspect the original operation receipt and follow recovery. Committed geometry with missing evidence is retained; `retry_evidence` captures the current result without replaying geometry. See [recovery](../../runtime-support/professional-sketchup-modeling/references/managed-recovery.md).

## Evidence and delivery

Inspect the actual images and submit the visual conclusion. Signatures, object counts and registrations establish execution facts or diagnostics; they do not establish resemblance to the source. Geometry and input validation remain in the relevant execution interfaces.

`finish` saves and checks the deliverable and its current evidence. A usable chosen camera is kept; an unusable view is fitted for the saved copy and then restored in the live document. Saving does not itself prove reopening or architectural fidelity. Report those checks separately. The current capture backend and camera behavior are documented in [camera review](../../runtime-support/professional-sketchup-modeling/references/camera-capture-review.md) and [recovery](../../runtime-support/professional-sketchup-modeling/references/managed-recovery.md).

Read-only runtime, summary and audit tools support inspection. Raw diagnostic write tools are not production modeling routes. Historical implementation and validation records belong to their recorded builds; they are not additional current gates.
