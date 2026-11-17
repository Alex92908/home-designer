"""Group A redesign: office-snapshot.json edits (top-left coords, snapshot-native).
Run from the worktree root. Prints an overlap report for every added item."""
import json

P = "src/data/templates/office-snapshot.json"
d = json.load(open(P))
fp = d["floorPlans"][0]
rooms = fp["rooms"]
dims = json.load(open("/tmp/dims.json"))
# dims values are [w, d]; snapshot items are top-left coords.
# NOTE: /tmp/dims.json was built from furniture.ts; proc items included.

def wdim(fid):
    return dims.get(fid, [50, 50])

def center_of(it):
    w, dd = wdim(it["furnitureId"])
    sw, sd = it.get("scaleW", 1), it.get("scaleD", 1)
    return (it["x"] + w * sw / 2, it["z"] + dd * sd / 2)

def add(room, fid, cx, cz, **kw):
    """Add by CENTER coords (converted to snapshot top-left)."""
    w, dd = wdim(fid)
    it = {"furnitureId": fid, "x": round(cx - w / 2, 2), "z": round(cz - dd / 2, 2),
          "rotation": 0, "scaleW": 1, "scaleD": 1, "scaleH": 1}
    it.update(kw)
    if it["rotation"] == 0:
        del it["rotation"]
    rooms[room].setdefault("placedItems", []).append(it)
    return it

def remove(room, fid):
    items = rooms[room]["placedItems"]
    rooms[room]["placedItems"] = [i for i in items if i["furnitureId"] != fid]

def find(room, fid):
    return [i for i in rooms[room]["placedItems"] if i["furnitureId"] == fid]

# ---------- living: reception + waiting area (empty middle band) ----------
add("living", "proc-reception-desk", 1100, 420)
add("living", "plant-monstera", 920, 420)
add("living", "plant-monstera", 1280, 420)
add("living", "proc-whiteboard", 1600, 30)
add("living", "sofa-modular-green", 700, 500)
add("living", "coffee-marble-rect", 700, 620)
add("living", "decor-books-pile", 680, 620, elevationY=45)
add("living", "decor-coffee-mug", 720, 620, elevationY=45)
add("living", "plant-rubber-tree", 900, 500)
add("living", "lamp-arc-gold", 850, 650)

# ---------- living: desk personalization (B/C groups) -----------------------
desks = find("living", "desk-standing")
desks.sort(key=lambda it: (round(it["z"]), round(it["x"])))
# first 4 desks (west rows): dual monitors
for it in desks[:4]:
    cx, cz = center_of(it)
    add("living", "elec-monitor", cx, cz, elevationY=65,
        rotation=it.get("rotation", 0) or 0)
# next 3: desk lamps
for it in desks[4:7]:
    cx, cz = center_of(it)
    add("living", "lamp-desk-arm", cx - 40, cz, elevationY=65)
# next 2: tissue boxes; next 1: globe; next 1: teddy (geek desk)
for it in desks[7:9]:
    cx, cz = center_of(it)
    add("living", "decor-tissue-box", cx + 30, cz - 10, elevationY=65)
if len(desks) > 9:
    cx, cz = center_of(desks[9])
    add("living", "decor-globe", cx + 30, cz - 10, elevationY=65)
if len(desks) > 10:
    cx, cz = center_of(desks[10])
    add("living", "toy-teddy", cx + 30, cz - 10, elevationY=65)

# ---------- dining (main meeting room): real meeting table -------------------
tbl = find("dining", "table-conference")[0]
tbl["furnitureId"] = "proc-meeting-table"
tbl["x"] = 20   # 360-wide table, keep centered (was 80)
tbl["z"] = 60   # (was 70)
add("dining", "chair-ergonomic", 377, 120, rotation=270)  # 10th chair, east end
add("dining", "proc-whiteboard", 200, 10)
add("dining", "decor-tissue-box", 200, 115, elevationY=80)
add("dining", "decor-coffee-mug", 120, 130, elevationY=80)
add("dining", "decor-coffee-mug", 280, 110, elevationY=80)

# ---------- custom2 -> CEO office ---------------------------------------------
remove("custom2", "table-conference")
remove("custom2", "chair-modern-gray")
remove("custom2", "elec-tv-flat")
add("custom2", "proc-ceo-desk", 185, 90)
add("custom2", "chair-ergonomic", 185, 175, rotation=180)
add("custom2", "sofa-leather-brown", 185, 260, rotation=180)
add("custom2", "coffee-marble-rect", 185, 205)
add("custom2", "decor-books-vintage", 170, 205, elevationY=45)
add("custom2", "decor-globe", 120, 85, elevationY=78)
add("custom2", "lamp-desk-arm", 250, 85, elevationY=78)
add("custom2", "plant-rubber-tree", 330, 260)
add("custom2", "mural-inkwash", 185, 12)
add("custom2", "bookshelf-with-books", 340, 90, rotation=270)
add("custom2", "decor-books-set", 340, 90, elevationY=200)

