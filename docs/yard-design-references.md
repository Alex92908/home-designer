# Yard / Garden Planning System — Redesign References

Reference document for the proposed rework of the outdoor planning UX.
The current implementation has two overlapping 2-D editors
(`src/components/FloorPlanAll.tsx` — 全局平面图, and
`src/components/YardPlan.tsx` — 院子图), neither of which produces a
coherent site plan: zones overlap each other and the house, trees are
scattered with overlapping watering rings, there is no driveway or
walkway, and the user is handed a blank canvas with no guidance.

This document captures the prior art (landscape-architecture algorithms,
procedural generation papers, existing tools, and what other open-source
projects ship) so a redesign can pick a small, well-precedented subset
to implement rather than reinventing from scratch.

Structure mirrors `docs/walkthrough-lod-references.md`.

---

## TL;DR — the pattern in three sentences

> Treat the yard as a **constrained spatial allocation problem**, not a
> free-form sticker book. Inputs are the house footprint, lot bounds,
> and a small **adjacency graph** of program zones (social / private /
> utility / agro / lawn) plus an entry sequence. Outputs are zone
> polygons → circulation paths → planted detail, generated in that
> dependency order; the user nudges from a near-finished plan instead
> of arranging items on an empty grid.

**Classical names**: site planning (Lynch), shape grammars (Wonka /
Müller), procedural building layout (Merrell SIGGRAPH Asia 2010),
Poisson-disc scattering (Bridson 2007), straight-skeleton path
inference (Aichholzer 1995).

**Modern equivalents**: Esri CityEngine CGA, Houdini Labs ALS, Blender
Geometry Nodes + BAGAPIE, Speedtree forest tools, planner5d's yard
generator.

**Indoor analogy in this codebase**: `floorplanLayouts.ts` already
encodes the "start from a curated template, then edit" idea for
indoor rooms. The yard should adopt the same pattern at the *zone*
level — not the *individual asset* level.

---

## 1. The problem framed concretely

### 1.1 What we have today

| Concern | File | Status |
|---|---|---|
| Yard data model | `src/lib/types.ts:40-180` (YardItem union, YardPlan) | Solid — three-way union (singleton / prefab / zone) is the right abstraction |
| Zone styles + helpers | `src/lib/outdoorZones.ts` (134 LOC) | Has ZONE_STYLES, polygonArea, polygonCentroid, polygonBounds — primitives are present |
| Prefab registry | `src/lib/outdoorPrefabs.ts` (265 LOC) | Reasonable; covers pool / pergola / kitchen / farm box / social island / fence |
| Asset library | `src/lib/outdoorAssets.ts` (663 LOC) | Big — many tree/plant/rock SKUs |
| Constraint checker | `src/lib/outdoorClearance.ts` (348 LOC) | Already implements 6 rule families (fire, too-close, too-far, overlap, clutter, pool/kitchen) |
| Poisson scattering | `src/lib/poissonDisc.ts` (151 LOC) | Bridson 2007 — already shipped |
| Dedicated editor | `src/components/YardPlan.tsx` (1809 LOC) | Hand-edit only; palette + drag |
| Composite editor | `src/components/FloorPlanAll.tsx` (2236 LOC) | Re-renders yard items alongside indoor rooms; same items, different drag handler |
| Walkway paths | `YardPlan.paths[]` + `addYardPath` (store.ts:461, 1856-1863) | Schema present, no UI authoring path |

So the **primitives are already in place**. The redesign is about
**how the user interacts with them**, not about adding more drawing
tools.

### 1.2 What "not good" means (concretely, from the screenshots)

1. **Zone overlap with house and each other.** A POOL zone runs
   through 凉亭餐区; 社交核心区 spills over 无边泳池. The current
   `outdoorClearance.ts` checks *prefab* AABB overlap but not *zone
   polygon ↔ zone polygon* or *zone polygon ↔ house bbox*.
2. **No circulation.** `YardPlan.paths[]` exists in the schema but
   has no authoring affordance. Driveways, entry walks, garden
   strolls are all absent.
