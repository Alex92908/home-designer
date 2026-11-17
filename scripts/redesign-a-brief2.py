"""Group A redesign — brief density top-up (secondary rooms <10 items).
Run from the worktree root. All ids verified in the catalog; all placements
checked against neighbours. Brings every secondary room to >=10 items
(brief rule 5) except none remaining.
- apartment kitchen 9 -> 11: plant-potted-pack (30,250), storage-shelving
  west wall (30,120, rot 90).
- apartment bedroom 7 -> 10: plant-sansevieria (30,280), decor-books-pile
  on the desk (220,40, elev 44), rug-boho under the bed (140,150).
- apartment bathroom 5 -> 10: plant-sansevieria (200,280), decor-tissue-box
  + decor-vase-single on the vanity (140/80,30, elev 85), rug-boho (110,150),
  lamp-wall-sconce (110,10, elev 150).
- shikumen hallway (front courtyard) 9 -> 11: plant-sansevieria (570,130),
  proc-rock (380,130).
- shikumen custom1 (back courtyard) 6 -> 10: proc-rock (100,150),
  decor-trash-bin (580,150), chicken (350,60), plant-sansevieria (150,180).
"""
import re

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

# ---- APARTMENT (scope to APARTMENT_SET) ---------------------------------------
i, j = section(src, "const APARTMENT_SET", "const RURAL_HALL_SET")
seg = src[i:j]
# kitchen: shelving + plant (anchor: fridge line)
seg = replace_once(seg,
    '{ furnitureId: "fridge-single-white",    x: 340, z: 250, rotation: 0 },',
    '{ furnitureId: "fridge-single-white",    x: 340, z: 250, rotation: 0 },\n'
    '        { furnitureId: "storage-shelving",    x: 30,  z: 120, rotation: 90 },\n'
    '        { furnitureId: "plant-potted-pack",   x: 30,  z: 250, rotation: 0 },',
    "apt kitchen")
# bedroom: plant + desk books + rug (anchor: bookshelf line)
seg = replace_once(seg,
    '{ furnitureId: "bookshelf-with-books", x: 30, z: 80,  rotation: 90 },',
    '{ furnitureId: "bookshelf-with-books", x: 30, z: 80,  rotation: 90 },\n'
    '        { furnitureId: "plant-sansevieria",   x: 30,  z: 280, rotation: 0 },\n'
    '        { furnitureId: "decor-books-pile",    x: 220, z: 40,  rotation: 0, elevationY: 44 },\n'
    '        { furnitureId: "rug-boho",            x: 140, z: 150, rotation: 0 },',
    "apt bedroom")
# bathroom: plant + vanity smalls + rug + sconce (anchor: towel-rack line)
seg = replace_once(seg,
    '{ furnitureId: "bath_accessory-towel-rack", x: 10, z: 150, rotation: 90 },',
    '{ furnitureId: "bath_accessory-towel-rack", x: 10, z: 150, rotation: 90 },\n'
    '        { furnitureId: "plant-sansevieria",   x: 200, z: 280, rotation: 0 },\n'
    '        { furnitureId: "decor-tissue-box",    x: 140, z: 30,  rotation: 0, elevationY: 85 },\n'
    '        { furnitureId: "decor-vase-single",   x: 80,  z: 30,  rotation: 0, elevationY: 85 },\n'
    '        { furnitureId: "rug-boho",            x: 110, z: 150, rotation: 0 },\n'
    '        { furnitureId: "lamp-wall-sconce",    x: 110, z: 10,  rotation: 0, elevationY: 150 },',
    "apt bathroom")
src = src[:i] + seg + src[j:]

# ---- SHIKUMEN courtyards (scope to SHIKUMEN_SET) -------------------------------
i, j = section(src, "const SHIKUMEN_SET", "const ")
seg = src[i:j]
# front courtyard (hallway): plant + rock (anchor: trash-bin line)
seg = replace_once(seg,
    '{ furnitureId: "decor-trash-bin",     x: 30,  z: 130, rotation: 0 },',
    '{ furnitureId: "decor-trash-bin",     x: 30,  z: 130, rotation: 0 },\n'
    '        { furnitureId: "plant-sansevieria", x: 570, z: 130, rotation: 0 },\n'
    '        { furnitureId: "proc-rock",         x: 380, z: 130, rotation: 0 },',
    "shikumen hallway")
# back courtyard (custom1): rock + bin + chicken + plant (anchor: laundry line)
seg = replace_once(seg,
    '{ furnitureId: "decor-laundry-basket", x: 300, z: 150, rotation: 0 },',
    '{ furnitureId: "decor-laundry-basket", x: 300, z: 150, rotation: 0 },\n'
    '        { furnitureId: "proc-rock",         x: 100, z: 150, rotation: 0 },\n'
    '        { furnitureId: "decor-trash-bin",   x: 580, z: 150, rotation: 0 },\n'
    '        { furnitureId: "chicken",           x: 350, z: 60,  rotation: 0 },\n'
    '        { furnitureId: "plant-sansevieria", x: 150, z: 180, rotation: 0 },',
    "shikumen custom1")
src = src[:i] + seg + src[j:]

open(P, "w").write(src)
print("projectTemplates.ts updated (brief density top-up)")
