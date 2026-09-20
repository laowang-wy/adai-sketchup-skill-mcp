# Projection Brief Guide

Use when a single image contains cropped foreground masses, background towers, courtyards, large voids or difficult perspective depth.

## Target Shape

```json
{ "id":"stable_name", "role":"visual_role", "bbox":[x0,y0,x1,y1], "cue":"optional visible evidence" }
```

Coordinates are normalized to image width and height. Current MCP requires ordered coordinates strictly within 0..1. For cropped subjects, mark the visible clipped bounds; do not infer their hidden full extent. The box check is composition-only, not a silhouette/landmark validator.

## Roles

- `focal_building` / `primary_building` / `main_subject`: dominant subject.
- `frame_left` / `frame_right` / `near_frame`: close cropped framing masses.
- `secondary_building` / `far_background`: composition-relevant distant bodies.
- `void` / `courtyard_edge`: major opening or gap essential to silhouette.

## Rules

- Use 1–8 targets, not every object.
- Include only composition-critical masses and voids.
- A cropped edge is a visible partial mass, not proof of a complete tower.
- Foreground frames normally project larger/lower than distant bodies.
- Do not include decorative context unless it controls architectural composition.
- Match bbox, overlap and depth order; keep hidden geometry neutral.

Reject massing when occupancy, overlap, left/center/right balance, near/far relation, horizon or focal silhouette is materially wrong.
