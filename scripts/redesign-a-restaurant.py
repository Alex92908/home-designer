"""Group A redesign: set-restaurant.json edits. Run from the worktree root."""
import json

P = "src/data/templates/set-restaurant.json"
d = json.load(open(P))
ov = d[0]

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

living = ov["living"]
# --- 1. Hotpot tables: 2 rustic -> marble-round + 6 chairs + hotpot set -----
for tx, tz in [(1560, 580), (2000, 900)]:
    for i in find(living, "dining_table-cafe-rustic", tx, tz):
        living[i]["furnitureId"] = "dining-marble-round"
    # two diagonal extra chairs (4 straight chairs already around the table)
    add(living, "chair-modern-gray", tx - 47, tz - 47, rotation=45)
    add(living, "chair-modern-gray", tx + 47, tz + 47, rotation=225)
    add(living, "appliance-cooktop", tx, tz, elevationY=75)
    add(living, "decor-copper-pots", tx + 25, tz + 15, elevationY=75)
    add(living, "decor-dinnerware", tx - 25, tz + 15, elevationY=75)
    add(living, "decor-utensils", tx + 25, tz - 15, elevationY=75)

# --- 2. A tables (mahogany): tea set where missing ----------------------------
for tx, tz in [(300, 580), (1140, 580), (720, 900)]:
    add(living, "decor-tea-set", tx + 25, tz + 20, elevationY=76)
# --- 3. B tables (rustic): fruit + cappuccino ---------------------------------
add(living, "decor-cappuccino", 745, 595, elevationY=74)          # (720,580)
add(living, "decor-fruit-bowl", 275, 912, elevationY=74)          # (300,900)
add(living, "decor-cappuccino", 325, 888, elevationY=74)
add(living, "decor-fruit-bowl", 2415, 632, elevationY=74)         # (2440,620)
add(living, "decor-cappuccino", 2465, 608, elevationY=74)
add(living, "decor-fruit-bowl", 2415, 912, elevationY=74)         # (2440,900)
add(living, "decor-cappuccino", 2465, 888, elevationY=74)

# --- 4. Booths 2 -> 6 -----------------------------------------------------------
add(living, "seat-diner-booth", 100, 510, rotation=0)
add(living, "decor-tulip", 100, 510, elevationY=74)
add(living, "seat-diner-booth", 100, 920, rotation=0)
add(living, "decor-tulip", 100, 920, elevationY=74)
add(living, "seat-diner-booth", 2940, 540, rotation=270)
add(living, "decor-tulip", 2940, 540, elevationY=74)
add(living, "seat-diner-booth", 2200, 520, rotation=0)
add(living, "decor-tulip", 2200, 520, elevationY=74)
add(living, "dining_table-cafe-small", 2200, 650)
add(living, "decor-tulip", 2200, 650, elevationY=96)

# --- 5. Bar: lengthen + back-bar + stools + drinks ------------------------------
add(living, "counter-bar-straight", 1850, 930)
add(living, "counter-back-bar-bottles", 1620, 995)
for sx in (1500, 1620, 1740):
    add(living, "seat-bar-stool", sx, 860)
add(living, "decor-cocktail", 1560, 930, elevationY=115)
add(living, "decor-cocktail", 1680, 930, elevationY=115)
add(living, "decor-tulip", 1620, 950, elevationY=115)
# the rubber tree that stood where the bar extension goes
for i in find(living, "plant-rubber-tree", 1790, 945):
    living[i]["x"], living[i]["z"] = 1480, 990

# --- 6. Waiting area (entrance, west of the south door) -------------------------
add(living, "sofa-modular-green", 1100, 920, rotation=0)
add(living, "coffee-marble-rect", 1100, 790)
add(living, "decor-books-pile", 1080, 790, elevationY=45)
add(living, "decor-coffee-mug", 1120, 790, elevationY=45)
add(living, "plant-rubber-tree", 1300, 990)
add(living, "decor-menu-chalkboard", 1250, 1000, rotation=180)
add(living, "artwork-vangogh", 1000, 1010, rotation=180, elevationY=150)
add(living, "lamp-pendant-saturno", 1100, 900)
add(living, "lamp-arc-gold", 1300, 900)

# --- 7. Walls / plants / rugs -----------------------------------------------------
add(living, "mural-red-fuji", 800, 14)
add(living, "decor-restaurant-sign", 1700, 1010, rotation=180, elevationY=150)
add(living, "plant-hanging-pothos", 600, 740)
add(living, "plant-hanging-pothos", 2000, 740)
add(living, "plant-rubber-tree", 1900, 980)
add(living, "rug-persian", 1500, 750)
for tx, tz in [(300, 580), (1140, 580), (1980, 580), (720, 900)]:
    add(living, "rug-modern-gray", tx, tz)

