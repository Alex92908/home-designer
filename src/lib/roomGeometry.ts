/**
 * Polygon helpers for non-rectangular rooms (L 型 / 凸字型 / etc.).
 *
 * Coordinate conventions (matches PlacedItem.x/z):
 *  - cm units
 *  - room's back-left corner is the origin (0, 0)
 *  - +x goes right, +z goes "forward / toward the front wall"
 *  - polygon points are CCW when viewed from above
 *
 * When `RoomShape` is absent, the room is treated as a plain rectangle
 * of `{ 0..width, 0..depth }`, which is what every part of the app
 * already assumes today.
 */

export type ShapePreset = "rect" | "l-shape" | "convex" | "custom";

export interface RoomShape {
  preset: ShapePreset;
  /** CCW polygon, cm, origin at room back-left. */
  points: Array<[number, number]>;
  /**
   * 内洞（回字形/环形房间）。每个洞是一条闭合轮廓(cm，同 points 坐标系)。
   * **只影响地板/天花板**：地板/天花板按 THREE.Shape + holes 抠掉洞区，避免与洞里
   * 嵌的独立房间(如办公室大厅中间的会议室/机房岛)重叠。墙/门/窗/碰撞仍只走外轮廓
   * points，洞四周的墙由洞里那些独立房间自己提供，大厅不在洞边生成墙。
   */
  holes?: Array<Array<[number, number]>>;
}

/** Plain rectangle for the given dims (fallback / "rect" preset). */
export function rectShape(width: number, depth: number): RoomShape {
  return {
    preset: "rect",
    points: [[0, 0], [width, 0], [width, depth], [0, depth]],
  };
}

/** L-shape: bite a 40% × 40% chunk out of the front-right corner.
 *
 *  ┌────────────────┐
 *  │                │
 *  │                │
 *  │      ┌─────────┤
 *  │      │
 *  └──────┘
 */
export function lShape(width: number, depth: number): RoomShape {
  const biteW = width * 0.4;
  const biteD = depth * 0.4;
  return {
    preset: "l-shape",
    points: [
      [0, 0],
      [width, 0],
      [width, depth - biteD],
      [width - biteW, depth - biteD],
      [width - biteW, depth],
      [0, depth],
    ],
  };
}

/** 凸字型: middle bump out on the front. 25% inset on each side, 25% extra depth in the middle.
 *
 *  ┌────────────────┐
 *  │                │
 *  │                │
 *  │                │
 *  └──┐          ┌──┘
 *     │          │
 *     └──────────┘
 */
export function convexShape(width: number, depth: number): RoomShape {
  const inset = width * 0.25;
  const bump  = depth * 0.25;
  return {
    preset: "convex",
    points: [
      [0, 0],
      [width, 0],
      [width, depth],
      [width - inset, depth],
      [width - inset, depth + bump],
      [inset, depth + bump],
      [inset, depth],
      [0, depth],
    ],
  };
}

/** Build a preset polygon for the given dims. */
export function buildShape(preset: ShapePreset, width: number, depth: number): RoomShape {
  switch (preset) {
    case "l-shape": return lShape(width, depth);
    case "convex":  return convexShape(width, depth);
    case "rect":
    default:        return rectShape(width, depth);
  }
}

/** Bounding box of a polygon, cm. */
export function polygonBounds(points: Array<[number, number]>) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return { minX, maxX, minZ, maxZ };
}

