# Walkthrough LOD / Room-Recycling Rendering — References

Reference document for the proposed "active room high-detail, other rooms
simplified, far rooms culled" rendering strategy for HouseCanvas
walkthrough mode. Same problem class as architectural walkthrough
visualization (Teller 1991), level streaming in modern game engines, and
UITableView's cell reuse — applied to a multi-room building scene.

The intent of this doc: capture the prior art so future implementation
work doesn't reinvent the wheel, and so anyone wading into the code can
go straight to the relevant paper / library / issue.

---

## TL;DR — The pattern in three sentences

> Split the scene into **cells** (rooms). Render the cell the camera is
> currently in at full quality, render cells reachable through visible
> **portals** (doors / windows) as simplified, cull everything else.
> When the camera transitions cells, dispose the old full-quality
> assets and load the new one — drei's `useGLTF` cache keeps the
> expensive asset data around so subsequent re-entries are cheap.

**Classical name**: Cell-and-Portal rendering. Standard since 1991.

**Modern equivalents**: Unreal World Partition, Unity Addressables,
Babylon octree freeze, drei `<Detailed>` + `useGLTF.preload`.

**iOS analogy**: UICollectionView `prefetchItemsAt:` (mount-ahead) +
dequeueReusableCell (mount/unmount as visible region shifts).

---

## 1. Foundational papers (read these first)

### Teller & Séquin (1991) — *Visibility Preprocessing for Interactive Walkthroughs*

SIGGRAPH '91. The cell-and-portal paper. Defines:

- **cell** — a convex region of space (= a room in our case)
- **portal** — a polygon shared by two cells through which sight lines
  can pass (= a door or window opening)
- **PVS** (Potentially Visible Set) — the cells reachable through
  visible portals from the current cell

Once you have a cell-adjacency graph + portal polygons, per-frame
visibility is `O(visible cells)` instead of `O(all cells in scene)`.

