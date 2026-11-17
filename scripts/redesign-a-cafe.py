"""Group A redesign: set-cafe.json edits. Run from the worktree root."""
import json, copy

P = "src/data/templates/set-cafe.json"
d = json.load(open(P))
ov = d[0]
living = ov["living"]
hallway = ov["hallway"]
kitchen = ov["kitchen"]

def find(room, fid, x=None, z=None):
    out = []
    for i, it in enumerate(room):
        if it["furnitureId"] != fid:
            continue
        if x is not None and abs(it["x"] - x) > 1:
            continue
        if z is not None and abs(it["z"] - z) > 1:
            continue
        out.append(i)
    return out

def remove(room, fid, x=None, z=None):
    for i in reversed(find(room, fid, x, z)):
        del room[i]

def add(room, fid, x, z, **kw):
    it = {"furnitureId": fid, "x": x, "z": z}
    it.update(kw)
    room.append(it)

# --- 1. De-duplicate table smalls -------------------------------------------
# Table C (616,330) reading table: swap one cappuccino for vintage books
remove(living, "decor-cappuccino", 618, 356)
add(living, "decor-books-vintage", 618, 356, elevationY=74)
# Table G (1055,330) couple table: cappuccino -> coffee-for-two
remove(living, "decor-cappuccino", 1031, 320)
add(living, "decor-coffee-for-two", 1031, 320, elevationY=74)
# Table H (1055,500): cappuccino -> books pile
remove(living, "decor-cappuccino", 1031, 490)
add(living, "decor-books-pile", 1031, 490, elevationY=74)

# --- 2. Sofa lounge: convert table F (140,450) ------------------------------
remove(living, "dining_table-cafe-rustic", 140, 450)
for cx, cz in [(140, 384), (140, 516), (74, 450), (206, 450)]:
    remove(living, "chair-nordic-oak", cx, cz)
remove(living, "lamp-pendant-ikea4", 140, 450)
remove(living, "decor-tulip", 140, 450)
remove(living, "decor-cappuccino", 116, 440)
remove(living, "decor-coffee-mug", 164, 442)
# move the monstera out of the lounge corner
for i in find(living, "plant-monstera", 85, 530):
    living[i]["x"], living[i]["z"] = 45, 330
add(living, "sofa-modular-green", 170, 470, rotation=0)
add(living, "coffee-marble-rect", 170, 360)
add(living, "decor-books-pile", 155, 360, elevationY=45)
add(living, "decor-coffee-mug", 185, 360, elevationY=45)
add(living, "decor-coffee-mug", 170, 375, elevationY=45)
add(living, "rug-boho", 170, 440)
add(living, "lamp-arc-gold", 280, 560)
add(living, "artwork-klimt-kiss", 8, 470, rotation=90)

# --- 3. Window bar (NE, counter already at 1055,35) --------------------------
add(living, "decor-coffee-menu", 1055, 8, elevationY=200)
add(living, "plant-hanging-pothos", 1150, 50)
add(living, "lamp-pendant-ikea4", 1055, 70)

# --- 4. Main bar back wall + counter top -------------------------------------
add(living, "appliance-espresso", 650, 150, elevationY=110)
add(living, "decor-cappuccino", 700, 150, elevationY=110)
add(living, "decor-cappuccino", 720, 160, elevationY=110)
add(living, "decor-tulip", 620, 170, elevationY=110)
add(living, "decor-tissue-box", 700, 185, elevationY=110)
add(living, "decor-coffee-jar", 520, 140, elevationY=110)
# chalkboard on north wall; shift the monstera that stood in front of it
for i in find(living, "plant-monstera", 899, 42):
    living[i]["x"] = 950
add(living, "decor-menu-chalkboard", 900, 8, elevationY=150)
add(living, "counter-bakery-display", 1130, 260)

# --- 5. Walls / dividers ------------------------------------------------------
add(living, "mural-red-fuji", 1170, 120, rotation=270, elevationY=150)
add(living, "decor-aframe-chalkboard", 700, 560)
add(living, "bookshelf-with-books", 930, 380, rotation=90)

# --- 6. Terrace (hallway) ------------------------------------------------------
add(hallway, "plant-rubber-tree", 580, 150)
for tx, tz in [(350, 92), (743, 91), (1029, 88)]:
    add(hallway, "decor-tulip", tx, tz, elevationY=75)
add(hallway, "outdoor-hanging-chair", 580, 90)
add(hallway, "proc-street-lamp", 250, 150)
add(hallway, "plant-hanging-pothos", 350, 20)
add(hallway, "plant-hanging-pothos", 743, 20)
add(hallway, "decor-umbrella-stand", 230, 50)
add(hallway, "stone-path", 600, 90, rotation=90)

# --- 7. Back kitchen ------------------------------------------------------------
add(kitchen, "decor-coffee-jar", 240, 160, elevationY=105)
add(kitchen, "decor-coffee-jar", 255, 175, elevationY=105)
add(kitchen, "storage-shelving-2", 140, 20)

json.dump(d, open(P, "w"), ensure_ascii=False, indent=2)
for room, items in ov.items():
    print(room, len(items))
