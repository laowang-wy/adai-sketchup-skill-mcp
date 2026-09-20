# Chinese Ancient Regression Findings — Distilled Gates

Read when: iterating on a Chinese ancient detail hero node (dougong, eave corner, tile field, ridge terminal) or recovering from a visual rejection.

This is the distilled gate list from 46 versioned regression rounds (V2–V177, 2026-08-07). Each gate names the failure mechanism that created it. The full per-version evidence log is archived at `references/archive/chinese-ancient-regression-findings.v2-v177-full.md`; consult it when you need the exact rejected/accepted version history. Core rules live in `references/chinese-ancient-architecture-rules.md`; the later Minnan rebuild gates live in `references/ancient-gates.md`.

Accepted baselines referenced below: **V14** tile section grammar · **V28/V30** single-jump contact chain · **V70/V71** tile contact/overlap microtests · **V72** isolated roof unit · **V79** profiled single-jump dougong · **V80** orthogonal corner topology · **V149** native Y-Z section microtest · **V176** corner rafter-fan topology.

## Current execution boundary

These are historical shape regressions. All production creation, visibility changes, evidence capture and saving must follow the current managed phase/API. Never execute archived export/clear/save snippets directly. Numeric sizes and topology below describe their source specimens; other buildings require source-calibrated dimensions and connections.

## 1. Visual Evidence Gates (apply to every hero node)

- Five-view normal-shaded gate is mandatory before acceptance: **front, strict side, plan, underside, perspective**. Transparency/X-Ray, entity counts, successful Ruby returns, and saved SKP files are not evidence (V2, V19-V24).
- Blank, clipped, camera-missed, or slab-dominated PNGs are **failed evidence** even when the geometry audit passes (V67-V68).
- Frame an isolated owned prototype through managed evidence; unrelated objects must not obscure the sample. Preserve external/template/user objects. Do not delete them for a clean screenshot (V70-V71).
- Use a **neutral timber palette** for acceptance images. Strong red/green/white diagnostic colors make disconnected parts look falsely structured (V25-V26).
- A sample that passes in isolation must be **re-checked after insertion** into the bay: parent hierarchy, display style, face materials, and fascia can make correct geometry read as vertical boards (V14→V15).
- Before rejecting inserted geometry, export three views: detail-only, context-hidden, and final composite (V17-V20).
- Never repair a visual failure by moving the camera, adding filler plates, stacking more layers, or strengthening colors (V112, V132-V133).

## 2. Dougong / Bracket Gates

- **Load path is a contact chain**: column head → root dou → profiled arm → intermediate dou → next arm → eave seat. A visible gap at any interface is a hard failure (V21-V24).
- **Same elevation is not contact; bounding-box overlap is not a bearing face.** Each interface needs a documented vertical bearing interval plus XY overlap, with the arm's horizontal **bearing shoulder extending into the next dou footprint** (V120-V126, V143-V148).
- **Stacked boxes and continuous extruded curved plates are not dougong.** Use short-member grammar: separate root bearing body + short arm + independent nose/terminal pieces. The bracket eye must be a bounded void between members, not a gap from misalignment (V2, V38-V55, V83-V84, V101).
- **Corner topology**: X and Y arms share one root dou at the common bearing node (L-shaped), never a diagonal block at the outer corner (V31-V34, V80, V103-V106).
- **One jump passes before a second jump exists.** No propagation to a production bay until the isolated node passes the five-view gate (V25-V30).
- Scale anchors from source corpus: small repeated dou ≈ 60×60×20 mm and 40×50×35 mm. These are specimen-specific measurements, not rejection thresholds for other buildings; calibrate member proportions from the current source (V47-V50).
- Build the section **natively in the Y-Z plane with explicit horizontal bearing polygons**, then extrude across X. Do not position curved noses by approximate world coordinates (V138-V149).
- An orthogonal/transverse branch must share the main load-path datum; it must not create a second unsupported vertical chain (V150-V152).
- When a junction fails, **move the host members** to fix it — never add a bridging block or filler pad (V112-V116).

