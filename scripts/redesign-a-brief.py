"""Group A redesign — reference-brief pass. Run from the worktree root.
Implements the brief items that (a) exist as verified catalog ids and
(b) do not conflict with design-a.md era locks (design-a.md wins on ids/locks).
See the final report for the brief items that could NOT be implemented
(mostly: ids that do not exist in the catalog — remote, photo frame,
calendar, rattan chair, candle, grinder, neon sign, pillar, crane lamp,
zheng, bamboo blind, bonsai, chopstick holder, beer bottle, plastic
stool, condiment station, ceiling fan, ancestor portrait, cured meat,
chili strings, sticky notes, wall clock, blinds, four-treasures pieces
(inkstone/paperweight/brush-stand/ink-stick), cup rack, record shelf,
wood bench, water jar, beer crate, shikumen gate, carved lattice windows,
caisson ceiling, steam).

Edits (all placements checked against neighbours):
 A. apartment living: +2 decor-pillows on the sofa (3 cushions total).
 B. apartment master: +wardrobe-clothes-rack (430,280) — 500x320 room.
 C. ming living: +2 proc-shoji entrance screens (200/700,520); +2
    proc-lantern-pole flanking the north wall (120/780,90); +2 couplets
    as wallDecor on the N wall flanking the central mural (stand-in for
    zhongtang couplets — see design-a.md gap note).
 D. qing study: +proc-wood-stool (140,290) beside the grand-master chair.
 E. rural living: +proc-basin (60,450) as the water vat.
 F. cafe bar: +decor-coffee-cups (560,150, elev 110) — cup set on the bar.
 G. restaurant living: +2 proc-lantern-pole flanking the entrance/waiting
    area (900/1400,950); +1 storage-crate (2050,980) as beer-crate stock.
 H. office living: +4 elec-keyboard on the 4 dual-monitor desks
    (top-left coords, elev 65, rotation matches the monitor).
NOT done deliberately:
 - dining coffee machine on sideboard-euro: sideboard-euro is 190cm tall
   (a tall cabinet, no counter top) — no suitable surface in dining.
 - tang hu beds: design-a.md chose floor cushions for Tang seating;
   proc-huchuang (45x40) would duplicate the music-area cushions.
 - song study: nothing — brief says few-but-fine, do not overfill; the
   study is already the densest ancient room.
 - rural long benches: proc-outdoor-bench is 180cm long; no 180cm clear
   run around the round table without overlapping tatami/TV unit/stools.
 - ming blue-white vases: CONFLICT — brief says blue-white pairs,
   design-a.md era lock forbids blue-white in Ming (celadon instead).
   design-a.md wins; celadon pairs already in place.
"""
import json

P = "src/lib/projectTemplates.ts"
src = open(P).read()

def section(src, marker, end_marker):
    i = src.index(marker)
    j = src.index(end_marker, i + len(marker))
    return i, j

def replace_once(src, old, new, label):
    n = src.count(old)
    assert n == 1, f"{label}: expected 1 occurrence, found {n}: {old!r}"
    return src.replace(old, new)

# ---- A+B. APARTMENT ------------------------------------------------------------
i, j = section(src, "const APARTMENT_SET", "const RURAL_HALL_SET")
seg = src[i:j]
# A: two more cushions on the sofa (existing one at 310,290)
seg = replace_once(seg,
    '{ furnitureId: "decor-pillows",       x: 310, z: 290, rotation: 0, elevationY: 45 },',
    '{ furnitureId: "decor-pillows",       x: 310, z: 290, rotation: 0, elevationY: 45 },\n'
    '        { furnitureId: "decor-pillows",       x: 270, z: 290, rotation: 0, elevationY: 45 },\n'
    '        { furnitureId: "decor-pillows",       x: 350, z: 290, rotation: 0, elevationY: 45 },',
    "apartment cushions")
# B: clothes rack in the master bedroom (500x320 room, SE corner free)
seg = replace_once(seg,
    '{ furnitureId: "plant-sansevieria",   x: 40,  z: 280, rotation: 0 },\n      ],\n      bedroom: [',
    '{ furnitureId: "plant-sansevieria",   x: 40,  z: 280, rotation: 0 },\n'
    '        { furnitureId: "wardrobe-clothes-rack", x: 430, z: 280, rotation: 0 },\n'
    '      ],\n      bedroom: [',
    "apartment rack")
src = src[:i] + seg + src[j:]