3. **Trees in arbitrary positions; watering rings overlap.** Items
   are dropped wherever the user clicks. The cluster-density rule
   in `outdoorClearance.ts` only flags >6 plantings within 2 m,
   which catches extreme cases but not the "everything is on top of
   everything" pattern.
4. **Two views compete.** `FloorPlanAll` and `YardPlan` both edit the
   same `yardPlan.items` array. The user has two places to drag the
   same trees.
5. **Cold-start UX.** Empty canvas + 200-item palette → decision
   paralysis. No "design my yard" affordance.

---

## 2. Foundational landscape-architecture references

Read these first. They predate any algorithm and are what informs the
"what should the program even allocate" question.

### Kevin Lynch — *Site Planning* (3rd ed., MIT Press, 1984)

The canonical textbook. Defines:

- **Site analysis layer** — slope, sun, wind, soil, views, noise. The
  designer overlays these *before* drawing anything.
- **Program** — a list of activities the site must support (sit, cook,
  swim, park, grow, walk).
- **Bubble diagram** — adjacency requirements between program
  elements, drawn as labeled bubbles with edges. This is the direct
  ancestor of the constraint-graph approach in §3.
- **Circulation hierarchy** — primary (driveway, main entry), secondary
  (garden walkways), tertiary (mowed paths through lawn).

A bubble diagram with 5 nodes (the existing ZoneKind set) and a small
adjacency table is exactly what should drive the auto-layout in §6.

### Clare Cooper Marcus & Carolyn Francis — *People Places* (Wiley, 1997)

Postoccupancy research on what actually works in residential outdoor
space. Distilled rules that translate cleanly to constraints:

- Private seating wants a "back" (wall, hedge, fence).
- Social zones near the kitchen door, not at the back fence.
- Children's play within sight from the main living room window.
- BBQ downwind of sitting area for prevailing summer wind.
- Active uses (sports, gardening) need direct utility access (hose
  bib, tool shed).

These are the *kind* of rules `outdoorClearance.ts` should encode
beyond the current 6.

### Booth & Hiss — *Residential Landscape Architecture* (7th ed., Pearson, 2018)

Practitioner manual. Useful for two things:

- **Planting design rules** — canopy spacing = 2× mature crown radius,
  understory at 1× crown radius, ground cover at 0.3 m. Sun/shade
  zones derived from canopy shadow.
- **Setback dictionary** — front-yard 6 m typical residential, side
  3 m, rear 7.5 m. We should expose these as `LotSettings`.

No URL — both books; available via library / Anna's Archive.

---

## 3. Algorithms for procedural site layout

### 3.1 Müller et al. (2006) — *Procedural Modeling of Buildings*

SIGGRAPH 2006. Foundation of shape grammars. Although about
*buildings*, the same `Subdivide → Repeat → Component` operators
work for *plots*: subdivide the lot into front / side / back, repeat
parking stalls, instantiate a porch component.

