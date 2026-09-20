# Chinese Ancient Architecture Rules

Read for Chinese traditional buildings, courtyards, temples, academies, pavilions, ancestral halls, or new Chinese architecture that requires credible traditional construction.

## Spatial Order
- Establish a north/south or project axis, entrance sequence, courtyard hierarchy, and primary view before ornament.
- Use a layered sequence: site wall/gate -> forecourt -> main courtyard -> covered transition -> principal hall or residential wings.
- Keep main hall, secondary wings, gate, service buildings, and landscape as independent groups; do not flatten the compound into one mass.
- Use symmetry for the main axis when the building type calls for it, and controlled asymmetry in secondary gardens, paths, planting, and service zones.

## Structural Grammar
- Model the timber frame as a readable system: stone or brick台基, columns, beams, purlins, roof frame, and infill walls.
- Use bay spacing as the base module. Define column grid and depth first; derive doors, windows, brackets, and roof members from that module.
- Separate台基, 柱, 梁架, 屋面, 檐口, 门窗, 墙体, and landscape into named groups/tags.
- Repeated columns, brackets, rafters, tiles, lanterns, and window modules must use component definitions where practical.

## Roof And Eaves
- Build roof curvature from a controlled profile and ridge/eave guide, not a flat extruded slab. For a visible upturned eave, define the end lift explicitly and sweep or loft the roof surface.
- Keep ridge, roof planes, ridge ornaments, eave members, rafters, tiles, gutters, and corner transitions separate so the roof can be corrected without rebuilding the hall.
- Verify roof pitch, eave depth, ridge height, corner lift, and drainage direction in section and perspective.
- Use tile courses or tile strips as repeated components; do not model thousands of unique tiles unless the close view requires it.

## Facade And Detail
- Concentrate detail at thresholds and roof edges: bracket sets, door frames, lattice windows, stone steps, balustrades, eave boards, and lanterns.
- Do not paste decorative Chinese motifs onto a modern volume and call it ancient architecture. The bay grid, roof,台基, structure, and courtyard order must agree.
- Material logic should distinguish roof tile, painted/dark timber, white or earth wall, stone base, paving, and landscape water/planting.

## Acceptance
- Main axis, courtyard proportions, bay grid, structural rhythm, roof section, eave treatment, and threshold sequence are inspectable.
- A close view validates one complete bay, one column/beam junction, one window/door module, one eave corner, and one roof tile/edge treatment.
- Repeated details are components and remain editable; no unexplained floating ornament or disconnected roof geometry.

## Targeted Corpus Calibration

The targeted corpus repeatedly exposes separate systems named for roof tiles, roof boards, purlins, raised roof profile, rafters, beams, gables, courtyard walls, gates, ridge tiles, pavilions, and bracket sets. Use `references/targeted-ancient-curved-study.md` for the evidence-backed build sequence and acceptance gate. Do not accept a model with only a massing box, a decorative roof plane, or floating brackets.

## Quality Rejection Gate From Visual Regression

The latest regression model and tile sample are rejected as final-quality ancient architecture. The following are explicit failure states:

- Long rectangular ribs on a sloped plane are not roof tiles. A tile system must show tile profile, thickness, overlap, drip/eave termination, ridge closure, and believable contact in a close view.
- A single planar roof slab with dark material is not a finished roof. The section must expose roof base, purlin/rafter rhythm, tile bedding, tile courses, eave board, ridge and corner transition.
- A stack of rectangular blocks is not a dougong/bracket set. The bracket sample must show attached column head, bearing block, layered arms, nose/tail, eave beam seat and end contact.
- A facade with three repeated door rectangles is not a traditional elevation. It needs frame depth, threshold, lattice/partition logic, wall-to-column relation, and a readable bay rhythm.
- A distant whole-model screenshot cannot validate detail. Create a separate close preview of one eave corner and one complete bay before arraying.

## Fine-Grained Ancient Modeling Protocol

1. Make a clean isolated detail test file or isolated named group, never test against an already cluttered production model.
2. Build one 1:1 or explicitly scaled eave bay in section: column head, bracket, beam, rafter, roof base, one tile profile, overlapping tile row, eave/drip tile, and ridge/end closure.
3. Inspect in plan, section and close perspective. Reject any floating, penetrating or world-axis misaligned member.
4. Only after the sample passes, turn the tile, rafter and bracket into components and array them along the bay grid.
5. Keep experimental versions separate from the production file. A rejected sample must be recorded and must not be merged merely because the audit counts increased.
6. Judge visible construction completeness at the target viewing distance, not a minimum count of entities or small details. Preserve identifying silhouettes and required close-view contacts; select detail levels deliberately. Read `chinese-tower-image-modeling.md` for measured source costs and straight-bay versus corner prototypes.

## Regression Evidence

The 2026-08-07 dougong/eave-corner/tile study produced versioned calibration findings (V2-V177). When iterating on an ancient detail hero node or recovering from a visual rejection, read `references/chinese-ancient-regression-findings.md`; those findings are hard gates for detail promotion.

## 2026-09-06 measured tower study

Read `chinese-tower-image-modeling.md` before tower or image-reconstruction work. Its evidence and diagrams are installed with this Skill. Apply courtyard/axis requirements only when the reference building supports them; do not invent a compound around a single tower. Source-model appearance does not prove historical joinery or a finished tile system.