# ---- C. MING living: screens + lantern poles + couplets -----------------------
i, j = section(src, "const MING_HALL_SET", "const QING_SANXITANG_SET")
seg = src[i:j]
anchor = '{ furnitureId: "proc-bamboo-clump", x: 720, z: 470, rotation: 0 },'
assert seg.count(anchor) == 1, "ming bamboo anchor"
seg = seg.replace(anchor, anchor +
    '\n        // ── Reference brief: 入口屏风 / 宫灯 ──\n'
    '        { furnitureId: "proc-shoji",        x: 200, z: 520, rotation: 0 },\n'
    '        { furnitureId: "proc-shoji",        x: 700, z: 520, rotation: 0 },\n'
    '        { furnitureId: "proc-lantern-pole", x: 120, z: 90,  rotation: 0 },\n'
    '        { furnitureId: "proc-lantern-pole", x: 780, z: 90,  rotation: 0 },')
# couplets on the N wall, flanking the central mural (wallDecor)
old_lanterns = ('            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.3, v: 0.7 },\n'
                '            { furnitureId: "wall-lamp-lantern", wall: "S", u: 0.7, v: 0.7 },')
assert seg.count(old_lanterns) == 1, "ming wallDecor lanterns"
seg = seg.replace(old_lanterns,
    '            { furnitureId: "couplet-spring", wall: "N", u: 0.32, v: 0.55, scaleH: 1.1 },\n'
    '            { furnitureId: "couplet-prosperity", wall: "N", u: 0.68, v: 0.55, scaleH: 1.1 },\n' + old_lanterns)
src = src[:i] + seg + src[j:]

# ---- D. QING study: side stool by the grand-master chair ----------------------
i, j = section(src, "const QING_SANXITANG_SET", "const TANG_PALACE_SET")
seg = src[i:j]
anchor = '{ furnitureId: "sofa-armchair",         x: 210, z: 290, rotation: 180 },'
assert seg.count(anchor) == 1, "qing chair anchor"
seg = seg.replace(anchor, anchor +
    '\n        { furnitureId: "proc-wood-stool",       x: 140, z: 290, rotation: 0 },')
src = src[:i] + seg + src[j:]

# ---- E. RURAL living: water vat ----------------------------------------------
i, j = section(src, "const RURAL_HALL_SET", "const MING_HALL_SET")
seg = src[i:j]
anchor = '{ furnitureId: "decor-utensils",    x: 6,   z: 280, rotation: 0 },'
assert seg.count(anchor) == 1, "rural utensils anchor"
seg = seg.replace(anchor, anchor +
    '\n        { furnitureId: "proc-basin",        x: 60,  z: 450, rotation: 0 },')
src = src[:i] + seg + src[j:]

open(P, "w").write(src)
print("projectTemplates.ts updated (brief pass)")

# ---- F. CAFE bar: cup set -------------------------------------------------------
CP = "src/data/templates/set-cafe.json"
d = json.load(open(CP))
living = d[0]["living"]
living.append({"furnitureId": "decor-coffee-cups", "x": 560, "z": 150, "elevationY": 110})
json.dump(d, open(CP, "w"), ensure_ascii=False, indent=2)
print("set-cafe.json: living now", len(living))

# ---- G. RESTAURANT: entrance lanterns + beer-crate stock -----------------------
RP = "src/data/templates/set-restaurant.json"
d = json.load(open(RP))
living = d[0]["living"]
for x in (900, 1400):
    living.append({"furnitureId": "proc-lantern-pole", "x": x, "z": 950})
living.append({"furnitureId": "storage-crate", "x": 2050, "z": 980})
json.dump(d, open(RP, "w"), ensure_ascii=False, indent=2)
print("set-restaurant.json: living now", len(living))

# ---- H. OFFICE: keyboards on the 4 dual-monitor desks --------------------------
OP = "src/data/templates/office-snapshot.json"
d = json.load(open(OP))
living = d["floorPlans"][0]["rooms"]["living"]["placedItems"]
assert not any(i["furnitureId"] == "elec-keyboard" for i in living)
for x, z, rot in [(171.5, 217.5, 270), (243.5, 217.5, 90),
                  (171.5, 377.5, 270), (243.5, 377.5, 90)]:
    living.append({"furnitureId": "elec-keyboard", "x": x, "z": z,
                   "rotation": rot, "scaleW": 1, "scaleD": 1, "scaleH": 1,
                   "elevationY": 65})
json.dump(d, open(OP, "w"), ensure_ascii=False, indent=2)
print("office-snapshot.json: living now", len(living))