/** Ray-cast point-in-polygon (returns true if (x,z) is inside pts). */
export function pointInPolygon(pts: Array<[number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    const intersects = (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ─── Edge helpers (for placing doors/windows on polygon walls) ──

export type WallFacing = "N" | "S" | "W" | "E";

export interface EdgeInfo {
  /** Index into `points` of this edge's start vertex. */
  i: number;
  x1: number; z1: number;      // start (cm)
  x2: number; z2: number;      // end   (cm)
  length: number;              // cm
  /** Inward-facing unit normal (CCW polygon). */
  nx: number; nz: number;
  /** Which cardinal wall this edge faces (by dominant outward-normal axis). */
  facing: WallFacing;
}

export function getEdges(points: Array<[number, number]>): EdgeInfo[] {
  const edges: EdgeInfo[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    const dx = x2 - x1, dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) continue;
    // CCW polygon ⇒ inward normal is 90° left of direction: (-dz, dx)/len
    const nx = -dz / length;
    const nz =  dx / length;
    const ox = -nx, oz = -nz;    // outward normal
    let facing: WallFacing;
    if (Math.abs(ox) >= Math.abs(oz)) facing = ox > 0 ? "E" : "W";
    else                              facing = oz > 0 ? "S" : "N";
    edges.push({ i, x1, z1, x2, z2, length, nx, nz, facing });
  }
  return edges;
}

/** Map the user's "N/S/W/E" door wall (cm offset along that
 *  wall, measured from the conventional "start") onto a polygon edge +
 *  offset along that edge. Returns null if no matching polygon edge
 *  contains the requested span. `bbox` is the room's bounding box. */
/**
 * 门窗落位的**唯一真源**：把平面图里一个洞口（门/窗）解析到它真正所在的多边形边上，
 * 并统一换算成「从世界小端（N/S 看西端、E/W 看北端）量起」的坐标。
 *
 * 为什么必须统一在这里算（2026-07 血泪）：
 * 「洞打在哪」(墙体挖孔) 和「窗框/门板摆在哪」(3D 实物) 原来各算各的——
 * 挖孔走 findEdgeForWall（认多边形边），摆实物却用外接矩形平面 `cx - rW/2`。
 * 咖啡馆客厅是凹形（西侧有 西墙1/西墙2 两段、中间是厨房凹口），两者相差 270cm，
 * 结果就是「有窗洞没窗户」——洞在真墙上，窗框飘到外接矩形西平面外面去了。
 * 任何消费者都必须用本函数的结果，不许再自己按 bbox 推。
 *
 * 返回：
 *   · wallCoordCm —— 该面所在的恒定坐标（N/S 面给 z，E/W 面给 x），实物贴这个面
 *   · alongCm     —— 洞口起点沿墙的坐标，**含边自身在多边形里的偏移**，从世界小端量
 */
export function resolveHoleOnPolygon(
  points: Array<[number, number]>,
  wall: WallFacing,
  posCm: number,
  lenCm: number,
  bbox: { maxX: number; maxZ: number },
  edgeIndexHint?: number,
): { edgeIndex: number; alongCm: number; wallCoordCm: number; edge: EdgeInfo } | null {
  const hit = findEdgeForWall(points, wall, posCm, lenCm, bbox, edgeIndexHint);
  if (!hit) return null;
  const e = hit.edge;
  const horiz = wall === "N" || wall === "S";
  // findEdgeForWall 的 startCm 是从**边的起点顶点**量的。CCW 多边形里 S 边由东向西、
  // W 边由南向北，与「从世界小端量」相反，这类边要翻过来。
  const aligned = horiz ? e.x2 >= e.x1 : e.z2 >= e.z1;
  const along = aligned ? hit.startCm : Math.max(0, e.length - hit.startCm - lenCm);
  const smallEnd = horiz ? Math.min(e.x1, e.x2) : Math.min(e.z1, e.z2);
  return {
    edgeIndex: hit.edgeIndex,
    alongCm: smallEnd + along,
    wallCoordCm: horiz ? e.z1 : e.x1,
    edge: e,
  };
}

export function findEdgeForWall(
  points: Array<[number, number]>,
  wall: WallFacing,
  posCm: number,
  lenCm: number,
  bbox: { maxX: number; maxZ: number },
  edgeIndexHint?: number,
): { edgeIndex: number; startCm: number; edge: EdgeInfo } | null {
  const edges = getEdges(points);

  // Explicit hint path: caller knows exactly which polygon edge owns this
  // hole, and `posCm` is already in edge-local coords (cm from edge start).
  // Used for inner-corner walls of L / convex rooms that the cardinal
  // bbox-projection scheme below can't reach.
  if (edgeIndexHint != null) {
    const e = edges.find(x => x.i === edgeIndexHint);
    if (e && posCm >= -1 && posCm + lenCm <= e.length + 1) {
      return { edgeIndex: e.i, startCm: Math.max(0, posCm), edge: e };
    }
    // Fall through to legacy lookup if the hint is stale (e.g. polygon was
    // edited and the indexed edge no longer exists / is too short).
  }

  // Legacy: project the (wall, posCm) tuple to a world point on the bbox
  // perimeter, then find the polygon edge whose line passes through it.
  //   N: (posCm, 0)        running +x
  //   E: (maxX,  posCm)    running +z
  //   S: (posCm, maxZ)     running +x
  //   W: (0,     posCm)    running +z
  let wx: number, wz: number;
  if (wall === "N")      { wx = posCm;     wz = 0; }
  else if (wall === "S") { wx = posCm;     wz = bbox.maxZ; }
  else if (wall === "E") { wx = bbox.maxX; wz = posCm; }
  else                   { wx = 0;         wz = posCm; }

  const candidates = edges.filter(e => e.facing === wall);
  for (const e of candidates) {
    const dx = e.x2 - e.x1, dz = e.z2 - e.z1;
    const t = ((wx - e.x1) * dx + (wz - e.z1) * dz) / e.length;
    const perpDist = Math.abs((wx - e.x1) * e.nx + (wz - e.z1) * e.nz);
    // t 是「投影点」沿边的位置，而投影点用的是 posCm —— 即洞口的**世界小端**。
    // CCW 多边形里 S 边由东向西、W 边由南向北，这类反向边上，世界小端其实是洞口
    // 沿边方向的**末端**，所以要减一个洞宽才是「沿边起点」。
    // 不减的话，返回值语义就与另外两条路径（edgeIndex 提示 / 吸附兜底，两者的
    // startCm 都是沿边起点）不一致，下游统一换算时会整整差一个洞宽：
    // 客厅 S 门(pos520,len160) 曾因此被放到 360 而非 520 —— 门板对了、门洞偏 160cm。
    const aligned = (wall === "N" || wall === "S") ? e.x2 >= e.x1 : e.z2 >= e.z1;
    const startAlong = aligned ? t : t - lenCm;
    if (perpDist < 2 && startAlong >= -1 && startAlong + lenCm <= e.length + 1) {
      return { edgeIndex: e.i, startCm: Math.max(0, startAlong), edge: e };
    }
  }

  // 最终回退：投影打不到任何精确匹配的边 → **吸附到该朝向最近的、放得下的边**。
  //
  // 为什么必须有这一步（用户：我明明平面图设置了窗户，为什么吃掉了）：
  // 用户在 2D 平面图上给 L 形房间的 W 墙加窗，pos 是按外接矩形量的；若这个投影点
  // 正好落在凹口（那段没有本房间的墙），上面的精确匹配就打不到。之前的处理是
  // 各视图各自兜底（有的画、有的不画 → 分叉），后来改成一律不画（→ 用户的窗
  // 凭空消失）。两种都不对：**用户配置的窗永远不该消失**，应该落到该朝向真实
  // 存在的最近一段墙上并夹进边内。做在本真源函数里，2D/效果图/外观图/漫游碰撞
  // 全部拿到同一个吸附结果，天然一致。
  let best: { edgeIndex: number; startCm: number; edge: EdgeInfo } | null = null;
  let bestCost = Infinity;
  for (const e of candidates) {
    if (e.length + 1 < lenCm) continue;                     // 这段墙放不下
    const dx = e.x2 - e.x1, dz = e.z2 - e.z1;
    const t = ((wx - e.x1) * dx + (wz - e.z1) * dz) / e.length;
    const tc = Math.max(0, Math.min(t, e.length - lenCm));  // 夹进边内
    const perpDist = Math.abs((wx - e.x1) * e.nx + (wz - e.z1) * e.nz);
    const cost = Math.abs(t - tc) + perpDist;               // 沿墙偏移 + 垂距
    if (cost < bestCost) { bestCost = cost; best = { edgeIndex: e.i, startCm: tc, edge: e }; }
  }
  return best;
}

/**
 * 把 `edgeIndex` 绑定的门/窗，换算成"外接矩形 + NSWE 四面"坐标系下的等价 (wall, pos)。
 *
 * 为什么需要：外观图(FloorPlanExterior)和全屋3D(HouseCanvas)的墙体引擎是按房间的
 * **外接矩形四面**工作的（effRect），全文不认 `edgeIndex`。于是用户在 L 型 / 凸字形
 * 房间的**内凹边**上放的门窗，在 2D 平面图和室内效果图里位置正确（它们走
 * findEdgeForWall 的沿边基准），到了外观图/全屋3D 却被投影到外接矩形的外框上，
 * 位置整个跑偏。这个函数把沿边坐标折算回外框坐标，让两套引擎对上。
 *
 * 注意这是**投影近似**：内凹边被折算到它所朝向的那面外框上。真正做到"沿多边形边
 * 渲染墙体"是另一个量级的改造（整套幕墙/门窗/墙体都要改），这里先消掉肉眼可见的错位。
 *
 * @param points     房间多边形（room-local cm，(0,0)=房间左上角）
 * @param roomOrigin 房间左上角在平面图坐标系里的位置（= roomLayout[room]）
 * @param rect       该房间的有效外接矩形（= effRect，平面图坐标系 cm）
 * @returns null 表示 edgeIndex 失效（多边形被改过），调用方应回退到原 wall/pos
 */
export function edgeHoleToRectPos(
  points: Array<[number, number]>,
  edgeIndex: number,
  posCm: number,
  lenCm: number,
  roomOrigin: { x: number; y: number },
  rect: { x: number; y: number; width: number; depth: number },
): { wall: WallFacing; pos: number } | null {
  const e = getEdges(points).find(x => x.i === edgeIndex);
  if (!e || e.length < 1e-3) return null;

  // 洞口两端沿边的 room-local 坐标
  const ux = (e.x2 - e.x1) / e.length, uz = (e.z2 - e.z1) / e.length;
  const ax = e.x1 + ux * posCm,            az = e.z1 + uz * posCm;
  const bx = e.x1 + ux * (posCm + lenCm),  bz = e.z1 + uz * (posCm + lenCm);

  // 折算到平面图坐标，再取外框那一面的起点偏移。
  // 外框约定与 FloorPlanExterior 一致：N/S 从西端量起，W/E 从北端量起；
  // 边的走向可能与世界轴相反（CCW 多边形的 S 边是东→西），故取两端的较小值。
  if (e.facing === "N" || e.facing === "S") {
    const pos = Math.min(roomOrigin.x + ax, roomOrigin.x + bx) - rect.x;
    return { wall: e.facing, pos: Math.max(0, Math.min(pos, Math.max(0, rect.width - lenCm))) };
  }
  const pos = Math.min(roomOrigin.y + az, roomOrigin.y + bz) - rect.y;
  return { wall: e.facing, pos: Math.max(0, Math.min(pos, Math.max(0, rect.depth - lenCm))) };
}

/**
 * 多边形与一条**轴向扫描线**的相交区间（room-local cm）。
 *
 * 用途：外观图判断"本房间的某面墙是否被邻居挡住(=内墙)"。原来只拿邻居的
 * 外接矩形做区间判定，邻居本身是 L/凸字形时 AABB 比实体大，凹角处会把本该
 * 露出来的外墙误判成内墙 → 整段立面消失。
 *
 * 用扫描线求交而不是采样：采样几厘米的误差会在墙段边界留下可见的缝。
 *
 * @param horizontal true = 扫描线 z=c，返回被覆盖的 x 区间；
 *                   false = 扫描线 x=c，返回被覆盖的 z 区间。
 */
export function polygonSpansAtLine(
  points: Array<[number, number]>,
  horizontal: boolean,
  c: number,
): Array<[number, number]> {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    // 取"跨过扫描线"的边求交点。半开区间 [lo, hi) 避免顶点被数两次。
    const a = horizontal ? z1 : x1;
    const b = horizontal ? z2 : x2;
    if (a === b) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (c < lo || c >= hi) continue;
    const t = (c - a) / (b - a);
    xs.push(horizontal ? x1 + t * (x2 - x1) : z1 + t * (z2 - z1));
  }
  xs.sort((p, q) => p - q);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > 1e-6) spans.push([xs[i], xs[i + 1]]);
  }
  return spans;
}

