"""Check script for Group A redesigns.
- Every furniture id used in the 10 Group A sets exists in the catalog /
  procedural registry.
- The 10 set ids are unchanged (each appears exactly once in
  projectTemplates.ts).
- Prints before -> after furniture counts per set (HEAD vs worktree).
Run from the worktree root: python3 scripts/check-redesign-a.py
"""
import json, re, subprocess, sys

GROUP_A = [
    "set-apartment", "set-ming-hall", "set-office", "set-qing-sanxitang",
    "set-shikumen", "set-cafe", "set-tang-palace", "set-song-study",
    "set-restaurant", "set-rural-hall",
]

def catalog_ids():
    ids = set()
    for path in ["src/lib/furniture.ts", "src/lib/proceduralFurniture.ts"]:
        src = open(path).read()
        ids |= set(re.findall(r"""id:\s*['"]([^'"]+)['"]""", src))
        ids |= set(re.findall(r"""['"](proc-[a-z0-9-]+)['"]\s*:""", src))
        ids |= set(re.findall(r"""['"](proc-[a-z0-9-]+)['"]\s*,""", src))
    return ids

CAT = catalog_ids()
print(f"catalog ids: {len(CAT)}")

def head_text(path):
    r = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""

def count_ids_in_ts(src):
    """Return {set_id: [furnitureIds]} for the Group A sets found in TS source."""
    out = {}
    # split on set definitions: id: 'set-...'
    parts = re.split(r"id:\s*['\"](set-[a-z-]+)['\"]", src)
    # parts[0] = before first; then alternating id, body
    for i in range(1, len(parts), 2):
        sid, body = parts[i], parts[i + 1] if i + 1 < len(parts) else ""
        # body runs until the next set id; the split already cut it there,
        # but the body also includes the following non-set content up to the
        # next split point -- acceptable: furnitureIds only appear in sets.
        if sid in GROUP_A:
            out[sid] = re.findall(r"furnitureId:\s*['\"]([^'\"]+)['\"]", body)
    return out

def count_ids_in_json(data):
    out = []
    def walk(o):
        if isinstance(o, dict):
            if "furnitureId" in o:
                out.append(o["furnitureId"])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(data)
    return out

failures = 0

# ---- 1. projectTemplates.ts: set ids + furniture ids -------------------------
ts = open("src/lib/projectTemplates.ts").read()
ts_head = head_text("src/lib/projectTemplates.ts")
for sid in GROUP_A:
    n = len(re.findall(rf"id:\s*['\"]{re.escape(sid)}['\"]", ts))
    if n != 1:
        print(f"FAIL set id {sid}: appears {n} times in projectTemplates.ts")
        failures += 1

ts_now = count_ids_in_ts(ts)
ts_before = count_ids_in_ts(ts_head)
# TS sets (all except cafe/restaurant/office which live in JSON/snapshot)
for sid in GROUP_A:
    if sid in ("set-cafe", "set-restaurant", "set-office"):
        continue
    now = ts_now.get(sid, [])
    before = ts_before.get(sid, [])
    bad = [f for f in now if f not in CAT]
    if bad:
        print(f"FAIL {sid}: unknown ids {sorted(set(bad))}")
        failures += 1
    print(f"{sid}: {len(before)} -> {len(now)} items")

# ---- 2. JSON sets --------------------------------------------------------------
def check_json(path, sid):
    global failures
    now = json.load(open(path))
    before = json.loads(head_text(path)) if head_text(path) else None
    now_ids = count_ids_in_json(now)
    bad = [f for f in now_ids if f not in CAT]
    if bad:
        print(f"FAIL {sid}: unknown ids {sorted(set(bad))}")
        failures += 1
    n_before = len(count_ids_in_json(before)) if before else 0
    rooms_now = {r: len(count_ids_in_json(v)) for r, v in
                 (now[0].items() if isinstance(now, list) else now.items())}
    print(f"{sid}: {n_before} -> {len(now_ids)} items  rooms={rooms_now}")

check_json("src/data/templates/set-cafe.json", "set-cafe")
check_json("src/data/templates/set-restaurant.json", "set-restaurant")

# ---- 3. Office snapshot ----------------------------------------------------------
now = json.load(open("src/data/templates/office-snapshot.json"))
before_raw = head_text("src/data/templates/office-snapshot.json")
before = json.loads(before_raw) if before_raw else None
now_ids = count_ids_in_json(now)
bad = [f for f in now_ids if f not in CAT]
if bad:
    print(f"FAIL set-office: unknown ids {sorted(set(bad))}")
    failures += 1
n_before = len(count_ids_in_json(before)) if before else 0
rooms_now = {r: len(v.get("placedItems", [])) for r, v in
             now["floorPlans"][0]["rooms"].items()}
print(f"set-office: {n_before} -> {len(now_ids)} items  rooms={rooms_now}")

print("FAILURES:", failures)
sys.exit(1 if failures else 0)
