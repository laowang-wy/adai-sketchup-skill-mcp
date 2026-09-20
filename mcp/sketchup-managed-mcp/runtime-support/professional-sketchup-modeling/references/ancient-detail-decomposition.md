# Ancient Detail Decomposition From Visual Samples
Read before building an isolated Chinese-ancient eave/bay hero sample. It defines the visible six-layer target and the minimum close-view acceptance.


This is the visual decomposition used before the next regression build. It is based on the readable close facade sample `targeted-004` and the courtyard/academy samples `targeted-003`, `targeted-008`, and `targeted-013`.

## Six-layer eave sample

1. **Roof substrate**: a real sloped surface with a section that meets the wall and purlin; never a detached black plane.
2. **Rafter field**: short rafters terminate at the eave board and meet the purlin/ridge direction; no member may cross the ridge or float beyond the eave.
3. **Tile field**: individual or small grouped tile profiles overlap in the slope direction; the visible lower edge has a drip tile/nose rhythm, while the ridge has separate ridge tile closure.
4. **Eave curve and wing corner**: the eave line rises at the corner. The corner is a separate transition module, not a square roof-plane intersection.
5. **Dougong and painted timber**: column head -> bearing block -> layered arm -> nose/tail -> eave beam seat. Color bands and fascia are separate shallow members.
6. **Threshold/facade**: stone base and steps -> frame depth -> lattice/partition -> door leaf and threshold. Flat dark rectangles fail the sample.

## Next sample acceptance

The isolated detail must show all six layers in one close perspective and one section view. Use bounding-box overlap only as a broad screening test: it does not prove contact. Check transformed surfaces/connection endpoints and their gaps at the intended scale, inspect a section and close perspective, and reject penetration or floating parts. Only after it passes may the sample be converted into components and repeated across the hall.

## Rejection record

The current regression's roof ribs and the separate tile display board were rejected. They increased entity counts but did not reproduce the visual construction language of the source models. This record prevents treating semantic names or component counts as a substitute for visual fidelity.

## Straight bay and corner are separate prototypes

Read `chinese-tower-image-modeling.md` and inspect the installed straight/corner bracket diagrams before selecting a family. A corner may need diagonal and multi-directional arms; rotating an ordinary bracket alone is not proof of a valid corner. The six-layer hero sample applies where the reference and close-view delivery require those elements; do not add unsupported bracket systems to every traditional building.