/**
 * 把**正交多边形**沿外法线整体外扩 `d`（负值=内缩）。用于屋面出檐：
 * 屋面板要比墙体外轮廓大出一个挑檐宽度，而不能只在外接矩形上外扩
 * （那样凹口又被填平了）。
 *
 * 正交多边形的外扩可以精确求解：每条边沿自己的外法线平移 `d` 后仍是轴对齐
 * 直线，相邻两条边必然一横一竖，交点直接取「竖边的 x + 横边的 z」即可，
 * 不需要一般多边形那套复杂的 offset/自交处理。
 *
 * 非正交边会被跳过（本引擎的一维模型本来也表达不了斜边），
 * 若结果点数 <3 则返回原多边形，宁可不外扩也不要塌掉。
 */
export function offsetRectilinearPolygon(
  points: Array<[number, number]>,
  d: number,
  axisEps = 1,
): Array<[number, number]> {
  const edges = getEdges(points).filter(e =>
    Math.abs(e.z2 - e.z1) <= axisEps || Math.abs(e.x2 - e.x1) <= axisEps);
  if (edges.length < 3) return points;

  // 每条边平移后的「常量坐标」+ 它是横还是竖
  const lines = edges.map(e => {
    const horiz = Math.abs(e.z2 - e.z1) <= axisEps;
    const ox = -e.nx, oz = -e.nz;             // 外法线
    return horiz
      ? { horiz: true,  c: (e.z1 + e.z2) / 2 + oz * d }
      : { horiz: false, c: (e.x1 + e.x2) / 2 + ox * d };
  });

  const out: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cur  = lines[i];
    if (prev.horiz === cur.horiz) continue;   // 共线/退化，跳过该顶点
    const x = prev.horiz ? cur.c : prev.c;    // 竖边给 x
    const z = prev.horiz ? prev.c : cur.c;    // 横边给 z
    out.push([x, z]);
  }
  return out.length >= 3 ? out : points;
}

/** Shape picker label / icon for UI. */
export const SHAPE_PRESETS: Array<{ preset: ShapePreset; name: string; icon: string }> = [
  { preset: "rect",    name: "矩形",  icon: "▭" },
  { preset: "l-shape", name: "L型",   icon: "⌐" },
  { preset: "convex",  name: "凸字型", icon: "⎍" },
];
