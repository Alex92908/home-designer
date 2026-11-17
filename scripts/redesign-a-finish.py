"""Group A redesign — finish pass (resume). Run from the worktree root.
Fixes / completions left by the interrupted builder:
 1. MING master: coffee-oak-round (light Nordic oak, era-lock B4) ->
    coffee_table-victorian; tea-set elevation 30 -> 50 (victorian height).
 2. QING study: curtain-victorian -> curtain-brown-sheer (design note §4:
    sheer or drape curtain for the east wooden window; Victorian is wrong era).
 3. MING hallway: proc-ground-stone corridor paving (note §2).
 4. TANG hallway: proc-ground-stone corridor paving (note §7).
 5. RURAL yard: proc-ground-dry full-yard cover (note §10).
 6. OFFICE living: rug-modern-gray under the waiting-area sofa + coffee
    table (note §3: rest corner rug; sofa 310x200, rug scaled 1.6x1.2).
Deliberately NOT done (see report): qing kang-front tatami (20cm gap +
rug-persian already covers the desk zone), cafe marble-table swap (55cm
table vs 90cm rustic + chairs at +/-66cm), cafe wall-shelf (no placement
precedent), song courtyard pond/bridge/pergola (no clear patch in the
packed 1000x280 strip; bridge is 800cm long), office elevator (200x180
does not fit the 1100x140 corridor).
"""
import json

P = "src/lib/projectTemplates.ts"
src = open(P).read()

def section(src, marker, end_marker="const "):
    i = src.index(marker)
    j = src.index(end_marker, i + len(marker))
    return i, j

def replace_once(src, old, new, label):
    n = src.count(old)
    assert n == 1, f"{label}: expected 1 occurrence, found {n}: {old!r}"
    return src.replace(old, new)

# ---- 1. MING master coffee table (scope to MING_HALL_SET) -------------------
i, j = section(src, "const MING_HALL_SET", "const QING_SANXITANG_SET")
seg = src[i:j]
seg = replace_once(seg,
    '{ furnitureId: "coffee-oak-round",   x: 250, z: 470, rotation: 0 },',
    '{ furnitureId: "coffee_table-victorian", x: 250, z: 470, rotation: 0 },',
    "ming master coffee table")
seg = replace_once(seg,
    '{ furnitureId: "decor-tea-set",      x: 250, z: 470, rotation: 0, elevationY: 30 },',
    '{ furnitureId: "decor-tea-set",      x: 250, z: 470, rotation: 0, elevationY: 50 },',
    "ming master tea-set height")
src = src[:i] + seg + src[j:]

# ---- 2. QING study curtain (scope to QING_SANXITANG_SET) --------------------
i, j = section(src, "const QING_SANXITANG_SET", "const TANG_PALACE_SET")
seg = src[i:j]
seg = replace_once(seg,
    '{ furnitureId: "curtain-victorian", x: 408, z: 140, rotation: 90 },',
    '{ furnitureId: "curtain-brown-sheer", x: 408, z: 140, rotation: 90 },',
    "qing study curtain")
src = src[:i] + seg + src[j:]

# ---- 3. MING hallway ground-stone -------------------------------------------
i, j = section(src, "const MING_HALL_SET", "const QING_SANXITANG_SET")
seg = src[i:j]
anchor = '{ furnitureId: "proc-rockery",      x: 1300, z: 200, rotation: 0 },'
assert seg.count(anchor) == 1
seg = seg.replace(anchor, anchor +
    '\n        { furnitureId: "proc-ground-stone", x: 700,  z: 120, rotation: 0, scaleW: 1.4, scaleD: 0.24 },')
src = src[:i] + seg + src[j:]

# ---- 4. TANG hallway ground-stone -------------------------------------------
i, j = section(src, "const TANG_PALACE_SET", "const SONG_STUDY_SET")
seg = src[i:j]
anchor = '{ furnitureId: "proc-rockery",      x: 1300, z: 220, rotation: 0 },'
assert seg.count(anchor) == 1, "tang rockery anchor"
seg = seg.replace(anchor, anchor +
    '\n        { furnitureId: "proc-ground-stone", x: 700,  z: 150, rotation: 0, scaleW: 1.4, scaleD: 0.3 },')
src = src[:i] + seg + src[j:]

# ---- 5. RURAL yard ground-dry -----------------------------------------------
i, j = section(src, "const RURAL_HALL_SET", "const MING_HALL_SET")
seg = src[i:j]
anchor = '{ furnitureId: "vehicle.vino",           x: 300, z: 170, rotation: 90 },'
assert seg.count(anchor) == 1, "rural vino anchor"
seg = seg.replace(anchor,
    '{ furnitureId: "proc-ground-dry",   x: 600, z: 170, rotation: 0, scaleW: 1.2, scaleD: 0.34 },\n        ' + anchor)
src = src[:i] + seg + src[j:]

open(P, "w").write(src)
print("projectTemplates.ts updated")

# ---- 6. OFFICE waiting-area rug ---------------------------------------------
OP = "src/data/templates/office-snapshot.json"
d = json.load(open(OP))
living = d["floorPlans"][0]["rooms"]["living"]["placedItems"]
assert not any(it["furnitureId"] == "rug-modern-gray" for it in living), \
    "office rug already present"
living.append({"furnitureId": "rug-modern-gray", "x": 540, "z": 470,
               "rotation": 0, "scaleW": 1.6, "scaleD": 1.2, "scaleH": 1})
json.dump(d, open(OP, "w"), ensure_ascii=False, indent=2)
print("office-snapshot.json: waiting rug added; living now", len(living))