[PDF on Teller's homepage](https://groups.csail.mit.edu/graphics/classes/6.838/F01/lectures/PVS/teller-thesis.pdf)
(longer thesis version — chapters 4-6 cover the algorithm we'd reuse).

Our project's existing data structures already cover most of this:

| Teller term | Where in the code |
|---|---|
| Cell | `wallAABBs` in `HouseCanvas.tsx` |
| Portal | `doorPasses` (added in `c544237`), windows (`fp.roomWindows[r]`) |
| Cell adjacency | Implicit in `doorPasses` overlap with cell edges |

### Airey (1990) — *Increasing Update Rates in the Building Walkthrough System...*

UNC PhD thesis. Earliest published version of building-walkthrough
visibility. Less polished than Teller but historically important.

### Funkhouser (1996) — *Database Management for Interactive Display of Large Architectural Models*

This is the one closest to what the user described. Adds:

- **Working set management** — only a bounded number of cells fully
  loaded at once. LRU eviction on transitions. This is the "Apple
  TableView cell reuse" analogy made rigorous.
- **Predictive prefetch** — start loading the next cell when the user
  approaches a portal, before they cross it. Avoids the load-stutter
  on first entry.

Funkhouser's working-set policy is what we'd implement as `LRU = 2`
(active room + most-recently-visited room kept mounted).

---

## 2. Game engine equivalents

What the AAA / commercial engines call this same idea:

| Engine | Term | Mechanism |
|---|---|---|
| **Quake 3** | PVS in BSP | Precomputed bitfield: for each leaf, which other leaves are visible. `O(1)` lookup at runtime. |
| **Unreal** | World Partition + Level Streaming | Cells stream in/out on a 2D grid. Bound by `RuntimeGrid` size. |
| **Unity** | Scene Streaming, Addressables | `Addressables.LoadAssetAsync` with reference counting; engine releases when refcount hits 0. |
| **Godot** | `VisibleOnScreenNotifier3D` | Per-object on-screen detection; cheap but lacks cell concept. |
| **Babylon.js** | Octree + `freezeActiveMeshes` | Compute octree once, freeze static-region mesh lists, only re-walk on camera moves > threshold. |

External docs:

- [Unreal World Partition](https://docs.unrealengine.com/5.0/en-US/world-partition-in-unreal-engine/) — the modern level-streaming docs
- [Unity Addressables](https://docs.unity3d.com/Packages/com.unity.addressables@1.21/manual/index.html) — reference-counted asset loader
- [Babylon Octree culling](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimizeOctrees) — concise practical guide
- [Quake 3 BSP format](http://www.mralligator.com/q3/) — for a tangible look at how PVS is stored

---

## 3. Three.js / R3F ecosystem

What we'd actually wire into in this codebase.

### Spatial indexing

- **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)** —
  *already in this project* (`HouseCanvas.tsx:14-18` injects
  `acceleratedRaycast` + `computeBoundsTree`). Can also build a BVH
  over the room AABBs and do `O(log n)` "which cell is the camera in"
  lookup.

### Built-in LOD

- **[`THREE.LOD`](https://github.com/mrdoob/three.js/blob/master/src/objects/LOD.js)** —
  distance-based mesh swap. Has built-in hysteresis (`THRESHOLD`
  attribute). Source is ~70 lines and is the cleanest reference for
  doing the same with React components.

- **[drei `<Detailed>`](https://github.com/pmndrs/drei?tab=readme-ov-file#detailed)** —
  R3F wrapper around `THREE.LOD`. Children are alternate detail
  levels; drei picks the right one based on camera distance.

### Asset preloading / caching

- **[`useGLTF.preload(url)`](https://github.com/pmndrs/drei?tab=readme-ov-file#usegltf-suspense)** —
  *already used in this project* (`HouseCanvas.tsx` FurniturePreloader
  warms indoor furniture GLTFs on idle). Same hook is what would
  warm RoomWindow / RoomDoor GLTFs ahead of first room entry.

- **[`Suspense` for staged loading](https://github.com/pmndrs/react-three-fiber/blob/master/docs/api/objects.mdx#suspense)** —
  R3F idiomatic way to defer mount until assets resolve.

### Open issues / discussions worth reading

- **[three.js #5102 — Portal occlusion culling](https://github.com/mrdoob/three.js/issues/5102)** —
  long-running community discussion of portal culling in Three. No
  official feature, but useful for understanding why (Three's core
  team has resisted adding it — too scene-shape-specific).

- **[drei #1543 — `<Bvh>` for spatial queries](https://github.com/pmndrs/drei/issues/1543)** —
  ergonomic wrapper around `three-mesh-bvh` for non-raycast queries
  (containment, nearest neighbor).

- **[r3f #1869 — Suspense triggers visible mount stutter](https://github.com/pmndrs/react-three-fiber/issues/1869)** —
  the "door-crossing flash" we'd hit if we mount/unmount RoomShell at
  the door threshold without hysteresis. Workarounds discussed.

---

## 4. Standalone reference implementations

Existing projects we can directly read for inspiration:

- **[Eteq/threejs-portal-renderer](https://github.com/Eteq/threejs-portal-renderer)** —
  ~300 LOC portal culling demo. Older Three.js but still legible.

- **[StackBlitz r3f portal demo](https://codesandbox.io/p/sandbox/portal-rooms-h6q5z)** —
  R3F-flavored take on the same concept.

- **[lume](https://github.com/lume/lume)** — DOM-friendly Three.js
  framework; their distance-culling implementation is small and clear.

---

## 5. iOS analogy — for completeness

The user's mental model was UITableView cell reuse. The literal Apple
references:

- [Apple WWDC 2016 — UICollectionView prefetching](https://developer.apple.com/videos/play/wwdc2016/219/) —
  introduces `prefetchItemsAt:`, the "mount ahead" half. Exactly maps
  to "start loading next room as camera approaches doorway".

- [UITableView dataSource recycling](https://developer.apple.com/documentation/uikit/views_and_controls/table_views/filling_a_table_with_data) —
  the "release as soon as off-screen" half.

Caveat: tableview cells are *reused as containers with new data*. In
our case each room has different geometry, so the "container" can't
be reused — we mount/unmount whole component trees instead. drei's
`useGLTF` global cache provides the "data side" of the reuse pattern
(the heavy asset bytes don't get re-fetched / re-parsed).

---

## 6. Concrete mapping to this codebase

Once the abstract pattern is matched to our data:

```
Teller's cell adjacency graph    ↔  wallAABBs + doorPasses
PVS query                        ↔  for each cell, is doorPass in view frustum?
Visible set                      ↔  active room ∪ portal-reachable rooms
Working set / LRU                ↔  React state: [activeId, prevId]
Predictive prefetch              ↔  extend FurniturePreloader with RoomWindow/RoomDoor URLs
Hysteresis                       ↔  N-frame stability check before swapping activeId
Asset cache                      ↔  drei useGLTF (already global)
```

The implementation skeleton:

```tsx
// 1. Active-cell detection (every render frame, throttled)
const activeId = useActiveRoomCell(camera, wallAABBs);  // returns RoomType

// 2. LRU=2 working set
const [working, setWorking] = useState<RoomType[]>([]);
useEffect(() => {
  setWorking(prev => prev[0] === activeId ? prev : [activeId, ...prev].slice(0, 2));
}, [activeId]);

// 3. Render dispatch
return (
  <>
    {/* Simplified pass: ALL non-working rooms (current HouseCanvas
        interior path, but skip working ones to avoid double-draw) */}
    {interiorRooms
      .filter(r => !working.includes(r.room))
      .map(r => <SimplifiedRoom key={r.room} {...r} />)}

    {/* High-detail pass: working set rooms */}
    {working.map(roomId => (
      <Suspense key={roomId} fallback={<SimplifiedRoom roomId={roomId} />}>
        <EmbeddableRoomShell roomId={roomId} />
      </Suspense>
    ))}
  </>
);
```

Estimated effort: 1-1.5 days for a working LRU=2 implementation
(`docs/walkthrough-lod-references.md` reading time not included).

---

## 7. Known sharp edges

Things that bite when you implement this — from both the papers and
the GitHub issues:

1. **Door-threshold thrash.** If cell detection uses pure
   `point-in-AABB`, the camera straddling a doorway flips the active
   cell every other frame. Mitigation: hysteresis — require N
   consecutive frames in the new cell before committing. Three.js LOD
   does this with a per-level distance threshold.

2. **Light bleed across cells.** A full-detail room's pointLight
   reaches through the (simplified) wall into the next room. The
   next room has no proper shadow casters so the light just paints
   it brightly. Mitigation: clamp `light.distance` to the cell's
   diagonal, or add `light.shadow.matrix` restrictions.

3. **Mount-flash on first entry.** Even with assets cached, the
   reconciler still has to mount dozens of meshes the first time a
   cell becomes active. ~1 frame stutter visible. Mitigation:
   predictive prefetch (Funkhouser) — start mounting the next room
   when the camera is within 0.5 m of a doorway.

4. **Seam between cells.** Where the high-detail room's wall meets
   the simplified neighbor's wall, the textures / shading don't
   match. Mitigation: render the seam wall using the high-detail
   room's material (the simplified side just stops at the doorway).

5. **PVS over-conservative on small spaces.** If two rooms share a
   long wall with one door, you might mount both even when the user
   is squarely in one. That's fine for LRU=2; only matters when LRU
   grows to 3+ or memory becomes tight.

---

## 8. Reading order if implementing

1. **Teller 1991 SIGGRAPH paper** — sections 3-4 (cells + portals).
2. **Quake 3 BSP / PVS docs** — concrete data structures.
3. **`three-mesh-bvh` README** — already in our deps, useful for the
   active-cell lookup.
4. **drei `<Detailed>` source** — ~60 LOC, shows how to do LOD
   ergonomically in R3F.
5. **Eteq/threejs-portal-renderer source** — a runnable
   implementation we can crib from.

Total: ~3-4 hours of reading before writing any code.

---

## Related in this repo

- `docs/perf-optimization-references.md` — the earlier round's
  references (mesh instancing, frustum culling, shader compile).
  Some overlap (BVH, drei `<Detailed>`).
- `src/components/HouseCanvas.tsx:14-18` — three-mesh-bvh injection,
  ready for spatial queries beyond raycast.
- `src/components/HouseCanvas.tsx` `FurniturePreloader` — pattern to
  copy for predictive prefetch of RoomWindow/RoomDoor GLTFs.
- `src/components/FirstPersonControls.tsx` — what an embedded
  RoomCanvas-style walkthrough looks like at component level; useful
  reference when extracting `<EmbeddableRoomShell>`.
