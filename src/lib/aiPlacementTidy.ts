/**
 * aiPlacementTidy — AI 摆位校正 pass（确定性规则，弱模型乱摆的兜底）。
 *
 * 背景：文生/照片复刻的家具落点全看 BYOK 模型当次发挥，弱模型常见病（用户实拍）：
 * 床飘在房间正中不靠墙、床头柜孤零零丢在角落或跑到床尾、衣柜浮在房间中部、挂画躺
 * 在地板上。识别（选什么家具）通常是准的，摆位（放哪）不可靠——所以在
 * resolveAiFurniture 落库前跑一遍规则修正，把下限兜住：
 *
 *   1. 床贴墙：吸附到**模型所选的最近墙**（参考图床靠哪面、模型坐标就偏向哪面——
 *      遵从这个意图，只修「悬空不贴墙」的物理无效，不写死某面墙）
 *   2. 床头柜配对：按床的实际墙别在床头线沿墙分列两侧（没有床则退化为贴墙件）
 *   3. 柜类贴墙：衣柜/梳妆台/书柜/边柜/电视柜/储物按「最近的墙」吸附，背贴墙、面朝室内
 *   4. 挂画上墙：吸附最近墙 + 默认挂高（不许躺地上）；窗帘同样贴墙
 *   5. 重叠推开：实体件之间 AABB 分离（贴墙件只沿墙滑，不离墙）
 *   6. 全部钳制在房间内
 *
 * 纯函数、零依赖（家具尺寸/类目由调用方注入），可直接用 node 跑测试。
 * 坐标系：房间局部 cm，NW 原点，x→东，z→南；rot 0=面朝 S(+z)，背靠墙的朝向映射：
 * 背N→0、背E→90、背S→180、背W→270（与精修模板同约定）。
 */

export interface TidyItem {
  furnitureId: string;
  x: number;            // 中心，cm
  z: number;
  rotation: number;     // 0/90/180/270
  elevationY?: number;
  mountCeiling?: boolean;
  scaleW?: number;
  scaleD?: number;
  scaleH?: number;
}

export interface TidyDef {
  width: number;        // cm（未缩放）
  depth: number;
  category: string;
}

const GAP = 6;          // 贴墙缝隙 cm
const PAIR_GAP = 8;     // 床头柜与床的间隙

/** 背靠某面墙时的朝向（面朝室内）。 */
const WALL_ROT: Record<"N" | "E" | "S" | "W", number> = { N: 0, E: 90, S: 180, W: 270 };

/** 贴墙件（背必须靠墙的柜类）。 */
const WALL_HUGGERS = new Set([
  "wardrobe", "dresser", "bookshelf", "sideboard", "tv_unit", "storage",
  "kitchen_cabinet", "refrigerator", "desk",
]);
/** 上墙件（挂着的，不占地）。 */
const WALL_MOUNTED = new Set(["artwork", "mirror", "curtain"]);
/** 不参与碰撞的（贴地薄片/挂件/吊顶）。 */
const NO_COLLIDE = new Set(["rug", "artwork", "mirror", "curtain"]);

/** 旋转后的轴对齐占地（90/270 交换宽深）。 */
function footprint(def: TidyDef, it: TidyItem): { w: number; d: number } {
  const w = def.width * (it.scaleW ?? 1);
  const d = def.depth * (it.scaleD ?? 1);
  return (it.rotation % 180 === 90) ? { w: d, d: w } : { w, d };
}

function nearestWall(it: TidyItem, roomW: number, roomD: number): "N" | "E" | "S" | "W" {
  const dists: Array<["N" | "E" | "S" | "W", number]> = [
    ["N", it.z], ["S", roomD - it.z], ["W", it.x], ["E", roomW - it.x],
  ];
  dists.sort((a, b) => a[1] - b[1]);
  return dists[0][0];
}