# --- 8. Private room 1 (dining) ---------------------------------------------------
rm = ov["dining"]
add(rm, "decor-dinnerware", 155, 150, elevationY=76)
add(rm, "decor-fruit-bowl", 205, 190, elevationY=76)
add(rm, "decor-copper-pots", 205, 150, elevationY=76)
add(rm, "sideboard-walnut", 310, 60, rotation=270)
add(rm, "decor-vase-single", 300, 55, elevationY=85)
add(rm, "decor-books-vintage", 320, 70, elevationY=85)
add(rm, "artwork-inkwash", 120, 14)
add(rm, "mural-inkwash", 260, 14)
add(rm, "sofa-armchair", 150, 360, rotation=90)
add(rm, "sofa-armchair", 300, 360, rotation=270)
add(rm, "coffee-oak-round", 230, 360)
add(rm, "decor-tea-set", 230, 360, elevationY=30)
for i in find(rm, "plant-monstera", 310, 390):
    rm[i]["x"], rm[i]["z"] = 30, 390

# --- 9. Private room 2 (master) ---------------------------------------------------
rm = ov["master"]
add(rm, "chair-modern-gray", 108, 120, rotation=0)
add(rm, "chair-modern-gray", 252, 260, rotation=180)
add(rm, "decor-dinnerware", 155, 170, elevationY=74)
add(rm, "decor-tea-set", 205, 210, elevationY=74)
add(rm, "sideboard-euro", 310, 100, rotation=270)
add(rm, "decor-vase-royal", 310, 200)
add(rm, "artwork-impression", 180, 14)
add(rm, "sofa-armchair", 130, 360, rotation=90)
add(rm, "sofa-armchair", 300, 360, rotation=270)
add(rm, "coffee-oak-round", 215, 360)
add(rm, "decor-tea-set", 215, 360, elevationY=30)
for i in find(rm, "plant-rubber-tree", 310, 390):
    rm[i]["x"], rm[i]["z"] = 30, 390

# --- 10. VIP (study): TV -> KTV screen on side wall + mural -----------------------
rm = ov["study"]
remove(rm, "elec-tv-flat", 230, 16)
add(rm, "proc-ktv-screen", 545, 220, rotation=270)
add(rm, "mural-inkwash", 230, 14)
add(rm, "decor-dinner-set-elegant", 205, 185, elevationY=76)
add(rm, "decor-cocktail", 255, 225, elevationY=76)
add(rm, "decor-cocktail", 205, 230, elevationY=76)
add(rm, "proc-bogujia", 40, 300, rotation=90)
add(rm, "proc-celadon-vase", 40, 300, elevationY=92)
add(rm, "decor-vase-single", 40, 300, elevationY=44)
add(rm, "decor-books-vintage", 40, 300, elevationY=128)
add(rm, "sofa-leather-brown", 450, 340, rotation=270)
add(rm, "coffee-marble-rect", 340, 340)
add(rm, "decor-tea-set", 340, 340, elevationY=45)
add(rm, "rug-persian", 230, 205)
for i in find(rm, "plant-monstera", 490, 390):
    rm[i]["x"], rm[i]["z"] = 520, 40

# --- 11. Kitchen ------------------------------------------------------------------
rm = ov["kitchen"]
add(rm, "decor-pots-pans", 380, 120, elevationY=90)
add(rm, "decor-spice-rack", 400, 400, elevationY=110)
add(rm, "decor-utensils", 420, 400, elevationY=110)
add(rm, "appliance-dishwasher", 700, 180)
add(rm, "appliance-microwave", 360, 260, elevationY=90)
add(rm, "decor-trash-bin", 30, 400)
add(rm, "decor-trash-bin", 750, 400)
add(rm, "storage-shelving-2", 45, 180)
add(rm, "proc-basin", 650, 200)
add(rm, "decor-wet-floor-sign", 400, 300)
add(rm, "lamp-ceiling-long", 400, 220)

# --- 12. Washrooms ------------------------------------------------------------------
add(ov["bedroom"], "decor-tissue-box", 250, 30, elevationY=82)
add(ov["bathroom"], "decor-tissue-box", 170, 130)
add(ov["bathroom"], "bath_accessory-towel-rack", 170, 12)
add(ov["bathroom2"], "decor-tissue-box", 170, 130)
add(ov["bathroom2"], "bath_accessory-towel-rack", 170, 12)

# --- 13. Terrace (hallway): 3 groups -> patio sets ----------------------------------
hw = ov["hallway"]
for gx in (1260, 2220, 2860):
    remove(hw, "dining_table-cafe-marble", gx, 100)
    remove(hw, "chair-modern-gray", gx - 60, 100)
    remove(hw, "chair-modern-gray", gx + 60, 100)
    add(hw, "outdoor-patio-set", gx, 100, scaleW=0.8, scaleD=0.8)
    add(hw, "decor-tulip", gx, 100, elevationY=75)
add(hw, "proc-street-lamp", 600, 150)
add(hw, "proc-street-lamp", 2400, 150)
add(hw, "plant-rubber-tree", 600, 50)
add(hw, "plant-rubber-tree", 1800, 50)
add(hw, "decor-menu-chalkboard", 1500, 50)
add(hw, "decor-welcome-sign", 100, 50)
add(hw, "decor-bin-black", 2900, 150)

json.dump(d, open(P, "w"), ensure_ascii=False, indent=2)
for room, items in ov.items():
    print(room, len(items))
