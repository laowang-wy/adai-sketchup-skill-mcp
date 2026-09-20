# Targeted Study: Chinese Ancient and Curved Architecture

Read after the relevant production protocol (`chinese-ancient-architecture-rules.md` or `curved-architecture-rules.md`) when a model needs corpus-calibrated construction grammar. This study covers 13 ancient and 7 curved SketchUp-2019-readable samples from `H:\2024年SKU素材`. It is evidence for reusable structure and scale—not proof that any source is a complete construction document.

## What the Corpus Proves

| Family | Strong evidence | Do not infer |
|---|---|---|
| Ancient | Layered platform, bay/frame, roof board/purlin/rafter/tile, ridge, threshold, courtyard, repeated small definitions | Exact anonymous dougong shape from a layer name, material, or entity count |
| Curved | Separate shell/glass/metal/floor/landscape systems; repeated bay assemblies; cap/termination systems | That a curved shell with a few windows is an adequate facade |

Ancient source layer names commonly include `瓦`, `屋面板`, `檩条`, `举架`, `椽`, `梁`, `山墙`, `院墙`, `门`, `合院`, `屋脊`, `脊瓦`, `斗拱`, and `亭子`. Treat names as routing clues; validate actual close geometry before copying a detail.

## Ancient Transfer Sequence

1. Fix axis, courtyard rectangles, gate-to-hall sequence, platform, bay module, and column grid.
2. Build one complete bay: column, beam/tie, purlin/rafter, infill, door/window frame, threshold, and platform connection.
3. Derive the roof from ridge/eave/section guides; keep roof planes, eave boards, rafters, tile courses, ridge tiles, and terminals independent.
4. Validate one close detail kit: bracket, lattice door/window, stair, railing, lantern, and eave corner.
5. Convert only an accepted sample to components and extend along the bay grid.

A credible close roof edge exposes roof plane, under-eave/board, rafter rhythm, tile edge, and ridge/end termination. Use tile strips/courses for normal distance; reserve individual tiles for ridge/eave/hero views. A flat roof slab, floating bracket, or pasted motif fails the transfer gate.

## Curved Transfer Sequence

1. Classify curve and record center/radii or guide curves.
2. Make one real-radius facade bay: host contact, glass/infill, sill/head, vertical frame, transom, interior/exterior depth.
3. Pass plan and section: tangent/radial correctness, no planar gap or wall penetration.
4. Componentize and place by local tangent; do not transform from a world AABB.
5. Add floor-edge/spandrel and cap/parapet as independent curved systems; build end/termination bays separately.
6. Validate bottom, middle, top, termination, close bay, and site separately.

Reject `curved shell + floating flat windows`. Required systems are continuous shell/glazing curvature, frame depth, vertical/horizontal grid, sill/head, floor-edge/spandrel, cap, and termination modules.

## Evidence Limits and Use

- Ancient examples range roughly 129k–12.7m recursive entities with depth 5–13; curved examples roughly 40k–3.29m entities with depth 4–12. These are evidence of assembly density, **not targets**.
- A model must have source hash, active-path match, recursive audit JSON, and readable preview to count as a learned sample.
- `feature_profile=chinese-ancient` or `feature_profile=curved-architecture` is an audit signal only. Promotion still requires close visual validation.
- The current ancient regression is a construction-grammar prototype, not a finished ancient model. The current curved-tower regression shows that 924 definitions with only one definition reused at least five times and six instances is insufficient reuse; componentize validated facade systems before claiming corpus fidelity.

For detailed failure history, see `chinese-ancient-regression-findings.md`, `ancient-gates.md`, or the archived original: `references/archive/targeted-ancient-curved-study.full-20260824.md`.