/** 把 it 背贴到 wall 上（改坐标 + 朝向），沿墙方向的位置保留并钳制。 */
function snapToWall(it: TidyItem, def: TidyDef, wall: "N" | "E" | "S" | "W", roomW: number, roomD: number): void {
  it.rotation = WALL_ROT[wall];
  const fp = footprint(def, it);
  if (wall === "N") { it.z = fp.d / 2 + GAP; it.x = clamp(it.x, fp.w / 2 + GAP, roomW - fp.w / 2 - GAP); }
  if (wall === "S") { it.z = roomD - fp.d / 2 - GAP; it.x = clamp(it.x, fp.w / 2 + GAP, roomW - fp.w / 2 - GAP); }
  if (wall === "W") { it.x = fp.w / 2 + GAP; it.z = clamp(it.z, fp.d / 2 + GAP, roomD - fp.d / 2 - GAP); }
  if (wall === "E") { it.x = roomW - fp.w / 2 - GAP; it.z = clamp(it.z, fp.d / 2 + GAP, roomD - fp.d / 2 - GAP); }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 房门（禁放区来源）：pos=沿墙起点 cm，len=门宽 cm。 */
export interface TidyDoor {
  wall: "N" | "E" | "S" | "W";
  pos: number;
  len: number;
}

/** 门的禁放矩形：门洞沿墙 ±10cm 余量，向室内伸出「门宽+40cm」的开扇区。 */
function doorRect(d: TidyDoor, roomW: number, roomD: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const lo = d.pos - 10, hi = d.pos + d.len + 10;
  const swing = d.len + 40;
  switch (d.wall) {
    case "N": return { minX: lo, maxX: hi, minZ: 0, maxZ: swing };
    case "S": return { minX: lo, maxX: hi, minZ: roomD - swing, maxZ: roomD };
    case "W": return { minX: 0, maxX: swing, minZ: lo, maxZ: hi };
    case "E": return { minX: roomW - swing, maxX: roomW, minZ: lo, maxZ: hi };
  }
}

export function tidyAiPlacements(
  items: TidyItem[],
  roomW: number,
  roomD: number,
  getDef: (furnitureId: string) => TidyDef | undefined,
  doors: TidyDoor[] = [],
): TidyItem[] {
  const defs = new Map<TidyItem, TidyDef>();
  for (const it of items) {
    const d = getDef(it.furnitureId);
    if (d) defs.set(it, d);
  }
  const of = (it: TidyItem) => defs.get(it);

  // ── 1. 床贴「模型所选的最近墙」（床头朝墙）──
  // 不写死某面墙：参考图里床靠哪面、视觉模型就会把坐标放向那边——遵从这个意图，
  // 只把「悬空不贴墙」这种物理无效修掉（用户：不要写死，应该遵从图片的效果）。
  const beds = items.filter(it => of(it)?.category === "bed" && !it.mountCeiling);
  const bedWall = beds.length ? nearestWall(beds[0], roomW, roomD) : null;
  for (const bed of beds) {
    snapToWall(bed, of(bed)!, nearestWall(bed, roomW, roomD), roomW, roomD);
  }

  // ── 2. 床头柜按床的实际墙别，在床头线沿墙分列两侧 ──
  const stands = items.filter(it => of(it)?.category === "nightstand" && !it.mountCeiling);
  if (beds.length > 0 && bedWall) {
    const bed = beds[0];
    const bfp = footprint(of(bed)!, bed);
    const alongX = bedWall === "N" || bedWall === "S";      // 沿墙轴：N/S→x，W/E→z
    const bedAlongHalf = alongX ? bfp.w / 2 : bfp.d / 2;
    stands.forEach((ns, i) => {
      const ndef = of(ns)!;
      ns.rotation = WALL_ROT[bedWall];
      const nfp = footprint(ndef, ns);
      const nsAlongHalf = alongX ? nfp.w / 2 : nfp.d / 2;
      const side = i % 2 === 0 ? -1 : 1;                     // 第1个一侧、第2个另一侧
      const along = (alongX ? bed.x : bed.z) + side * (bedAlongHalf + nsAlongHalf + PAIR_GAP);
      if (alongX) {
        ns.x = clamp(along, nfp.w / 2 + GAP, roomW - nfp.w / 2 - GAP);
        ns.z = bedWall === "N" ? nfp.d / 2 + GAP : roomD - nfp.d / 2 - GAP;
      } else {
        ns.z = clamp(along, nfp.d / 2 + GAP, roomD - nfp.d / 2 - GAP);
        ns.x = bedWall === "W" ? nfp.w / 2 + GAP : roomW - nfp.w / 2 - GAP;
      }
    });
  } else {
    for (const ns of stands) snapToWall(ns, of(ns)!, nearestWall(ns, roomW, roomD), roomW, roomD);
  }

  // ── 3. 柜类贴最近墙 ──
  for (const it of items) {
    const def = of(it);
    if (!def || it.mountCeiling) continue;
    if (WALL_HUGGERS.has(def.category)) {
      snapToWall(it, def, nearestWall(it, roomW, roomD), roomW, roomD);
    }
  }

  // ── 4. 挂画/镜子/窗帘上墙 ──
  for (const it of items) {
    const def = of(it);
    if (!def || it.mountCeiling) continue;
    if (WALL_MOUNTED.has(def.category)) {
      snapToWall(it, def, nearestWall(it, roomW, roomD), roomW, roomD);
      if ((def.category === "artwork" || def.category === "mirror") && it.elevationY == null) {
        it.elevationY = 110;   // 默认挂高（与精修模板惯例一致）
      }
    }
  }

  // ── 5. 实体件重叠推开（贴墙件只沿墙滑）──
  const solids = items.filter(it => {
    const def = of(it);
    return def && !it.mountCeiling && !NO_COLLIDE.has(def.category);
  });
  const isHugger = (it: TidyItem) => {
    const c = of(it)!.category;
    return WALL_HUGGERS.has(c) || c === "bed" || c === "nightstand";
  };
  const doorRects = doors.map(d => doorRect(d, roomW, roomD));
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    // 5a. 先避门：任何实体件不得压住门洞/开扇区（门被家具堵死是最扎眼的
    // 「门总是错的」观感）。贴墙件沿自己的墙滑开，其余沿重叠小的轴推离门区。
    for (const it of solids) {
      const def = of(it)!;
      const fp = footprint(def, it);
      for (const dr of doorRects) {
        const ox = Math.min(it.x + fp.w / 2, dr.maxX) - Math.max(it.x - fp.w / 2, dr.minX);
        const oz = Math.min(it.z + fp.d / 2, dr.maxZ) - Math.max(it.z - fp.d / 2, dr.minZ);
        if (ox <= 0 || oz <= 0) continue;
        const hug = isHugger(it) ? nearestWall(it, roomW, roomD) : null;
        const axis = hug === "N" || hug === "S" ? "x"
          : hug === "W" || hug === "E" ? "z"
          : (ox < oz ? "x" : "z");
        const rcx = (dr.minX + dr.maxX) / 2, rcz = (dr.minZ + dr.maxZ) / 2;
        if (axis === "x") {
          const dir = it.x >= rcx ? 1 : -1;
          it.x = clamp(it.x + dir * (ox + 2), fp.w / 2 + GAP, roomW - fp.w / 2 - GAP);
        } else {
          const dir = it.z >= rcz ? 1 : -1;
          it.z = clamp(it.z + dir * (oz + 2), fp.d / 2 + GAP, roomD - fp.d / 2 - GAP);
        }
        moved = true;
      }
    }
    for (let a = 0; a < solids.length; a++) {
      for (let b = a + 1; b < solids.length; b++) {
        const A = solids[a], B = solids[b];
        const fa = footprint(of(A)!, A), fb = footprint(of(B)!, B);
        const ox = (fa.w + fb.w) / 2 - Math.abs(A.x - B.x);
        const oz = (fa.d + fb.d) / 2 - Math.abs(A.z - B.z);
        if (ox <= 0 || oz <= 0) continue;   // 无重叠
        // 推「后到的 B」；贴墙件沿墙滑（贴 N/S 墙的沿 x 推,贴 W/E 的沿 z 推）
        const bHug = isHugger(B);
        const bWall = bHug ? nearestWall(B, roomW, roomD) : null;
        const pushAxis = bWall === "N" || bWall === "S" ? "x"
          : bWall === "W" || bWall === "E" ? "z"
          : (ox < oz ? "x" : "z");
        const dir = pushAxis === "x" ? (B.x >= A.x ? 1 : -1) : (B.z >= A.z ? 1 : -1);
        if (pushAxis === "x") B.x = clamp(B.x + dir * (ox + 2), fb.w / 2 + GAP, roomW - fb.w / 2 - GAP);
        else B.z = clamp(B.z + dir * (oz + 2), fb.d / 2 + GAP, roomD - fb.d / 2 - GAP);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // ── 6. 收尾钳制 ──
  for (const it of items) {
    const def = of(it);
    if (!def) continue;
    const fp = footprint(def, it);
    it.x = clamp(it.x, fp.w / 2, roomW - fp.w / 2);
    it.z = clamp(it.z, fp.d / 2, roomD - fp.d / 2);
  }
  return items;
}