## 3. Roof Tile And Substrate Gates

- The roof substrate is a continuous sloped/curved surface readable in perspective and section; rafters and tile instances cannot substitute for it (V2).
- Tile grammar (V14 baseline): X-Z curved barrel section extruded between exact slope guide stations, split into ~6 independent courses, with pan-tile valleys and a separate drip tile. World-coordinate construction, not post-creation rotation (avoids SU2019 transform ambiguity).
- **All roof layers derive from one shared station function**: eave station, ridge station, slope ratio, substrate thickness, rafter centerline, tile base, tile lift (V134-V135).
- Rafters are oriented prisms terminating below the eave board. A rafter crossing the tile bedding or continuing through the drip closure invalidates the field. **Never** approximate a diagonal member with a world-axis bounding box — it becomes a wall of vertical boards (V15-V17, V72).
- A tile field fails if: courses have no visible slope overlap, the eave tile-end face is unreadable, or drip/fascia closure is missing — even when each tile is individually grouped (V163-V164).
- Terminal tiles: edit/replace the existing tile definition at its real slope stations; do not overlay a second closure system on top (V65-V66).
- Roof support chain for composite integration: front wall/top plate → sloped lookout → eave purlin/roof base; wall-top bearing → mid purlin; rear column → ridge support (V172).

## 4. Eave Corner Gates

- Substrate, fascia/drip, tile edge, and corner-rafter fan use **separate sections and guides**; sharing stations is allowed, sharing offsets and profiles is not (V173-V175).
- Build each short section in the **local corner tangent/normal frame** and triangulate the loft between stations. Copying one world-oriented terminal profile to every station produces a faceted cluster (V173).
- Corner-rafter fan prerequisites: ≥4 rafters at distinct plan angles, explicit bearing at the wall/eave datum, one shared curved outer edge with ≥5 stations and a controlled lift profile. Validate plan and underside before adding substrate or tiles (V175-V177).
- A passing straight eave proves nothing about the corner (V172-V173).
- Triangle-face fallback is an SU2019 geometry safeguard, never visual acceptance (V173).

## 5. Integration And Datum Gates

- Local integration needs one explicit vertical datum chain: plinth → column shaft → column head → root dou → jumps → beam/eave seat. Do not place a low-origin detail inside a full-height column shaft (V92-V94).
- Derive column width, beam section, eave depth, and bracket projection from a **source-calibrated bay module** before inserting any detail; never shrink the detail against arbitrary context (V93-V94).
- Split integration into independently verified phases: clean model init → detail creation → context creation → transform/readback → camera/export. A `Deleted Entity` error in a long script is an execution-sequencing failure, not evidence against the coordinates (V95-V96).
- A mapped detail contacting the real column is still not accepted until the five-view gate passes at the real datum (V97).

## 6. Source Learning Boundary

- Three evidence classes: (a) whole-building visual density, (b) repeated member scale/material, (c) structural-node geometry. **Only (c) can calibrate a dougong hero node**; (a) and (b) constrain proportions but prove nothing about bracket grammar (V47-V50, Source Candidate Boundary).
- Layer names like `斗拱`/`檩条`/`瓦` in a source model are routing evidence, not proof that an anonymous component is a correct bracket (V47-V50).
- Anonymous wood components with complex geometry are not dougong unless visibly contextualized in the chain column head → dou → arm → dou → eave seat (Source Candidate Boundary).
- When extracting source components: normalize definition origin, unhide only inside a `save_copy` diagnostic board, and assert board bounds + instance count. A blank preview invalidates the extraction (Source Candidate Boundary).

## 7. Script And Execution Hygiene

- Assert required group names exist before saving; copied scripts can silently omit members (V139-V142).
- A generated Ruby file containing literal `\n` text is a script-generation bug — discard the run, it is not a geometry result (V119).
- Historical V17–V20 used direct `active_view.write_image`; that execution method is superseded. Request evidence through managed MCP, validate the actual camera and returned close view, and use evidence retry on capture failure.
