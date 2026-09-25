# Minimal Managed SketchUp Example

This is the shortest complete production pattern. It demonstrates control flow, not a building template.

## Begin

Inspect every provided source and call `sketchup_project_begin` with mode, source(s), output and project ID. For one image `source_image` remains valid; for multiple images pass every absolute path in `source_images` in the user's order. If composition needs it, add 1–8 observed projection targets; this brief is optional guidance, not a universal building contract.

Example `single_image` begin arguments (illustrative paths and bbox only; replace with inspected source data):

```json
{
  "mode": "single_image",
  "source_image": "D:/project/reference.jpg",
  "output_directory": "D:/project/output",
  "project_id": "BuildingStudy01",
  "projection_brief": {
    "targets": [{"id":"main", "role":"focal_building", "bbox":[0.18,0.18,0.78,0.92]}]
  }
}
```

For multiple user references, replace `source_image` with `source_images` and keep every image:

```json
{
  "mode": "single_image",
  "source_images": ["D:/project/front.jpg", "D:/project/side.jpg", "D:/project/detail.jpg"],
  "output_directory": "D:/project/output",
  "project_id": "BuildingStudy01"
}
```

Each bbox is normalized `[x0,y0,x1,y1]` inside `[0,1]`. One isolated building may have one focal target. Do not copy example bounds without reading the image. For uncertain composition read [projection-brief-guide.md](projection-brief-guide.md).

## Execute and Review

For every returned `next_action`:

1. write one `PipClawManagedBuild.build(entities, context)` file;
2. build only the requested scale;
3. use the applicable managed construction entry point; add registration metadata only when it helps track a real object or repeated system;
4. call `sketchup_project_step`;
5. inspect the returned review images yourself;
6. call `sketchup_project_review` with `revise` or `continue`; production continue requires the bound [quality_review record](managed-quality-review.md), including concrete visual observations and both check statuses.

Do not ask the user for routine phase approval.

## Phase Meaning

```text
massing: composition and major form
→ archetypes: complete reusable component(s), including repeatable detail
→ replication: true instances of accepted components
→ variants: controlled differences
→ facade_detail: non-repeating one-off details
→ finish: materials, closure and delivery
```

## Finish

Call `sketchup_project_finish` only at `ready_to_finish`. Completion requires `finished`, a real final `.skp`, final evidence and a response naming both paths. Every earlier state is **未完成交付**.