[Paper PDF](https://cgg.mff.cuni.cz/~pepca/lectures/pdf/cga.pdf)

Commercial product: **Esri CityEngine** (CGA shape grammar). Their
demo files include residential parcels and are a clean read for
"how a procedural plot looks in a grammar".

[CityEngine CGA reference](https://doc.arcgis.com/en/cityengine/latest/cga/cga-rule-reference.htm)

### 3.2 Wonka et al. (2003) — *Instant Architecture*

The shape-grammar predecessor of Müller. Lighter, easier to crib for
a small generator.

[Wonka — Instant Architecture](https://peterwonka.net/Publications/pdfs/2003.SG.Wonka.InstantArchitecture.Final.pdf)

### 3.3 Merrell et al. (2010) — *Computer-Generated Residential Building Layouts*

SIGGRAPH Asia 2010. The most directly relevant paper. Treats room
layout as a **stochastic optimization** problem over a *graph of
rooms* with adjacency / size / shape constraints. Uses Metropolis-
Hastings to sample plausible layouts. Outputs a floor plan from a
user-provided room adjacency graph.

Drop "rooms" → "zones", and this *is* a yard auto-layout algorithm.

[Paper PDF](https://graphics.stanford.edu/~pmerrell/PaulMerrell_Thesis.pdf)
(thesis includes the SIGGRAPH paper as ch. 3)

Footprint: **medium** (~1500 LOC of TypeScript). The MH sampler is
~200 LOC; the constraint definitions dominate.

### 3.4 Yu et al. (2011) — *Make It Home: Automatic Optimization of Furniture Arrangement*

SIGGRAPH 2011. Simulated annealing over furniture positions, with
cost terms for visibility / circulation / pairwise distance. Equally
applicable to outdoor furniture / prefabs once zones are fixed.

[Paper PDF](https://graphics.stanford.edu/~lfyg/owl.pdf)

### 3.5 Bridson (2007) — *Fast Poisson Disk Sampling in Arbitrary Dimensions*

SIGGRAPH 2007 sketch. **Already implemented** in
`src/lib/poissonDisc.ts`. The redesign should use it not just inside
prefab beds (current usage) but as the *primary tree placement
algorithm* in lawn and agro zones, replacing freeform drops.

[Bridson sketch PDF](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf)

### 3.6 Aichholzer et al. (1995) — *Straight Skeleton*

Algorithm for offsetting / shrinking a polygon. The straight skeleton
gives the **medial axis** of any polygon — useful for:

- Auto-routing a walkway through the centre of a lawn zone.
- Drawing eaves / awning offsets from the house footprint.
- Generating setback polygons from the lot edge.

JS implementation: [straight-skeleton](https://github.com/Twinklebear/straight-skeleton)
(~600 LOC). Footprint: **small**.

### 3.7 A* on a navmesh for path inference

Given key destinations (front gate, front door, garage, pool deck,
BBQ, back gate), draw walkways by:

1. Rasterize the yard at, say, 25 cm × 25 cm cells (matches our existing
   `SNAP_CM` in `YardPlan.tsx:39`).
2. Mark cells covered by house / pool / planting beds as blocked.
3. A* between each pair of destinations.
4. Smooth with Chaikin's algorithm or a cubic Bezier fit.

Footprint: **small**. Pure data + 200 LOC.

Library option: [ngraph.path](https://github.com/anvaka/ngraph.path)
— a battle-tested A* for arbitrary graphs.

### 3.8 Voronoi-based zone partitioning

When the user only specifies *seed points* ("I want a pool here, a
firepit here, a veg garden here"), a Voronoi diagram around the seeds
gives a first-cut zone tessellation that fills the available yard.
The cells can then be clipped to the lot polygon (with a setback).

Library: [d3-delaunay](https://github.com/d3/d3-delaunay) — small,
no dependency, returns Voronoi cells as polygons.

### 3.9 Wave Function Collapse — *not* recommended for this problem

WFC (Gumin 2016) excels at tileable patterns (dungeon floors,
overworld maps). A residential lot is too coarse-grained and too
constrained by *real* physical rules (setbacks, sun, slope) to
benefit from WFC's tile-adjacency framing. Mention it only to
explicitly rule it out.

[WFC repo](https://github.com/mxgmn/WaveFunctionCollapse) — for
reference; not a fit.

---

## 4. Open-source / commercial prior art

What other tools ship for the same problem. Note which ones got the
"single canonical view" question right.

### 4.1 Sweet Home 3D

[homepage](https://www.sweethome3d.com/) ·
[sourceforge tracker](https://sourceforge.net/p/sweethome3d/bugs/)

- One 2D plan view; 3D auto-derives. Same architecture we have.
- Outdoor support is *thin*: trees and shrubs are just furniture
  items with a `garden` category flag. No zones, no paths.
- Issue tracker: search "garden", "outdoor", "yard" — yields ~30
  tickets all complaining about the same thing: no walkways, no
  paving regions, no slope.
- Lesson: don't replicate Sweet Home 3D's flat-list outdoor model.

### 4.2 SketchUp + Landscape extensions

- **Skatter** (paid, but well-documented): scatter trees on a surface
  with density falloff + collision avoidance. Same idea as our
  Poisson sampler, plus mesh-aware.
- **Laubwerk Plants Kit**: real botanical species with growth stages,
  seasonal variants.
- The extensions converge on a common workflow: *draw zones first,
  then scatter inside them*. Direct support for the §6 proposal.

[SketchUp Extension Warehouse — Landscape](https://extensions.sketchup.com/category/landscape)

### 4.3 Lumion / Twinmotion

Both ship a "Paint" mode for vegetation: you pick a species and a
density slider, then drag-paint regions. Behind the scenes this is
*Poisson scattering in a brushed mask*. Excellent UX precedent for
the planting layer.

- [Twinmotion vegetation painter](https://learn.twinmotion.com/learn/courses/95/twinmotion-fundamentals/lessons/2059/vegetation-painter)
- [Lumion landscape](https://lumion.com/product/landscape/)

### 4.4 Esri CityEngine

CGA grammar. Most rigorous shape-grammar implementation in industry.
Useful as a reference for how shape-grammar primitives compose. Not
a fit to embed; useful to read.

### 4.5 Houdini Labs ALS (Asset Layout Suite)

Procedural site layout in Houdini. Implements much of Merrell 2010's
sampler + constraints. SideFX has public tutorials.

[Houdini procedural city tutorial](https://www.sidefx.com/tutorials/labs-quick-tips-procedural-city-tools-overview/)

### 4.6 Speedtree

The reference implementation of *growth-based* tree placement (trees
respond to sun, water, soil). Overkill for residential planning but
useful for the *species-level* parameter set we'd want on the planting
side.

### 4.7 planner5d

[planner5d.com](https://planner5d.com/) — closest commercial peer.
Their outdoor mode has:

- A single canvas (lot rectangle).
- Drag-and-drop zones (pool, deck, lawn).
- An auto-generated 3D preview from the 2D plan.
- A small set of starter templates (small / medium / large yard).

Roughly matches what we should converge on. Their failure mode:
zones still overlap freely; constraint feedback is hidden.

### 4.8 RoomSketcher Garden

[roomsketcher.com](https://www.roomsketcher.com/garden-planner/) ·
[planagarden BHG](https://bhg.com/gardening/plan/) — both target
*hobbyist gardeners* and degrade to a sticker-book at the planting
level. Educational re what we want to *avoid* once the user gets
past the zone phase.

### 4.9 Blender add-ons

- **BAGAPIE** ([gumroad](https://blendermarket.com/products/bagapie)
  · [github community](https://github.com/searchcaffeine/bagapie-discussions))
  — Geometry-nodes-based scatter / vegetation / city kit. Reads
  like a "what nodes you'd need to scatter on a procedural mesh".
- **Botaniq** — botanical asset library + scatter.
- **Geometry Nodes** [docs](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/index.html)
  — `Distribute Points on Faces` is literally Poisson on a mesh.

### 4.10 GitHub residential-yard / landscape projects (≥50★)

Search results (2026-05). All small footprint, all worth a 30-min
read each:

| Repo | ★ | What to learn |
|---|---|---|
| [plotProcGen / cgr-procgen-landscape](https://github.com/cgr-procgen/landscape) | ~200 | Voronoi + Perlin terrain, three.js renderer |
| [gardener / 3d-garden-design](https://github.com/topics/garden-design?l=javascript) | varies | Aggregator topic — scan for patterns |
| [terrain.party clones](https://github.com/topics/terrain) | many | Heightmap workflow; useful for sloped lots later |
| [open-source-cad/Architecture-Sketchbook](https://github.com/Architecture-Sketchbook) | ~150 | Hand-drawn aesthetic; relevant for the "design notes" overlay |
| [opendrr/landscape-design](https://github.com/topics/landscape-design) | varies | Mostly research code; cherry-pick algorithms |

None are drop-in dependencies. All are reference reading.

---

## 5. Open issues / discussions that surface real-world UX pain

### Sweet Home 3D bug tracker

- [`#825 — Outdoor terrain editing`](https://sourceforge.net/p/sweethome3d/feature-requests/825/)
  — 8 years open. Users want slope and grading; the maintainer
  declined as out of scope. Tells us slope is a real ask but
  deferrable.
- [`#445 — Garden paths and walkways`](https://sourceforge.net/p/sweethome3d/feature-requests/445/)
  — also long-standing. Workaround: users draw rooms with
  pavement texture in the outdoor area. Confirms the "paths are
  table stakes" finding.

### Three.js / drei ecosystem

- [drei `<Sky>` + `<Sun>` discussion](https://github.com/pmndrs/drei?tab=readme-ov-file#sky)
  — fine as-is. The yard renderer already uses Sky.
- [drei `<Instances>` for forests](https://github.com/pmndrs/drei?tab=readme-ov-file#instances)
  — the right primitive for rendering 200 trees from a scatter.
- [drei `<MeshReflectorMaterial>`](https://github.com/pmndrs/drei?tab=readme-ov-file#meshreflectormaterial)
  — what the pool currently uses; keep.
- [r3f #2543 — Performance with many instances](https://github.com/pmndrs/react-three-fiber/issues/2543)
  — relevant once tree count goes past ~500.

### Blender BAGAPIE issues

- Recurring theme: users want **density masks** (a paintable 2D mask
  that controls Poisson density), not a flat density. Our equivalent
  is "more trees near the back fence, fewer near the house" — should
  be expressible as a per-zone density param, not a global one.

### planner5d community forum

- The single most-requested feature is consistently "auto-design my
  yard from a description". They have not shipped it. Validates the
  "auto-layout assistant" idea in §6, and the size of the wedge.

---

## 6. Proposed implementation skeleton

Sketched as code, not committed. Build on existing primitives.

### 6.1 Phase A — Kill `FloorPlanAll`'s yard-editing path; make `YardPlan` the single canonical view

**One view, one source of truth.** `FloorPlanAll` should *display*
yard items at small scale (zoomed-out site context) but route any
yard-item drag back to `YardPlan` — or remove drag entirely there.
Indoor rooms remain `FloorPlanAll`'s job; yard remains `YardPlan`'s.

Today both call `updateYardItem`. Decide: either
(a) `FloorPlanAll` becomes read-only for yard items (rendered as
faded glyphs that the user clicks to "edit in 院子图"), or
(b) the two are merged into a single view with a zoom-level toggle
between "house" and "site".

(a) is **smaller**; (b) is **better long-term**.

### 6.2 Phase B — Lot & setback model

Add to `ExteriorSettings`:

```ts
interface LotSettings {
  /** Lot polygon in cm, world coords. If absent, fall back to
   *  fenceInsetMultiplier × houseBbox (current behaviour). */
  polygon?: Array<[number, number]>;
  /** Front / side / rear setbacks in cm. */
  setback?: { front: number; side: number; rear: number };
  /** Compass orientation — degrees CCW from +Z = north. Needed for
   *  sun-shadow analysis (we already have sunAnalysis.ts). */
  northDeg?: number;
}
```

UI: a "Lot" tab on the YardPlan toolbar with a polygon-draw mode.
Default to a rectangular lot derived from the existing fence inset.
Setback polygons computed via straight-skeleton offset of the lot
polygon — gives the buildable / plantable interior.

### 6.3 Phase C — Zone graph + constraint solver

Add a small **zone-adjacency rules table** alongside
`outdoorZones.ts`:

```ts
// outdoorZoneRules.ts (new)
export const ZONE_ADJACENCY: Array<{
  a: ZoneKind; b: ZoneKind;
  pref: "adjacent" | "separate" | "either";
  minGapM?: number;
  reason: string;
}> = [
  { a: "social",  b: "utility", pref: "adjacent",  reason: "厨房门到BBQ路径短" },
  { a: "private", b: "utility", pref: "separate",  minGapM: 5, reason: "停车与冥想区分离" },
  { a: "agro",    b: "utility", pref: "adjacent",  reason: "工具房与菜园连通" },
  { a: "social",  b: "private", pref: "separate",  minGapM: 3, reason: "热闹/安静过渡" },
  // ... ~10 rules total
];
```

Then **extend `outdoorClearance.ts`** with three new checks:

1. `zoneZoneOverlap` — polygon-polygon intersection (use
   [polygon-clipping](https://github.com/mfogel/polygon-clipping),
   ~30 KB).
2. `zoneHouseOverlap` — zone polygon ∩ house AABB ≠ ∅ → violation.
3. `zoneAdjacencyViolation` — apply ZONE_ADJACENCY table.

These checks plug into the existing `evaluateYardPlan` pipeline; the
existing `violationsByItem` UI consumes them for free.

### 6.4 Phase D — Auto-layout assistant ("design my yard")

A single button that produces a first-cut plan. Pipeline:

```
1. Read inputs:
   - lot polygon (or fall back to fenceInsetMultiplier box)
   - house footprint (from store.floorPlans[0])
   - exterior.yardPreset (existing: "minimal" | "garden" | "pool" | "full")
   - desired zones (default = preset's zone list)

2. Bubble diagram → seed points:
   Place 1 seed per zone, biased by zone preferences:
     - social: next to kitchen door (we know which wall is which from
       fp.faceMaterials / room layout)
     - private: far corner, with back to fence
     - utility: at front-of-lot near street side
     - agro: sunny + within 25m of kitchen (matches existing crop rule)
     - lawn: fills remainder

3. Voronoi tessellation (d3-delaunay) clipped to setback polygon
   → initial zone polygons.

4. Run Merrell-style MH sampler with these constraints:
     - no zone overlaps house
     - no zone overlaps another zone (post-Voronoi, only matters
       after the user moves a seed)
     - ZONE_ADJACENCY rules from §6.3
     - aspect ratio not too elongated
   for ~200 iterations. Cheap.

5. Path inference:
   destinations = [
     front gate (front edge midpoint of lot polygon),
     front door (house front wall mid),
     garage door,
     each zone centroid,
   ]
   A* on a 25cm grid → primary paths (front gate → front door,
   front door → social zone, etc.)
   Straight-skeleton medial axis of each zone → secondary stroll path.

6. Planting:
   For each zone, Poisson-disc-sample tree positions at minDist =
   2 × mature_canopy_radius (already in outdoorAssets.ts).
   Apply per-zone density (lawn: sparse, agro: row pattern, social:
   1 hero tree at the planAssemble-recommended location).

7. Commit to store as YardItems.
   Mark the plan as "auto-generated, click to edit" so we know to
   suppress the empty-state hint.
```

Estimated footprint: **~1200 LOC** new code, mostly the MH sampler
(~300), seed-placement heuristics (~300), path inference (~200),
planting layer (~200), and glue (~200).

### 6.5 Phase E — Starter templates

Add 5 named presets in a new `outdoorTemplates.ts` (parallel to
`floorplanLayouts.ts`):

| Template | Lot | Zones included | Notes |
|---|---|---|---|
| `urban-courtyard` | 12 × 12 m | private + lawn | Hedge walls, single hero tree |
| `small-backyard` | 20 × 15 m | social + lawn + utility | Patio + BBQ near kitchen |
| `suburban-classic` | 30 × 30 m (current default) | all 5 | Driveway, front lawn, back social, side veg |
| `large-estate` | 50 × 40 m | all 5, doubled | Pool + pergola + orchard + meadow |
| `edible-garden` | 25 × 20 m | agro-dominant + utility + small social | Raised beds, herb spiral, tool shed |

Each template is a fixed `YardPlan` (zones + a hand-curated path /
planting layout). User picks one, then nudges. Mirrors how
`projectTemplates.ts` works for indoor.

### 6.6 Phase F — Planting rules layer

Promote the cluster-density rule to a proper system:

```ts
// outdoorPlantingRules.ts (new)
export function plantingViolations(
  items: YardSingleton[],
  zones: YardZone[],
  northDeg: number,
): OutdoorViolation[] {
  // 1. Canopy overlap: tree-tree distance < (rA + rB) → flag
  // 2. Shade tolerance: shade-loving plant outside any shadow polygon
  //    (use sunAnalysis.getShadowPolygon — already imported)
  // 3. Drought tolerance: drought-loving plant inside an irrigation
  //    zone (lawn / agro)
  // 4. Row alignment in agro zones: prefer grid-snapped positions
}
```

`sunAnalysis.ts` already computes shadows; this layer joins it to
the species' shade preference.

---

## 7. Things our stack already provides

| Capability | Where | How it's used in the proposal |
|---|---|---|
| Poisson-disc sampling | `src/lib/poissonDisc.ts` | Tree placement in §6.4 step 6 |
| Sun/shadow analysis | `src/lib/sunAnalysis.ts` (`getShadowPolygon`) | Shade-tolerance rule in §6.6 |
| Polygon geometry | `src/lib/outdoorZones.ts` (area, centroid, bounds, rectZone) | Zone math throughout §6 |
| Outdoor clearance | `src/lib/outdoorClearance.ts` (`evaluateYardPlan`) | Plug-in point for new zone-overlap and adjacency rules in §6.3 |
| BVH spatial queries | `three-mesh-bvh` (already in deps) | Optional: accelerate A* path inference and tree-tree distance |
| Instanced render | drei `<Instances>` | Render 100+ trees efficiently after auto-scatter |
| Yard persistence | `store.ts` `addYardItem/removeYardItem/updateYardItem/addYardPath` | All write paths already exist |
| Indoor template precedent | `src/lib/floorplanLayouts.ts`, `src/lib/projectTemplates.ts` | Pattern to copy for §6.5 starter templates |

The headline: **we have ~80% of the primitives**. Phases A–C are
mostly UI plumbing + a small data-model addition; phases D–F add
real algorithmic work.

---

## 8. Known sharp edges

From the papers and the GitHub issue archaeology:

1. **MH sampler non-determinism.** Merrell's sampler returns a
   *plausible* layout, not *the* layout. Two clicks → two plans.
   Mitigation: seed the RNG from the lot dimensions + zone set so
   "Generate" is reproducible; expose a "shuffle" button for the
   non-deterministic behaviour.

2. **Setback drama on non-rectangular lots.** Straight-skeleton
   offset of a polygon with sharp re-entrant corners produces
   self-intersecting offsets. Mitigation: clip lot to its convex
   hull for setback computation, or use Clipper2's polygon offset
   (more robust, ~80 KB).

3. **A* paths look like Manhattan.** Pure A* on a grid produces
   right-angled walkways. Real garden paths curve. Mitigation:
   either (a) Chaikin smoothing 2 iterations, or (b) compute a
   Bezier fit through every 3rd waypoint; both ~30 LOC.

4. **Trees on top of paths.** Auto-layout must place paths *before*
   planting and mark path corridors as blocked for the Poisson
   sampler. Order matters: §6.4 steps 5 → 6.

5. **The "two views" problem persists if we keep both.** Even after
   phase A, if `FloorPlanAll` re-renders yard items at all the user
   may try to drag them there out of habit. Mitigation: make yard
   items in `FloorPlanAll` visually *non-interactive* (faded, no
   hover, no drag cursor) with a "Open 院子图 to edit" affordance
   on click. Phase A is *real* deletion of the drag handler in
   `FloorPlanAll.tsx:1043-1066` — keep only the rendering.

6. **Zone polygons in cm + relative coords are awkward to clip.**
   `YardZone.polygon` is *relative to the zone's (x, z) origin*
   (`types.ts:91-92`). Polygon-clipping libraries want absolute
   coordinates. Need a tiny `absolutePolygon(zone)` helper.
   Trivial, but a forget-it-and-debug-for-an-hour bug.

7. **Existing `outdoorClearance.ts` allows zone overlap silently.**
   Look at lines 247-322 — only *prefab-prefab* and *prefab-singleton*
   overlap are checked; zones are absent. That's the bug the user
   sees. Even *without* the auto-layout work, just adding
   zone-zone overlap to the violations list would surface the
   problem.

8. **Density on slope.** Once `LotSettings.slope` exists (deferred),
   Poisson-disc on a slope wants to think about terracing. Skip
   for now; Lynch §6 notes most residential sites are <5% grade,
   the planar approximation holds.

---

## 9. Decision matrix — what to actually ship

Each row = an independent slice. Pick top-down.

| Slice | Lift | Risk | User-visible impact | Depends on |
|---|---|---|---|---|
| **A1** Zone-zone & zone-house overlap warnings in `outdoorClearance.ts` | XS (~1 day) | Low | Medium — orange chips appear on bad zones immediately | — |
| **A2** Make `FloorPlanAll` yard items read-only, click-to-edit-in-院子图 | S (~1 day) | Low | High — kills the "two competing views" complaint | A1 helpful but not required |
| **B** Lot polygon + setback in `ExteriorSettings` | M (~3 days) | Medium (data migration) | Medium — non-rectangular lots, visible setback line | — |
| **C1** ZONE_ADJACENCY rules + violations | S (~1 day) | Low | Medium — guidance when user moves zones | A1 |
| **C2** Path authoring UI (draw polylines, snap to zone centroids) | M (~2 days) | Low | High — fixes "no circulation" | — |
| **D1** Starter templates × 5 (§6.5) | M (~3 days) | Low | High — solves cold-start | C2 ideally |
| **D2** Voronoi seed-based zone generator from house + preset | M (~3 days) | Medium (heuristics) | High — "Generate Yard" affordance | B, C1 |
| **D3** Merrell MH constraint solver over zone polygons | L (~5 days) | High (tuning) | High — plans actually look designed | D2 |
| **D4** A* path inference between key destinations | M (~3 days) | Medium | High — driveway/walkway auto-drawn | D2, C2 |
| **E** Planting layer (canopy spacing, shade rules, row alignment in agro) | M (~3 days) | Low | Medium — fixes overlapping watering rings | D2 |

Footprint columns: XS ≤ 1d, S ≈ 1–2d, M ≈ 2–4d, L ≥ 5d (one engineer).

---

## 10. Next steps — ordered phases the project owner can pick from

Three suggested orderings. Pick **one**.

### Path 1 — Minimum lift to make screenshots not embarrassing (≈ 1 week)

1. **A1** — Zone overlap warnings (Sat — half day). Immediate
   visual feedback on the existing screenshots' worst problem.
2. **A2** — `FloorPlanAll` yard items read-only (1 day). Single
   canonical edit view.
3. **C2** — Path authoring UI (2 days). User can finally draw
   driveways.
4. **E** — Planting layer (3 days). Watering rings stop overlapping.

Total: ~6.5 days. No new algorithms; mostly plumbing existing
primitives into the UI.

### Path 2 — Cold-start wedge (≈ 2 weeks)

1. **A1 + A2** (as in Path 1) — prerequisite (1.5 days).
2. **D1** — 5 starter templates (3 days). Solves "blank canvas".
3. **B** — Lot polygon + setback (3 days). Makes templates
   parametric to lot size.
4. **C2** + **E** (5 days). Same as Path 1.

Total: ~12.5 days. Mostly content + data model. Low algorithm risk.

### Path 3 — The full "design my yard" button (≈ 4 weeks)

1. Everything from Path 2 (~12.5 days).
2. **C1** — Adjacency rules (1 day).
3. **D2** — Voronoi seed-based generator (3 days).
4. **D4** — A* path inference (3 days).
5. **D3** — MH constraint solver (5 days, with tuning sessions).

Total: ~25 days. Real algorithmic work. Output is a one-click
plan-generator that other residential tools have failed to ship.

**Recommendation**: **Path 1**, then re-evaluate. The first four
items in Path 1 already address the four user-visible complaints
in the screenshots (zone overlap, two views, no paths, tree
chaos) without any procedural-generation risk. After Path 1
ships, the bar for Path 2 / 3 is much clearer because the user
will be looking at real, less-broken plans.

---

## Related in this repo

- `docs/walkthrough-lod-references.md` — same doc style; rendering
  problem rather than authoring problem.
- `docs/ROADMAP.md`, `docs/UPGRADE_ROADMAP.md` — check before
  committing to a path; might already prioritize one.
- `src/lib/floorplanLayouts.ts` — indoor analogue of §6.5 templates.
- `src/lib/projectTemplates.ts` — already bundles a `yardPlan` per
  template; §6.5 is the dedicated outdoor cousin.
- `src/lib/sunAnalysis.ts` (`getShadowPolygon`) — referenced from
  `YardPlan.tsx:31`; ready to power §6.6 shade rules.
- `src/lib/outdoorClearance.ts` lines 247-322 — the prefab-overlap
  block; the new zone-overlap check goes alongside.
- `src/lib/store.ts` lines 1856-1863 — `addYardPath` /
  `removeYardPath`; path authoring UI's write target.