# ---------- kitchen: pantry counter (move the small table north) --------------
tbl = find("kitchen", "dining_table-cafe-small")[0]
tbl["x"], tbl["z"] = 100, 80
add("kitchen", "proc-pantry-counter", 125, 230)
add("kitchen", "decor-coffee-cups", 60, 230, elevationY=125)
add("kitchen", "decor-tulip", 120, 230, elevationY=125)

# ---------- hallway: plants / art / umbrella / bin -----------------------------
# NOTE: proc-elevator-car (200x180) does NOT fit the 1100x140 corridor -> skipped.
add("hallway", "plant-rubber-tree", 300, 70)
add("hallway", "plant-rubber-tree", 800, 70)
add("hallway", "artwork-hokusai", 550, 10)
add("hallway", "decor-umbrella-stand", 150, 70)
add("hallway", "decor-bin-black", 950, 70)

# ---------- washrooms: tissue + sansevieria by the vanity ----------------------
add("bathroom", "decor-tissue-box", -15, 530, elevationY=82)
add("bathroom", "plant-sansevieria", 120, 420)
add("bathroom2", "decor-tissue-box", 195, 530, elevationY=82)
add("bathroom2", "plant-sansevieria", 120, 430)

json.dump(d, open(P, "w"), ensure_ascii=False, indent=2)

# ---------- overlap report: new floor items vs pre-existing floor items -------
# (re-read the file; items added above are the last N per room — recompute by id)
NEW = {
    "living": ["proc-reception-desk", "plant-monstera", "proc-whiteboard",
               "sofa-modular-green", "coffee-marble-rect", "plant-rubber-tree",
               "lamp-arc-gold", "elec-monitor", "lamp-desk-arm",
               "decor-tissue-box", "decor-globe", "toy-teddy"],
    "dining": ["proc-meeting-table", "chair-ergonomic", "proc-whiteboard"],
    "custom2": ["proc-ceo-desk", "chair-ergonomic", "sofa-leather-brown",
                "coffee-marble-rect", "plant-rubber-tree", "mural-inkwash",
                "bookshelf-with-books"],
    "kitchen": ["proc-pantry-counter"],
    "hallway": ["plant-rubber-tree", "artwork-hokusai", "decor-umbrella-stand",
                "decor-bin-black"],
    "bathroom": ["plant-sansevieria"],
    "bathroom2": ["plant-sansevieria"],
}
SKIP_FLOOR = {"rug-nordic-geo", "rug-persian", "rug-boho", "rug-modern-gray",
              "rug-persian-wool", "rug-qashqai", "proc-tatami", "stone-path",
              "proc-ground-stone", "proc-ground-dry", "proc-water-plane"}
for room, fids in NEW.items():
    items = rooms[room]["placedItems"]
    for it in items:
        if it["furnitureId"] not in fids or it.get("elevationY"):
            continue
        w, dd = wdim(it["furnitureId"])
        sw, sd = it.get("scaleW", 1), it.get("scaleD", 1)
        x0, z0 = it["x"], it["z"]
        x1, z1 = x0 + w * sw, z0 + dd * sd
        for o in items:
            if o is it or o.get("elevationY") or o.get("mountCeiling"):
                continue
            if o["furnitureId"] in SKIP_FLOOR:
                continue
            ow, od = wdim(o["furnitureId"])
            ox0, oz0 = o["x"], o["z"]
            ox1, oz1 = ox0 + ow * o.get("scaleW", 1), oz0 + od * o.get("scaleD", 1)
            if x0 < ox1 - 5 and x1 > ox0 + 5 and z0 < oz1 - 5 and z1 > oz0 + 5:
                print(f"OVERLAP {room}: new {it['furnitureId']} ({x0:.0f},{z0:.0f})-({x1:.0f},{z1:.0f}) "
                      f"vs {o['furnitureId']} ({ox0:.0f},{oz0:.0f})-({ox1:.0f},{oz1:.0f})")
for room in ["living", "dining", "master", "kitchen", "hallway", "custom2",
             "closet", "bathroom", "bathroom2", "equipment_room"]:
    print(room, len(rooms.get(room, {}).get("placedItems", [])))
