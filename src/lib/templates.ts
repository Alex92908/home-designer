/**
 * Style templates: one-click full room configuration
 * Each template sets materials and furniture for all enabled rooms.
 */
import { RoomType, StyleTag, WindowConfig, WindowStyle, DoorStyle, WallSide, ExteriorWall, ExteriorWallDecorItem, RoutingConnection, RoutingKind, ExteriorSettings } from "./types";
import { MATERIALS } from "./data";
import { getFurnitureById } from "./furniture";

export interface TemplateRoom {
  materialIds: Partial<Record<"wall"|"floor"|"ceiling"|"tile"|"light", string>>;
  furnitureIds: string[];  // in placement order
}

/** Pre-designed room with hand-tuned furniture coordinates. As of the
 *  "精装样板" rewrite, templates also drive windows, door style and
 *  exterior wall decor — not just interior furniture. All these optional
 *  fields are applied by `loadTemplate` in the store. */
export interface EmbeddedRoom {
  baseW: number;   // cm — room width this layout was designed for
  baseD: number;   // cm — room depth this layout was designed for
  /** Full material objects (for non-catalog or demo-plan materials) */
  materials?: Record<string, object>;
  /** Material IDs to look up from MATERIALS catalog (preferred for new templates) */
  materialIds?: Partial<Record<"wall"|"floor"|"ceiling"|"tile"|"light", string>>;
  items: Array<{
    furnitureId: string;
    x: number; z: number;   // cm center coordinates in base dims
    rotation: number;
    scaleW?: number; scaleD?: number;
    /** Height above the floor (cm). Preserved by buildEmbeddedRoomState;
     *  needed for wall-hung pieces (range hood hangs at ~147cm — the
     *  renderer auto-anchors it, but the clearance checker must see the
     *  same height or it flags a phantom floor-level clash with the sink). */
    elevationY?: number;
    scaleH?: number;
  }>;
  /** Windows to place on this room's walls. Coordinates stay in cm
   *  relative to the room's base dimensions; loadTemplate scales them
   *  to the user's actual room size. */
  windows?: Array<{
    wall: WallSide;
    pos: number; len: number; h?: number; sill?: number;
    style?: WindowStyle;
  }>;
  /** Interior door visual style (e.g. wood_panel / french_double / sliding_barn). */
  doorStyle?: DoorStyle;
  /** Optional door placement overrides (wall + position + width). When
   *  set, loadTemplate moves the room's door to this location — lets
   *  templates pin the door at the center of a wall so paired decor
   *  (couplets, wall lamps, house numbers) land symmetrically. */
  doorWall?: WallSide;
  doorPos?: number;   // cm along the wall in base dims (scaled proportionally)
  doorLen?: number;   // cm, door width
  /** Exterior-wall decor — hung on the OUTSIDE face of the room's walls.
   *  u,v are already normalized 0..1; no scaling by user dims needed. */
  exteriorDecor?: Array<{
    furnitureId: string;
    wall: ExteriorWall;
    u: number; v: number;
    scaleW?: number; scaleH?: number;
    rotation?: number;
  }>;
  /** Pre-drawn pipe / wire routing. `from` and `to` are INDEX into the
   *  `items` array (since real instanceIds are generated at load time).
   *  Lets templates ship with a "this is what the M&E layout looks like"
   *  preview that the user can edit afterwards. */
  connections?: Array<{ from: number; to: number; kind: RoutingKind }>;
}

export interface StyleTemplate {
  id: string;
  name: string;
  nameEn: string;
  emoji: string;
  description: string;
  descriptionEn: string;
  accent: string;  // CSS color for preview swatch
  styleTag: StyleTag;  // canonical style tag for score badge
  rooms: Partial<Record<RoomType, TemplateRoom>>;
  /** Optional: hand-crafted layouts override procedural placement */
  embeddedRooms?: Partial<Record<RoomType, EmbeddedRoom>>;
  /** Optional: exterior settings applied when this template is loaded */
  exterior?: Partial<ExteriorSettings>;
}

function mat(id: string) {
  return MATERIALS.find(m => m.id === id) ?? null;
}

// ─── Build room state from hand-crafted embedded data ────────────────────────
// Scales x/z proportionally from base dims to user's actual room dims, then
// clamps each item within the room bounds.
export function buildEmbeddedRoomState(
  roomId: RoomType,
  embedded: EmbeddedRoom,
  userW: number,
  userD: number,
) {
  const sx = userW / embedded.baseW;
  const sz = userD / embedded.baseD;
  let seq = 0;

  // Resolve materials: prefer materialIds lookup, fall back to embedded objects
  const resolvedMaterials: Record<string, object> = {};
  if (embedded.materialIds) {
    for (const [cat, id] of Object.entries(embedded.materialIds)) {
      const found = MATERIALS.find(m => m.id === id);
      if (found) resolvedMaterials[cat] = found;
    }
  }
  if (embedded.materials) {
    Object.assign(resolvedMaterials, embedded.materials);
  }

  const placedItems = embedded.items.flatMap(item => {
    const f = getFurnitureById(item.furnitureId);
    if (!f) return [];
    const sw = item.scaleW ?? 1;
    const sd = item.scaleD ?? 1;
    // Rotation-aware clamp: at 90°/270° the item's width and depth swap
    // axes in world space, so the effective half-extent along X is the
    // depth (and along Z is the width). Without this swap, a curtain
    // rotated 270° to hang along the right wall gets clamped by its
    // full 90cm half-width on X and ends up pushed 90cm into the room
    // instead of sitting flush with the wall.
    const rot = ((item.rotation % 360) + 360) % 360;
    const rotatedSideways = rot === 90 || rot === 270;
    const halfX = (rotatedSideways ? f.depth * sd : f.width  * sw) / 2;
    const halfZ = (rotatedSideways ? f.width  * sw : f.depth * sd) / 2;
    const clampX = Math.max(halfX + 4, Math.min(userW - halfX - 4, item.x * sx));
    const clampZ = Math.max(halfZ + 4, Math.min(userD - halfZ - 4, item.z * sz));
    // Wall-hugging snap: positions scale with the room but item sizes
    // don't, so a piece designed flush to a wall drifts off it in a
    // deeper/wider room (e.g. a bed drawn 0cm off its headboard wall ends
    // up 25cm off it → hugWall warning). If the design put the item
    // within 15cm of a wall, keep that offset after scaling instead of
    // the scaled position — it preserves the designer's intent at any
    // room size. The 4cm floor keeps the existing clamp margin.
    const snapAxis = (p: number, half: number, base: number, user: number, basePos: number) => {
      const dMin = basePos - half;          // base offset to the min-side wall
      const dMax = base - (basePos + half); // base offset to the max-side wall
      if (dMin <= 15 && dMin <= dMax) return Math.max(half + 4, half + Math.max(0, dMin));
      if (dMax <= 15 && dMax < dMin) return Math.min(user - half - 4, user - half - Math.max(0, dMax));
      return p;
    };
    const px = snapAxis(clampX, halfX, embedded.baseW, userW, item.x);
    const pz = snapAxis(clampZ, halfZ, embedded.baseD, userD, item.z);
    return [{
      instanceId: `emb_${roomId}_${seq++}_${item.furnitureId}`,
      furnitureId: item.furnitureId,
      x: px, z: pz,
      rotation: item.rotation,
      scaleW: sw, scaleD: sd,
      ...(item.elevationY !== undefined ? { elevationY: item.elevationY } : {}),
      ...(item.scaleH !== undefined ? { scaleH: item.scaleH } : {}),
    }];
  });

  // Scale windows (positions are in cm along the wall)
  const windows: WindowConfig[] = (embedded.windows ?? []).map((w, i) => {
    // For N/S walls, position scales with userW (room width)
    // For W/E walls, position scales with userD (room depth)
    const sAlong = (w.wall === "N" || w.wall === "S") ? sx : sz;
    const wallMax = (w.wall === "N" || w.wall === "S") ? userW : userD;
    const len = Math.min(wallMax - 20, w.len * sAlong);
    const pos = Math.max(10, Math.min(wallMax - len - 10, w.pos * sAlong));
    return {
      id: `emb_win_${roomId}_${i}`,
      wall: w.wall,
      pos, len,
      ...(w.h !== undefined ? { h: w.h } : {}),
      ...(w.sill !== undefined ? { sill: w.sill } : {}),
      ...(w.style ? { style: w.style } : {}),
    };
  });

  // Exterior decor — u,v already normalized, no scaling needed
  const exteriorDecor: ExteriorWallDecorItem[] = (embedded.exteriorDecor ?? []).map((d, i) => ({
    instanceId: `emb_decor_${roomId}_${i}_${d.furnitureId}`,
    furnitureId: d.furnitureId,
    wall: d.wall,
    u: d.u, v: d.v,
    ...(d.scaleW !== undefined ? { scaleW: d.scaleW } : {}),
    ...(d.scaleH !== undefined ? { scaleH: d.scaleH } : {}),
    ...(d.rotation !== undefined ? { rotation: d.rotation } : {}),
  }));

  // Door position: scale along the wall (N/S ~ sx, W/E ~ sz)
  const doorSide = embedded.doorWall ?? undefined;
  const doorScale = (doorSide === "W" || doorSide === "E") ? sz : sx;
  const doorPos = embedded.doorPos !== undefined ? Math.round(embedded.doorPos * doorScale) : undefined;
  const doorLen = embedded.doorLen !== undefined ? Math.round(embedded.doorLen * doorScale) : undefined;

  // Build routing connections — resolve item-array indices to actual
  // instanceIds generated above. Out-of-range refs are silently dropped.
  const connections: RoutingConnection[] = (embedded.connections ?? []).flatMap((c, i) => {
    const a = placedItems[c.from];
    const b = placedItems[c.to];
    if (!a || !b) return [];
    return [{
      id: `emb_conn_${roomId}_${i}`,
      from: a.instanceId,
      to: b.instanceId,
      kind: c.kind,
    }];
  });

  return {
    materials: resolvedMaterials,
    placedItems,
    windows,
    doorStyle: embedded.doorStyle,
    doorWall: embedded.doorWall,
    doorPos,
    doorLen,
    exteriorDecor,
    connections,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1: 北欧轻奢
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_NORDIC: StyleTemplate = {
  id: "nordic",
  name: "北欧轻奢",
  nameEn: "Nordic Luxe",
  emoji: "❄️",
  description: "白墙橡木，极简留白，光影为主角",
  descriptionEn: "White walls, oak floors, minimalist light & shadow",
  accent: "#C8A882",
  styleTag: "北欧",
  rooms: {
    living: {
      materialIds: { wall: "wall-white", floor: "floor-oak", light: "light-linear-pendant" },
      furnitureIds: ["sofa-nordic-blue","coffee-oak-round","tvunit-float-white","lamp-arc-gold","rug-nordic-geo","plant-monstera","artwork-impression","decor-books-pile","decor-tulip","decor-pillows"],
    },
    master: {
      materialIds: { wall: "wall-beige", floor: "floor-oak", light: "light-linear-pendant" },
      furnitureIds: ["bed-fabric-beige","nightstand-white","nightstand-white","wardrobe-slide-white","plant-sansevieria"],
    },
    bedroom: {
      materialIds: { wall: "wall-beige", floor: "floor-oak" },
      furnitureIds: ["bed-single-white","nightstand-white","bookshelf-open-white"],
    },
    dining: {
      materialIds: { wall: "wall-white", floor: "floor-oak", light: "light-linear-pendant" },
      furnitureIds: ["dining-oak-rect","chair-nordic-oak","chair-nordic-oak","chair-nordic-oak","chair-nordic-oak","plant-rubber-tree"],
    },
    kitchen: {
      materialIds: { wall: "wall-tile-metro", floor: "floor-white-tile" },
      furnitureIds: ["cabinet-lower-white","cabinet-upper-white","fridge-french-door","sink-double-steel","hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-tile-metro", floor: "floor-white-tile" },
      furnitureIds: ["toilet-smart","vanity-single-white","shower-enclosed"],
    },
    study: {
      materialIds: { wall: "wall-white", floor: "floor-oak" },
      furnitureIds: ["desk-nordic-oak","chair-ergonomic","bookshelf-open-white"],
    },
    closet: {
      materialIds: { wall: "wall-white", floor: "floor-oak" },
      furnitureIds: ["wardrobe-open-rack","closet-system-white"],
    },
  },
  embeddedRooms: {
    living: {
      baseW: 500, baseD: 420,
      materialIds: { wall:"wall-white", floor:"floor-oak", light:"light-linear-pendant" },
      items: [
        { furnitureId:"tvunit-float-white", x:250, z:19,  rotation:0   },
        // Sofa 235→253 / table 140→112: the old 21cm sofa↔table gap sat
        // inside the sofa's 40cm front aisle + 10cm halo (clearance
        // warning) and 229cm TV distance was under the 250cm viewing
        // minimum. New gap 56cm, TV distance ~251cm. Door 80→70 so the
        // (width-scaled) swing zone stays clear of the sofa's south edge.
        { furnitureId:"sofa-nordic-blue",   x:250, z:258, rotation:180 },
        { furnitureId:"coffee-oak-round",   x:250, z:112, rotation:0   },
        { furnitureId:"rug-nordic-geo",     x:250, z:145, rotation:0   },
        { furnitureId:"lamp-arc-gold",      x:55,  z:215, rotation:0   },
        { furnitureId:"plant-monstera",     x:465, z:385, rotation:0   },
        { furnitureId:"curtain-modern-gray", x:485, z:200, rotation:270 },
        // 西墙挂画（北段，避开弧形灯）：原来整面西墙全空
        { furnitureId:"artwork-impression", x:5, z:100, rotation:90, elevationY:150 },
        // 茶几小件：郁金香显式抬高到台面高（30cm），尺寸校验才认它是
        // “台面件”（不写时校验把它当 31cm 高的地面障碍物，与茶几 30cm
        // 绕行区冲突）。书堆矮（≤15cm）不用写。
        { furnitureId:"decor-books-pile",   x:230, z:112, rotation:0   },
        { furnitureId:"decor-tulip",        x:272, z:112, rotation:0,   elevationY:30 },
        { furnitureId:"decor-pillows",      x:200, z:258, rotation:180, elevationY:45 },
      ],
      windows: [
        { wall:"E", pos:80, len:240, h:180, sill:90, style:"sliding" },
      ],
      doorStyle: "wood_panel",
      // Door centered on front wall so the wall lamps flank it symmetrically.
      doorWall: "S", doorPos: 210, doorLen: 70,
      exteriorDecor: [
        // Door spans u≈0.42-0.58; wall lamps safely outside that on each side.
        { furnitureId:"wall-lamp-modern", wall:"S", u:0.25, v:0.72 },
        { furnitureId:"wall-lamp-modern", wall:"S", u:0.75, v:0.72 },
        { furnitureId:"house-number",     wall:"S", u:0.5,  v:0.88 },
        { furnitureId:"light-strip-warm", wall:"S", u:0.5,  v:0.97, scaleW:1.4 },
      ],
    },
    master: {
      baseW: 400, baseD: 360,
      materialIds: { wall:"wall-beige", floor:"floor-oak", light:"light-linear-pendant" },
      items: [
        { furnitureId:"bed-fabric-beige",      x:200, z:108, rotation:0   },
        { furnitureId:"nightstand-white",      x:75,  z:20,  rotation:0   },
        { furnitureId:"nightstand-white",      x:325, z:20,  rotation:0   },
        { furnitureId:"wardrobe-slide-white",  x:200, z:328, rotation:180 },
        { furnitureId:"plant-sansevieria",     x:375, z:15,  rotation:0   },
        { furnitureId:"curtain-modern-gray",   x:385, z:180, rotation:270 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-impression", x:200, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:200, z:185, rotation:0, elevationY:50   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:323.5, rotation:0   },
      ],
      windows: [
        { wall:"E", pos:80, len:200, h:180, sill:90, style:"sliding" },
      ],
      doorStyle: "wood_panel",
      // Door moved to the east end of the south wall: the 240cm wardrobe
      // on the south wall blocked the old centered door's swing zone.
      doorWall: "S", doorPos: 320, doorLen: 80,
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-beige", floor:"floor-oak" },
      items: [
        { furnitureId:"bed-single-white",     x:160, z:100, rotation:0   },
        { furnitureId:"nightstand-white",     x:265, z:20,  rotation:0   },
        { furnitureId:"bookshelf-open-white", x:15,  z:130, rotation:90  },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-impression", x:160, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:160, z:163, rotation:0, elevationY:50   },
        { furnitureId:"plant-sansevieria", x:27.5, z:271, rotation:0   },
        { furnitureId:"lamp-arc-gold", x:283.5, z:263.5, rotation:0   },
      ],
    },
    dining: {
      baseW: 380, baseD: 320,
      materialIds: { wall:"wall-white", floor:"floor-oak", light:"light-linear-pendant" },
      items: [
        { furnitureId:"dining-oak-rect",  x:190, z:155, rotation:0   },
        { furnitureId:"chair-nordic-oak", x:190, z:68,  rotation:0   },
        { furnitureId:"chair-nordic-oak", x:190, z:242, rotation:180 },
        { furnitureId:"chair-nordic-oak", x:103, z:155, rotation:90  },
        { furnitureId:"chair-nordic-oak", x:277, z:155, rotation:270 },
        { furnitureId:"plant-rubber-tree",x:350, z:25,  rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-vase-set", x:190, z:155, rotation:0, elevationY:75   },
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materialIds: { wall:"wall-tile-metro", floor:"floor-white-tile" },
      items: [
        // 0-4: appliances
        { furnitureId:"cabinet-lower-white", x:65,  z:28, rotation:0 },
        { furnitureId:"cabinet-upper-white", x:65,  z:17, rotation:0 },
        { furnitureId:"sink-double-steel",   x:80,  z:22, rotation:0 },
        { furnitureId:"hood-side-black",     x:200, z:16, rotation:0, elevationY:147 },
        { furnitureId:"fridge-french-door",  x:370, z:150, rotation:270 },
        // 5-12: water/electrical points
        { furnitureId:"water-supply-cold",   x:65,  z:8,  rotation:0 },  // 5
        { furnitureId:"water-supply-hot",    x:95,  z:8,  rotation:0 },  // 6
        { furnitureId:"drain-point",         x:80,  z:50, rotation:0 },  // 7
        { furnitureId:"exhaust-vent",        x:210, z:8,  rotation:0, elevationY:150 },  // 8
        { furnitureId:"outlet-2pin",         x:240, z:80, rotation:0 },  // 9 (counter outlet)
        { furnitureId:"outlet-2pin",         x:280, z:8,  rotation:0 },  // 10 (fridge outlet)
        { furnitureId:"breaker-panel",       x:330, z:250, rotation:0 }, // 11 (panel)
        { furnitureId:"switch-single",       x:30,  z:260, rotation:0 }, // 12 (entry switch)
      ],
      // Window moved to the east end of the north wall (was: the sample's
      // centered N window, x 80-320): the range hood hangs on this wall
      // at y 147-207cm, directly in front of that window — a hood in
      // front of a window blocks light and looks wrong. Same sill/height
      // as the sample window, just clear of the hood + vent.
      windows: [
        { wall:"N", pos:270, len:90, h:100, sill:100, style:"sliding" },
      ],
      connections: [
        // Water supply to sink
        { from: 5, to: 2, kind: "cold-water" },
        { from: 6, to: 2, kind: "hot-water" },
        // Sink → drain
        { from: 2, to: 7, kind: "drain" },
        // Wires from breaker to all outlets + range hood + lights
        { from: 11, to: 9,  kind: "wire" },
        { from: 11, to: 10, kind: "wire" },
        { from: 11, to: 12, kind: "wire" },
        { from: 11, to: 3,  kind: "wire" },  // panel → range hood
        { from: 11, to: 8,  kind: "wire" },  // panel → exhaust vent
      ],
    },
    bathroom: {
      baseW: 260, baseD: 220,
      materialIds: { wall:"wall-tile-metro", floor:"floor-white-tile" },
      items: [
        // 0-2: fixtures — shower moved north (165→135): it blocked the
        // south door's swing zone and its 60cm front aisle poked past
        // the south wall.
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-smart",        x:220, z:28,  rotation:0 },
        { furnitureId:"shower-enclosed",     x:80,  z:135, rotation:0 },
        // 3-10: water/electrical
        { furnitureId:"water-supply-cold",   x:25,  z:8,   rotation:0 }, // 3 (vanity cold)
        { furnitureId:"water-supply-hot",    x:55,  z:8,   rotation:0 }, // 4 (vanity hot)
        { furnitureId:"water-supply-cold",   x:215, z:8,   rotation:0 }, // 5 (toilet cold)
        { furnitureId:"water-supply-cold",   x:80,  z:155, rotation:0 }, // 6 (shower cold)
        { furnitureId:"water-supply-hot",    x:120, z:155, rotation:0 }, // 7 (shower hot)
        { furnitureId:"floor-drain",         x:130, z:200, rotation:0 }, // 8
        { furnitureId:"outlet-2pin",         x:90,  z:8,   rotation:0 }, // 9 (vanity outlet)
        { furnitureId:"switch-single",       x:230, z:200, rotation:0 }, // 10 (door switch)
      ],
      connections: [
        // Vanity water
        { from: 3, to: 0, kind: "cold-water" },
        { from: 4, to: 0, kind: "hot-water" },
        // Toilet
        { from: 5, to: 1, kind: "cold-water" },
        // Shower
        { from: 6, to: 2, kind: "cold-water" },
        { from: 7, to: 2, kind: "hot-water" },
        // Floor drain — visual marker; technically receives drain from
        // shower + vanity overflow but kept simple as a single endpoint
        { from: 2, to: 8, kind: "drain" },
        { from: 0, to: 8, kind: "drain" },
        // Wiring
        { from: 10, to: 9, kind: "wire" },
      ],
    },
    study: {
      baseW: 320, baseD: 290,
      materialIds: { wall:"wall-white", floor:"floor-oak" },
      items: [
        { furnitureId:"desk-nordic-oak",      x:160, z:33,  rotation:0   },
        { furnitureId:"chair-ergonomic",      x:160, z:128, rotation:180 },
        { furnitureId:"bookshelf-open-white", x:15,  z:130, rotation:90  },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-books-pile", x:120, z:33, rotation:0, elevationY:44   },
        { furnitureId:"lamp-arc-gold", x:283.5, z:253.5, rotation:0   },
      ],
    },
    closet: {
      baseW: 300, baseD: 240,
      materialIds: { wall:"wall-white", floor:"floor-oak" },
      items: [
        { furnitureId:"wardrobe-open-rack",   x:60,  z:30, rotation:0 },
        { furnitureId:"closet-system-white",  x:215, z:30, rotation:0 },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 2: 轻奢现代
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_LUXURY: StyleTemplate = {
  id: "luxury",
  name: "轻奢现代",
  nameEn: "Light Luxury",
  emoji: "✨",
  description: "胡桃深木，大理石元素，精致生活感",
  descriptionEn: "Walnut tones, marble accents, refined living",
  accent: "#6B4423",
  styleTag: "轻奢",
  rooms: {
    living: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["sofa-leather-brown","coffee-marble-rect","tvunit-walnut","rug-persian","lamp-arc-gold","artwork-abstract","artwork-vermeer","decor-vase-set","decor-books-pile","decor-tulip","decor-pillows"],
    },
    master: {
      materialIds: { wall: "wall-warm-pink", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["bed-leather-dark","nightstand-oak","nightstand-oak","wardrobe-solid-walnut","dresser-nordic-white"],
    },
    bedroom: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut" },
      furnitureIds: ["bed-fabric-beige","nightstand-white","wardrobe-slide-white"],
    },
    dining: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["dining-marble-round","chair-modern-gray","chair-modern-gray","chair-modern-gray","chair-modern-gray"],
    },
    kitchen: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["cabinet-lower-gray","cabinet-upper-white","fridge-french-door","sink-double-steel","hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["toilet-wallhung","vanity-double-marble","bathtub-freestanding"],
    },
    study: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut" },
      furnitureIds: ["desk-l-shape-white","chair-ergonomic","bookshelf-solid-walnut"],
    },
  },
  // ── Hand-crafted layouts (from demo-plan.json) ────────────────────────────
  embeddedRooms: {
    living: {
      baseW: 500, baseD: 420,
      materials: {
        wall:  { id:"wall-beige",        name:"温柔奶茶色",    brand:"进口乳胶漆",   price:42,  unit:"元/㎡", category:"wall",  color:"#E8D5B7", tags:["北欧","轻奢","日式"],   description:"温暖奶茶色调" },
        floor: { id:"floor-herringbone", name:"鱼骨纹拼花地板",brand:"强化复合地板", price:450, unit:"元/㎡", category:"floor", color:"#B89060", texture:"repeating-linear-gradient(45deg,#B89060 0px,#B89060 10px,#C8A882 10px,#C8A882 20px)", tags:["轻奢","现代"], description:"经典鱼骨纹" },
        light: { id:"light-spot",        name:"无主灯轨道射灯",brand:"LED轨道灯",   price:180, unit:"元/个", category:"light", color:"#FFD700", tags:["现代","轻奢"],          description:"无主灯方案" },
      },
      items: [
        { furnitureId:"tvunit-float-white", x:250, z:19,  rotation:0   },
        { furnitureId:"sofa-nordic-blue",   x:250, z:258, rotation:180 },
        { furnitureId:"coffee-marble-rect", x:250, z:110, rotation:0   },
        { furnitureId:"rug-nordic-geo",     x:250, z:160, rotation:0   },
        { furnitureId:"sideboard-walnut",   x:430, z:19,  rotation:0   },
        { furnitureId:"lamp-arc-gold",      x:35,  z:180, rotation:0   },
        { furnitureId:"plant-monstera",     x:467, z:387, rotation:0   },
        { furnitureId:"plant-rubber-tree",  x:33,  z:393, rotation:0   },
        // 挂画原来没给 elevationY —— 但挂画缺省就是墙高 52% 的画廊高度
        // （约 1.45m 中心高），并不在地板上；之前看不见只是被南墙门挡住。
        // 门藏起来后蒙德里安自然露出来，这里不动它。边柜上方再挂一幅
        // 维米尔肖像 + 摆花瓶组，北墙两组画形成画廊墙。
        { furnitureId:"artwork-abstract",   x:250, z:2,   rotation:0   },
        { furnitureId:"artwork-vermeer",    x:430, z:5,   rotation:0,   elevationY:150 },
        { furnitureId:"decor-vase-set",     x:430, z:19,  rotation:0,   elevationY:85 },
        // （边柜高 85cm；花瓶组显式抬高到柜顶，尺寸校验才认它是“台面件”）
        // 茶几小件：郁金香显式抬高到台面高（45cm），尺寸校验才认它是
        // “台面件”（不写时校验把它当 31cm 高的地面障碍物，与茶几 30cm
        // 绕行区冲突）。书堆矮（≤15cm）不用写。
        { furnitureId:"decor-books-pile",   x:215, z:110, rotation:0   },
        { furnitureId:"decor-tulip",        x:285, z:110, rotation:0,   elevationY:45 },
        { furnitureId:"decor-pillows",      x:200, z:258, rotation:180, elevationY:45 },
        { furnitureId:"curtain-brown-sheer", x:485, z:200, rotation:270 },
      ],
      windows: [
        { wall:"E", pos:60, len:280, h:200, sill:60, style:"fixed" },
      ],
      doorStyle: "french_double",
      doorWall: "S", doorPos: 210, doorLen: 70,
      exteriorDecor: [
        // Door spans u≈0.42-0.58. Mural placed well left of door.
        { furnitureId:"mural-great-wave", wall:"S", u:0.22, v:0.55, scaleW:1.0, scaleH:1.0 },
        { furnitureId:"wall-lamp-modern", wall:"S", u:0.38, v:0.72 },
        { furnitureId:"wall-lamp-modern", wall:"S", u:0.62, v:0.72 },
        { furnitureId:"nameplate-family", wall:"S", u:0.78, v:0.82 },
        { furnitureId:"light-strip-rgb",  wall:"S", u:0.5,  v:0.95, scaleW:1.5 },
      ],
    },
    master: {
      baseW: 400, baseD: 360,
      materials: {
        wall:  { id:"wall-warm-pink",    name:"莫兰迪粉",      brand:"进口乳胶漆",   price:42,  unit:"元/㎡", category:"wall",  color:"#D4A8A8", tags:["北欧","轻奢"],  description:"温柔莫兰迪" },
        floor: { id:"floor-herringbone", name:"鱼骨纹拼花地板",brand:"强化复合地板", price:450, unit:"元/㎡", category:"floor", color:"#B89060", texture:"repeating-linear-gradient(45deg,#B89060 0px,#B89060 10px,#C8A882 10px,#C8A882 20px)", tags:["轻奢","现代"], description:"经典鱼骨纹" },
        light: { id:"light-spot",        name:"无主灯轨道射灯",brand:"LED轨道灯",   price:180, unit:"元/个", category:"light", color:"#FFD700", tags:["现代","轻奢"],  description:"无主灯方案" },
      },
      items: [
        { furnitureId:"bed-fabric-beige",      x:200, z:110, rotation:0   },
        { furnitureId:"nightstand-oak",        x:75,  z:21,  rotation:0   },
        { furnitureId:"nightstand-oak",        x:325, z:21,  rotation:0   },
        { furnitureId:"wardrobe-solid-walnut", x:90, z:330, rotation:180 },
        { furnitureId:"dresser-nordic-white",  x:372, z:130, rotation:270 },
        { furnitureId:"rug-modern-gray",       x:200, z:165, rotation:0   },
        { furnitureId:"lamp-arc-gold",         x:28,  z:180, rotation:0   },
        { furnitureId:"plant-sansevieria",     x:382, z:15,  rotation:0   },
        { furnitureId:"artwork-abstract",      x:200, z:2,   rotation:0   },
        { furnitureId:"curtain-brown-sheer",   x:385, z:170, rotation:270 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-blanket", x:200, z:187, rotation:0, elevationY:50   },
      ],
      windows: [
        { wall:"E", pos:60, len:220, h:200, sill:60, style:"fixed" },
      ],
      doorStyle: "french_double",
      doorWall: "S", doorPos: 160, doorLen: 80,
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materials: {
        wall:  { id:"wall-sage",   name:"莫兰迪绿",    brand:"进口乳胶漆", price:45,  unit:"元/㎡", category:"wall",  color:"#8FAF8F", tags:["北欧","日式"], description:"低饱和绿" },
        floor: { id:"floor-bamboo",name:"碳化竹地板", brand:"竹木地板",   price:220, unit:"元/㎡", category:"floor", color:"#A0874A", tags:["日式","中式"], description:"环保竹材" },
        light: { id:"light-spot",  name:"无主灯轨道射灯",brand:"LED轨道灯",price:180,unit:"元/个", category:"light", color:"#FFD700", tags:["现代","轻奢"], description:"无主灯方案" },
      },
      items: [
        { furnitureId:"bed-wood-nordic",      x:160, z:105, rotation:0   },
        { furnitureId:"nightstand-white",     x:35,  z:20,  rotation:0   },
        { furnitureId:"nightstand-white",     x:285, z:20,  rotation:0   },
        { furnitureId:"wardrobe-slide-white", x:200, z:270, rotation:180 },
        // Desk/chair/bookshelf removed (2026-11-20): a 400x450 room cannot hold
        // bed + 240cm wardrobe + a desk set under the 60cm bed halo and the
        // 75cm wardrobe front aisle (13 clearance violations). The template's
        // declared furnitureIds already list only bed/nightstand/wardrobe.
        { furnitureId:"plant-sansevieria",    x:15,  z:15,  rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-vermeer", x:160, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:160, z:179, rotation:0, elevationY:50   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:263.5, rotation:0   },
      ],
    },
    dining: {
      baseW: 380, baseD: 320,
      materials: {
        wall:  { id:"wall-beige",      name:"温柔奶茶色", brand:"进口乳胶漆",  price:42,  unit:"元/㎡", category:"wall",  color:"#E8D5B7", tags:["北欧","轻奢","日式"], description:"温暖奶茶色调" },
        floor: { id:"floor-oak",       name:"橡木原色地板",brand:"强化复合地板",price:280, unit:"元/㎡", category:"floor", color:"#C8A882", tags:["北欧","日式","现代"], description:"天然橡木" },
        light: { id:"light-chandelier",name:"水晶吊灯",   brand:"水晶吊灯",   price:3200,unit:"元/件", category:"light", color:"#FFFACD", tags:["轻奢","中式"],        description:"水晶折射" },
      },
      items: [
        { furnitureId:"dining-marble-round", x:190, z:150, rotation:0   },
        { furnitureId:"chair-nordic-oak",    x:190, z:62,  rotation:0   },
        { furnitureId:"chair-nordic-oak",    x:190, z:238, rotation:180 },
        { furnitureId:"chair-nordic-oak",    x:108, z:120, rotation:90  },
        { furnitureId:"chair-nordic-oak",    x:272, z:120, rotation:270 },
        { furnitureId:"chair-nordic-oak",    x:108, z:170, rotation:90  },
        { furnitureId:"chair-nordic-oak",    x:272, z:170, rotation:270 },
        { furnitureId:"sideboard-walnut",    x:60,  z:19,  rotation:0   },
        { furnitureId:"plant-rubber-tree",   x:343, z:27,  rotation:0   },
        { furnitureId:"artwork-abstract",    x:190, z:2,   rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-vase-set", x:190, z:150, rotation:0, elevationY:75   },
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materials: {
        wall:  { id:"wall-tile-metro", name:"地铁砖",      brand:"全抛釉砖",   price:95,  unit:"元/㎡", category:"wall",  color:"#FAFAFA", texture:"repeating-linear-gradient(0deg,#E0E0E0 0px,#E0E0E0 1px,#FAFAFA 1px,#FAFAFA 8px)", tags:["现代","工业风"], description:"经典白色地铁砖" },
        floor: { id:"floor-white-tile",name:"白色抛光砖", brand:"全抛釉砖",   price:150, unit:"元/㎡", category:"floor", color:"#F0EFEB", tags:["现代","北欧"],   description:"大块白砖" },
        light: { id:"light-spot",      name:"无主灯轨道射灯",brand:"LED轨道灯",price:180,unit:"元/个", category:"light", color:"#FFD700", tags:["现代","轻奢"],   description:"无主灯方案" },
      },
      items: [
        { furnitureId:"cabinet-lower-gray",  x:130, z:30,  rotation:0 },
        { furnitureId:"fridge-french-door",  x:370, z:150, rotation:270 },
        { furnitureId:"sink-double-steel",   x:80,  z:22,  rotation:0 },
        { furnitureId:"hood-side-black",     x:200, z:26,  rotation:0, elevationY:147 },
        { furnitureId:"cabinet-upper-white", x:60,  z:17,  rotation:0 },
        { furnitureId:"plant-sansevieria",   x:335, z:250, rotation:0 },
      ],
      // Window moved to the east end of the north wall (see nordic
      // kitchen): the range hood hangs on this wall in front of the
      // sample's centered window.
      windows: [
        { wall:"N", pos:270, len:90, h:100, sill:100, style:"sliding" },
      ],
    },
    bathroom: {
      baseW: 260, baseD: 220,
      materials: {
        wall:  { id:"wall-tile-white", name:"白色大理石纹砖",brand:"釉面砖",   price:180, unit:"元/㎡", category:"wall",  color:"#EFEFEF", texture:"repeating-linear-gradient(45deg,#e0e0e0 0px,#e0e0e0 1px,#EFEFEF 0px,#EFEFEF 50%)", tags:["轻奢","现代"], description:"天然大理石纹" },
        floor: { id:"floor-hex-white", name:"白色六角砖",    brand:"全抛釉砖", price:180, unit:"元/㎡", category:"floor", color:"#F5F5F5", texture:"repeating-linear-gradient(30deg,#E0E0E0 0,#E0E0E0 1px,#F5F5F5 0,#F5F5F5 50%)", tags:["现代","北欧"], description:"六角砖首选" },
        light: { id:"light-spot",      name:"无主灯轨道射灯",brand:"LED轨道灯",price:180, unit:"元/个", category:"light", color:"#FFD700", tags:["现代","轻奢"], description:"无主灯方案" },
      },
      items: [
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-wallhung",     x:220, z:27,  rotation:0 },
        { furnitureId:"shower-walkin",       x:90,  z:135, rotation:0 },
        { furnitureId:"plant-sansevieria",   x:240, z:190, rotation:0 },
      ],
    },
    study: {
      baseW: 320, baseD: 290,
      materials: {
        wall:  { id:"wall-gray",   name:"高级灰墙漆",    brand:"净味乳胶漆",  price:38,  unit:"元/㎡", category:"wall",  color:"#9E9E9E", tags:["现代","工业风","轻奢"], description:"高级灰" },
        floor: { id:"floor-walnut",name:"胡桃木深色地板",brand:"实木复合地板",price:380, unit:"元/㎡", category:"floor", color:"#6B4423", tags:["轻奢","中式"],         description:"深色胡桃" },
        light: { id:"light-spot",  name:"无主灯轨道射灯",brand:"LED轨道灯",  price:180, unit:"元/个", category:"light", color:"#FFD700", tags:["现代","轻奢"],         description:"无主灯方案" },
      },
      items: [
        { furnitureId:"desk-standing",         x:160, z:36,  rotation:0   },
        { furnitureId:"chair-ergonomic",        x:160, z:140, rotation:180 },
        { furnitureId:"bookshelf-solid-walnut", x:15,  z:120, rotation:90  },
        { furnitureId:"bookshelf-open-white",   x:220, z:270, rotation:180 },
        { furnitureId:"lamp-arc-gold",          x:240, z:140, rotation:0   },
        { furnitureId:"plant-rubber-tree",      x:170, z:180, rotation:0   },
        { furnitureId:"artwork-inkwash",        x:160, z:2,   rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-books-pile", x:120, z:36, rotation:0, elevationY:65   },
      ],
    },
    balcony: {
      baseW: 420, baseD: 160,
      materials: {
        wall:  { id:"wall-white",          name:"哑光白墙漆",  brand:"水性内墙漆", price:35,  unit:"元/㎡", category:"wall",  color:"#F5F5F0", tags:["现代","北欧","日式"], description:"经典哑光白" },
        floor: { id:"floor-concrete",      name:"水泥灰地砖",  brand:"通体砖",    price:120, unit:"元/㎡", category:"floor", color:"#888888", tags:["工业风","现代"],     description:"工业水泥质感" },
        light: { id:"light-japanese-paper",name:"和纸纸质吊灯",brand:"和纸纸灯",  price:420, unit:"元/件", category:"light", color:"#FFF0C0", tags:["日式","北欧"],       description:"柔和漫射光" },
      },
      items: [
        { furnitureId:"sofa-japanese",  x:210, z:42, rotation:180 },
        { furnitureId:"plant-monstera", x:387, z:35, rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-vermeer", x:210, z:152.5, rotation:180, elevationY:150   },
        { furnitureId:"decor-pillows", x:183, z:42, rotation:180, elevationY:45   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:123.5, rotation:0   },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 3: 工业风
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_INDUSTRIAL: StyleTemplate = {
  id: "industrial",
  name: "工业复古",
  nameEn: "Industrial Loft",
  emoji: "🏭",
  description: "水泥灰地，裸黑铁艺，粗粝美学",
  descriptionEn: "Concrete floors, black metal, raw aesthetic",
  accent: "#888888",
  styleTag: "工业风",
  rooms: {
    living: {
      materialIds: { wall: "wall-gray", floor: "floor-concrete", light: "light-spot" },
      furnitureIds: ["sofa-fabric-gray","coffee-glass-black","tvunit-black-stone","lamp-industrial-black","rug-modern-gray","artwork-inkwash"],
    },
    master: {
      materialIds: { wall: "wall-gray", floor: "floor-concrete", light: "light-spot" },
      furnitureIds: ["bed-leather-dark","nightstand-oak","wardrobe-solid-walnut"],
    },
    bedroom: {
      materialIds: { wall: "wall-gray", floor: "floor-concrete" },
      furnitureIds: ["bed-single-white","nightstand-white","bookshelf-solid-walnut"],
    },
    dining: {
      materialIds: { wall: "wall-gray", floor: "floor-concrete", light: "light-spot" },
      furnitureIds: ["dining-black-metal","chair-industrial-black","chair-industrial-black","chair-industrial-black","chair-industrial-black"],
    },
    kitchen: {
      materialIds: { wall: "wall-tile-metro", floor: "floor-black-tile" },
      furnitureIds: ["cabinet-lower-gray","cabinet-upper-white","fridge-single-white","sink-double-steel","hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-gray", floor: "floor-black-tile" },
      furnitureIds: ["toilet-standard","vanity-single-white","shower-walkin"],
    },
    study: {
      materialIds: { wall: "wall-gray", floor: "floor-concrete" },
      furnitureIds: ["desk-standing","chair-ergonomic","bookshelf-solid-walnut","lamp-industrial-black"],
    },
  },
  embeddedRooms: {
    living: {
      baseW: 500, baseD: 420,
      materialIds: { wall:"wall-gray", floor:"floor-concrete", light:"light-spot" },
      items: [
        { furnitureId:"tvunit-black-stone",   x:250, z:23,  rotation:0   },
        { furnitureId:"artwork-inkwash",      x:250, z:2,   rotation:0   },
        { furnitureId:"sofa-fabric-gray",     x:250, z:275, rotation:180 }, // 电视距 252cm（≥2.5m），与茶几留 55cm 前厅；原 240cm 触发电视太近+沙发/茶几冲突
        { furnitureId:"coffee-glass-black",   x:250, z:140, rotation:0   },
        { furnitureId:"rug-modern-gray",      x:250, z:184, rotation:0   }, // 随沙发南移，居中于茶几与沙发之间
        { furnitureId:"lamp-industrial-black",x:445, z:220, rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-pillows", x:190, z:275, rotation:180, elevationY:45   }, // 随沙发南移
        { furnitureId:"decor-books-pile", x:230, z:140, rotation:0   },
        { furnitureId:"decor-tulip", x:270, z:140, rotation:0, elevationY:45   },
        { furnitureId:"plant-sansevieria", x:27.5, z:391, rotation:0   },
      ],
      windows: [
        { wall:"E", pos:100, len:200, h:150, sill:90, style:"security" },
      ],
      doorStyle: "sliding_barn",
      doorWall: "S", doorPos: 210, doorLen: 80,
      exteriorDecor: [
        // Door spans u≈0.42-0.58. AC unit well off to one side.
        { furnitureId:"ac-condenser",     wall:"S", u:0.18, v:0.55 },
        { furnitureId:"wall-lamp-modern", wall:"S", u:0.25, v:0.75 },
        { furnitureId:"wall-lamp-modern", wall:"S", u:0.75, v:0.75 },
        { furnitureId:"house-number",     wall:"S", u:0.5,  v:0.85 },
        { furnitureId:"light-strip-warm", wall:"S", u:0.5,  v:0.97, scaleW:1.4 },
      ],
    },
    master: {
      baseW: 400, baseD: 360,
      materialIds: { wall:"wall-gray", floor:"floor-concrete", light:"light-spot" },
      items: [
        { furnitureId:"bed-leather-dark",      x:200, z:108, rotation:0   },
        { furnitureId:"nightstand-oak",        x:75,  z:21,  rotation:0   },
        { furnitureId:"nightstand-oak",        x:325, z:21,  rotation:0   },
        { furnitureId:"wardrobe-solid-walnut", x:30,  z:200, rotation:90  },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-abstract", x:200, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:200, z:173, rotation:0, elevationY:50   },
        { furnitureId:"plant-sansevieria", x:372.5, z:331, rotation:0   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:323.5, rotation:0   },
      ],
      windows: [
        { wall:"E", pos:80, len:180, h:150, sill:90, style:"security" },
      ],
      doorStyle: "sliding_barn",
      doorWall: "S", doorPos: 160, doorLen: 80,
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-gray", floor:"floor-concrete" },
      items: [
        { furnitureId:"bed-single-white",       x:160, z:100, rotation:0   },
        { furnitureId:"nightstand-white",       x:265, z:20,  rotation:0   },
        { furnitureId:"bookshelf-solid-walnut", x:18,  z:150, rotation:90  },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-abstract", x:160, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:160, z:163, rotation:0, elevationY:50   },
        { furnitureId:"plant-sansevieria", x:292.5, z:271, rotation:0   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:263.5, rotation:0   },
      ],
    },
    dining: {
      baseW: 380, baseD: 320,
      materialIds: { wall:"wall-gray", floor:"floor-concrete", light:"light-spot" },
      items: [
        { furnitureId:"dining-black-metal",      x:190, z:155, rotation:0   },
        { furnitureId:"chair-industrial-black",  x:190, z:68,  rotation:0   },
        { furnitureId:"chair-industrial-black",  x:190, z:242, rotation:180 },
        { furnitureId:"chair-industrial-black",  x:103, z:155, rotation:90  },
        { furnitureId:"chair-industrial-black",  x:277, z:155, rotation:270 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-vase-set", x:190, z:155, rotation:0, elevationY:75   },
        { furnitureId:"plant-sansevieria", x:27.5, z:291, rotation:0   },
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materialIds: { wall:"wall-tile-metro", floor:"floor-black-tile" },
      items: [
        { furnitureId:"cabinet-lower-gray",  x:100, z:28, rotation:0 },
        { furnitureId:"cabinet-upper-white", x:75,  z:17, rotation:0 },
        { furnitureId:"sink-double-steel",   x:195, z:22, rotation:0 },
        { furnitureId:"hood-side-black",     x:195, z:16, rotation:0 },
        { furnitureId:"fridge-single-white", x:315, z:35, rotation:0 },
      ],
    },
    bathroom: {
      baseW: 260, baseD: 220,
      materialIds: { wall:"wall-gray", floor:"floor-black-tile" },
      items: [
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-standard",     x:220, z:28,  rotation:0 },
        { furnitureId:"shower-walkin",       x:90,  z:165, rotation:0 },
      ],
    },
    study: {
      baseW: 320, baseD: 290,
      materialIds: { wall:"wall-gray", floor:"floor-concrete" },
      items: [
        { furnitureId:"desk-standing",          x:160, z:38,  rotation:0   },
        { furnitureId:"chair-ergonomic",         x:160, z:140, rotation:180 },
        { furnitureId:"bookshelf-solid-walnut",  x:18,  z:130, rotation:90  },
        { furnitureId:"lamp-industrial-black",   x:295, z:155, rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-books-pile", x:120, z:38, rotation:0, elevationY:65   },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 4: 日式侘寂
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_JAPANESE: StyleTemplate = {
  id: "japanese",
  name: "日式侘寂",
  nameEn: "Japanese Wabi-sabi",
  emoji: "🍵",
  description: "竹木自然，低矮禅意，减法美学",
  descriptionEn: "Bamboo warmth, low profiles, meditative simplicity",
  accent: "#A0874A",
  styleTag: "日式",
  rooms: {
    living: {
      materialIds: { wall: "wall-beige", floor: "floor-bamboo", light: "light-japanese-paper" },
      furnitureIds: ["sofa-japanese","coffee-oak-round","plant-monstera","plant-rubber-tree","rug-nordic-geo","artwork-inkwash"],
    },
    master: {
      materialIds: { wall: "wall-sage", floor: "floor-bamboo" },
      furnitureIds: ["bed-tatami","nightstand-oak","wardrobe-solid-walnut","plant-sansevieria"],
    },
    bedroom: {
      materialIds: { wall: "wall-beige", floor: "floor-bamboo" },
      furnitureIds: ["bed-tatami","nightstand-oak"],
    },
    dining: {
      materialIds: { wall: "wall-beige", floor: "floor-bamboo" },
      furnitureIds: ["dining-oak-rect","chair-nordic-oak","chair-nordic-oak","chair-nordic-oak","chair-nordic-oak","plant-rubber-tree"],
    },
    kitchen: {
      materialIds: { wall: "wall-wood-panel", floor: "floor-bamboo" },
      furnitureIds: ["cabinet-lower-white","sink-double-steel","fridge-single-white","hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-tile-white", floor: "floor-bamboo" },
      furnitureIds: ["toilet-standard","vanity-single-white","bathtub-builtin"],
    },
    study: {
      materialIds: { wall: "wall-sage", floor: "floor-bamboo" },
      furnitureIds: ["desk-nordic-oak","chair-simple-fabric","plant-monstera"],
    },
  },
  embeddedRooms: {
    living: {
      baseW: 500, baseD: 420,
      materialIds: { wall:"wall-beige", floor:"floor-bamboo", light:"light-japanese-paper" },
      items: [
        { furnitureId:"sofa-japanese",    x:250, z:235, rotation:180 },
        { furnitureId:"coffee-oak-round", x:250, z:115, rotation:0   }, // 北移 33cm：与榻榻米沙发留 61cm 前厅（原 28cm 冲突）
        { furnitureId:"rug-nordic-geo",   x:250, z:155, rotation:0   }, // 随茶几北移，居中于茶几与沙发之间
        { furnitureId:"artwork-inkwash",  x:250, z:2,   rotation:0   },
        { furnitureId:"plant-monstera",   x:40,  z:390, rotation:0   },
        { furnitureId:"plant-rubber-tree",x:465, z:390, rotation:0   },
        { furnitureId:"curtain-modern-gray", x:485, z:200, rotation:270 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-pillows", x:223, z:235, rotation:180, elevationY:45   },
        { furnitureId:"decor-books-pile", x:225, z:115, rotation:0   }, // 随茶几北移
        { furnitureId:"decor-tulip", x:275, z:115, rotation:0, elevationY:30   }, // 随茶几北移
        { furnitureId:"lamp-arc-gold", x:36.5, z:36.5, rotation:0   },
      ],
      windows: [
        { wall:"E", pos:80, len:240, h:180, sill:50, style:"wooden" },
        { wall:"N",  pos:50, len:120, h:100, sill:120, style:"louvered" },
      ],
      doorStyle: "shoji_slide",
      doorWall: "S", doorPos: 210, doorLen: 80,
      exteriorDecor: [
        // Lanterns flank centered door at u=0.5.
        { furnitureId:"wall-lamp-lantern", wall:"S", u:0.28, v:0.7 },
        { furnitureId:"wall-lamp-lantern", wall:"S", u:0.72, v:0.7 },
        { furnitureId:"nameplate-family",  wall:"S", u:0.5,  v:0.86 },
        { furnitureId:"border-meander",    wall:"S", u:0.5,  v:0.96, scaleW:1.6 },
      ],
    },
    master: {
      baseW: 400, baseD: 360,
      materialIds: { wall:"wall-sage", floor:"floor-bamboo" },
      items: [
        { furnitureId:"bed-tatami",            x:200, z:110, rotation:0   },
        { furnitureId:"nightstand-oak",        x:320, z:21,  rotation:0   },
        { furnitureId:"wardrobe-solid-walnut", x:30,  z:200, rotation:90  },
        { furnitureId:"plant-sansevieria",     x:375, z:15,  rotation:0   },
        { furnitureId:"curtain-modern-gray",   x:385, z:180, rotation:270 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-hokusai", x:200, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:200, z:184, rotation:0, elevationY:50   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:36.5, rotation:0   },
      ],
      windows: [
        { wall:"E", pos:80, len:200, h:180, sill:50, style:"wooden" },
      ],
      doorStyle: "shoji_slide",
      doorWall: "S", doorPos: 160, doorLen: 80,
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-beige", floor:"floor-bamboo" },
      items: [
        { furnitureId:"bed-tatami",    x:160, z:110, rotation:0 },
        { furnitureId:"nightstand-oak",x:275, z:21,  rotation:0 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-hokusai", x:160, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:160, z:184, rotation:0, elevationY:50   },
        { furnitureId:"plant-sansevieria", x:27.5, z:271, rotation:0   },
        { furnitureId:"lamp-arc-gold", x:283.5, z:263.5, rotation:0   },
      ],
    },
    dining: {
      baseW: 380, baseD: 320,
      materialIds: { wall:"wall-beige", floor:"floor-bamboo" },
      items: [
        { furnitureId:"dining-oak-rect",  x:190, z:155, rotation:0   },
        { furnitureId:"chair-nordic-oak", x:190, z:68,  rotation:0   },
        { furnitureId:"chair-nordic-oak", x:190, z:242, rotation:180 },
        { furnitureId:"chair-nordic-oak", x:103, z:155, rotation:90  },
        { furnitureId:"chair-nordic-oak", x:277, z:155, rotation:270 },
        { furnitureId:"plant-rubber-tree",x:350, z:25,  rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-tea-set", x:190, z:155, rotation:0, elevationY:75   },
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materialIds: { wall:"wall-wood-panel", floor:"floor-bamboo" },
      items: [
        { furnitureId:"cabinet-lower-white", x:80,  z:28, rotation:0 },
        { furnitureId:"sink-double-steel",   x:80, z:22, rotation:0 },
        { furnitureId:"hood-side-black",     x:195, z:16, rotation:0, elevationY:147 },
        { furnitureId:"fridge-single-white", x:370, z:150, rotation:270 },
      ],
    },
    bathroom: {
      baseW: 260, baseD: 220,
      materialIds: { wall:"wall-tile-white", floor:"floor-bamboo" },
      items: [
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-standard",     x:220, z:28,  rotation:0 },
        { furnitureId:"bathtub-builtin",     x:90,  z:130, rotation:0 },
      ],
    },
    study: {
      baseW: 320, baseD: 290,
      materialIds: { wall:"wall-sage", floor:"floor-bamboo" },
      items: [
        { furnitureId:"desk-nordic-oak",    x:160, z:33,  rotation:0   },
        { furnitureId:"chair-simple-fabric",x:160, z:120, rotation:180 },
        { furnitureId:"plant-monstera",     x:290, z:260, rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-books-pile", x:120, z:33, rotation:0, elevationY:44   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:253.5, rotation:0   },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 5: 新中式
// ─────────────────────────────────────────────────────────────────────────────
// 门窗（2026-11-21，doors/windows Phase B）：客厅/主卧门由法式对开玻璃门
// （french_double，假玻璃）改为隔扇门 lattice_door，窗由木窗 GLB 改为槛窗
// sill_lattice（与同屋隔扇门同格同色）。本模板由 34 个中式片场共用；
// 秦汉/唐宫/石库门等另有时代门的片场，须在 projectTemplates.ts 里用
// floorLayouts 的显式 doors 覆盖（见 BUILD-A-B.md 的跟进补丁表）：
// 秦汉/唐宫/魏晋/石库门/民国 → plank_studded，明清/宋 → lattice_door。
// 注意：floorLayouts 的显式 doors/windows（store 3.5 步）在风格模板之后
// 应用，会覆盖这里的值——例如 set-qinhan 客厅显式 wood_panel 门仍是木门，
// 直到补丁把它改成 plank_studded。
export const TEMPLATE_CHINESE: StyleTemplate = {
  id: "chinese",
  name: "新中式",
  nameEn: "Modern Chinese",
  emoji: "🏮",
  description: "胡桃深木，禅意收藏，东方意韵",
  descriptionEn: "Walnut tones, curated objects, Eastern elegance",
  accent: "#8B3A20",
  styleTag: "中式",
  rooms: {
    living: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["sofa-japanese", "coffee-oak-round", "tvunit-walnut", "rug-persian", "plant-monstera", "artwork-inkwash", "artwork-hokusai", "decor-tea-set"],
    },
    master: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut" },
      furnitureIds: ["bed-tatami", "nightstand-oak", "nightstand-oak", "wardrobe-solid-walnut", "plant-sansevieria"],
    },
    bedroom: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut" },
      furnitureIds: ["bed-fabric-beige", "nightstand-oak", "bookshelf-solid-walnut"],
    },
    dining: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["dining-marble-round", "chair-nordic-oak", "chair-nordic-oak", "chair-nordic-oak", "chair-nordic-oak", "plant-rubber-tree"],
    },
    kitchen: {
      materialIds: { wall: "wall-tile-metro", floor: "floor-white-tile" },
      furnitureIds: ["cabinet-lower-gray", "cabinet-upper-white", "fridge-single-white", "sink-double-steel", "hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["toilet-smart", "vanity-single-white", "bathtub-builtin"],
    },
    study: {
      materialIds: { wall: "wall-wood-panel", floor: "floor-walnut" },
      furnitureIds: ["desk-nordic-oak", "chair-simple-fabric", "bookshelf-solid-walnut", "plant-rubber-tree", "artwork-inkwash"],
    },
  },
  embeddedRooms: {
    living: {
      baseW: 500, baseD: 420,
      materialIds: { wall:"wall-beige", floor:"floor-walnut", light:"light-chandelier" },
      items: [
        { furnitureId:"tvunit-walnut",    x:250, z:21,  rotation:0   },
        { furnitureId:"sofa-japanese",    x:250, z:258, rotation:180 },
        { furnitureId:"coffee-oak-round", x:250, z:120, rotation:0   },
        { furnitureId:"rug-persian",      x:250, z:165, rotation:0   },
        // 水墨画原来没给 elevationY —— 但挂画缺省就是墙高 52% 的画廊高度，
        // 并不在地板上；之前看不见只是被南墙门挡住。西墙再挂一幅赤富士
        // 做一点朱红点缀。
        { furnitureId:"artwork-inkwash",  x:250, z:2,   rotation:0   },
        { furnitureId:"artwork-hokusai",  x:5,   z:200, rotation:90,  elevationY:150 },
        { furnitureId:"plant-monstera",   x:40,  z:390, rotation:0   },
        // 茶几上只放茶具一套（中式客厅的点睛物，自动落到台面）
        { furnitureId:"decor-tea-set",    x:250, z:120, rotation:0   },
        { furnitureId:"curtain-brown-sheer", x:485, z:210, rotation:270 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-pillows", x:223, z:258, rotation:180, elevationY:45   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:36.5, rotation:0   },
      ],
      windows: [
        { wall:"E", pos:80, len:260, h:200, sill:70, style:"sill_lattice" },
      ],
      doorStyle: "lattice_door",
      doorWall: "S", doorPos: 210, doorLen: 70,
      exteriorDecor: [
        // Couplets flank the centered door (u≈0.42-0.58). Inner edge of
        // couplet at u=0.35 leaves ~0.07 (35cm) margin to door.
        { furnitureId:"couplet-spring",     wall:"S", u:0.35, v:0.52, scaleH:1.1 },
        { furnitureId:"couplet-prosperity", wall:"S", u:0.65, v:0.52, scaleH:1.1 },
        { furnitureId:"wall-lamp-lantern",  wall:"S", u:0.22, v:0.72 },
        { furnitureId:"wall-lamp-lantern",  wall:"S", u:0.78, v:0.72 },
        { furnitureId:"nameplate-family",   wall:"S", u:0.5,  v:0.9 },
        { furnitureId:"mural-inkwash",      wall:"N",  u:0.5,  v:0.55 },
      ],
    },
    master: {
      baseW: 400, baseD: 360,
      materialIds: { wall:"wall-beige", floor:"floor-walnut" },
      items: [
        { furnitureId:"bed-tatami",            x:200, z:110, rotation:0   },
        { furnitureId:"nightstand-oak",        x:75,  z:21,  rotation:0   },
        { furnitureId:"nightstand-oak",        x:325, z:21,  rotation:0   },
        { furnitureId:"wardrobe-solid-walnut", x:30,  z:200, rotation:90  },
        { furnitureId:"plant-sansevieria",     x:375, z:15,  rotation:0   },
        { furnitureId:"curtain-brown-sheer",   x:385, z:180, rotation:270 },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-inkwash", x:200, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:200, z:184, rotation:0, elevationY:50   },
        { furnitureId:"lamp-arc-gold", x:36.5, z:323.5, rotation:0   },
      ],
      windows: [
        { wall:"E", pos:80, len:200, h:180, sill:70, style:"sill_lattice" },
      ],
      doorStyle: "lattice_door",
      doorWall: "S", doorPos: 160, doorLen: 80,
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-beige", floor:"floor-walnut" },
      items: [
        { furnitureId:"bed-fabric-beige",       x:160, z:108, rotation:0   },
        { furnitureId:"nightstand-oak",         x:265, z:21,  rotation:0   },
        { furnitureId:"bookshelf-solid-walnut", x:18,  z:150, rotation:90  },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"artwork-inkwash", x:160, z:7.5, rotation:0, elevationY:150   },
        { furnitureId:"decor-blanket", x:160, z:185, rotation:0, elevationY:50   },
        { furnitureId:"plant-sansevieria", x:27.5, z:271, rotation:0   },
        { furnitureId:"lamp-arc-gold", x:283.5, z:263.5, rotation:0   },
      ],
    },
    dining: {
      baseW: 380, baseD: 320,
      materialIds: { wall:"wall-beige", floor:"floor-walnut", light:"light-chandelier" },
      items: [
        { furnitureId:"dining-marble-round", x:190, z:155, rotation:0   },
        { furnitureId:"chair-nordic-oak",    x:190, z:78,  rotation:0   },
        { furnitureId:"chair-nordic-oak",    x:190, z:232, rotation:180 },
        { furnitureId:"chair-nordic-oak",    x:113, z:155, rotation:90  },
        { furnitureId:"chair-nordic-oak",    x:267, z:155, rotation:270 },
        { furnitureId:"plant-rubber-tree",   x:350, z:25,  rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-tea-set", x:190, z:155, rotation:0, elevationY:75   },
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materialIds: { wall:"wall-tile-metro", floor:"floor-white-tile" },
      items: [
        { furnitureId:"cabinet-lower-gray",  x:100, z:28, rotation:0 },
        { furnitureId:"cabinet-upper-white", x:75,  z:17, rotation:0 },
        { furnitureId:"sink-double-steel",   x:80, z:22, rotation:0 },
        { furnitureId:"hood-side-black",     x:200, z:16, rotation:0, elevationY:147 },
        { furnitureId:"fridge-single-white", x:370, z:150, rotation:270 },
      ],
      // Window moved to the east end of the north wall (see nordic
      // kitchen): the range hood hangs on this wall in front of the
      // sample's centered window.
      windows: [
        { wall:"N", pos:270, len:90, h:100, sill:100, style:"sliding" },
      ],
    },
    bathroom: {
      baseW: 260, baseD: 220,
      materialIds: { wall:"wall-tile-white", floor:"floor-white-tile" },
      items: [
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-smart",        x:220, z:28,  rotation:0 },
        { furnitureId:"bathtub-builtin",     x:90,  z:130, rotation:0 },
      ],
    },
    study: {
      baseW: 320, baseD: 290,
      materialIds: { wall:"wall-wood-panel", floor:"floor-walnut" },
      items: [
        { furnitureId:"desk-nordic-oak",        x:160, z:33,  rotation:0   },
        { furnitureId:"chair-simple-fabric",     x:160, z:120, rotation:180 },
        { furnitureId:"bookshelf-solid-walnut",  x:18,  z:130, rotation:90  },
        { furnitureId:"plant-rubber-tree",       x:290, z:260, rotation:0   },
        { furnitureId:"artwork-inkwash",         x:160, z:2,   rotation:0   },
        // ── 室内设计补配饰（2026-11-20）：画/毯/枕/摆件/植物/灯，
        //    位置由 id-design-a2.js 按空闲角落+台面高算出，已做碰撞检查。
        { furnitureId:"decor-books-pile", x:120, z:33, rotation:0, elevationY:44   },
        { furnitureId:"lamp-arc-gold", x:283.5, z:36.5, rotation:0   },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 6: 豪华现代别墅 — matches the white-render + pool villa reference
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_MODERN_VILLA: StyleTemplate = {
  id: "modern-villa",
  name: "豪华现代别墅",
  nameEn: "Luxury Modern Villa",
  emoji: "🏛",
  description: "纯白外立面，落地玻璃，泳池庭院，两层平屋顶",
  descriptionEn: "White render facade, floor-to-ceiling glass, pool courtyard, 2-storey flat roof",
  accent: "#1A1A1A",
  styleTag: "现代",
  exterior: {
    preset: "modern",
    roofStyle: "flat",
    roofColor: "#2A2A2A",
    wallMaterial: "render",
    wallColor: "#F4F2EE",
    accentColor: "#1A1A1A",
    floors: 2,
    yardPreset: "pool",
    showPerimeterFence: false,
  },
  rooms: {
    living: {
      materialIds: { wall: "wall-white", floor: "floor-oak", light: "light-chandelier" },
      furnitureIds: ["sofa-modular-gray","coffee-marble-rect","tvunit-float-white","rug-nordic-geo","lamp-arc-gold","plant-monstera","artwork-abstract","sideboard-walnut","decor-pillows","decor-books-pile","decor-tulip"],
    },
    master: {
      materialIds: { wall: "wall-white", floor: "floor-oak", light: "light-chandelier" },
      furnitureIds: ["bed-platform-white","nightstand-white","nightstand-white","wardrobe-slide-white","dresser-nordic-white","artwork-impression","decor-blanket","plant-sansevieria","lamp-arc-gold","decor-tulip"],
    },
    bedroom: {
      materialIds: { wall: "wall-white", floor: "floor-oak" },
      furnitureIds: ["bed-fabric-beige","nightstand-white","wardrobe-slide-white","artwork-impression","decor-blanket","plant-sansevieria","lamp-arc-gold","decor-tulip"],
    },
    dining: {
      materialIds: { wall: "wall-white", floor: "floor-oak", light: "light-chandelier" },
      furnitureIds: ["dining-marble-round","chair-modern-gray","chair-modern-gray","chair-modern-gray","chair-modern-gray","chair-modern-gray","chair-modern-gray","plant-sansevieria","artwork-impression","decor-vase-set"],
    },
    kitchen: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["cabinet-lower-white","cabinet-upper-white","fridge-french-door","sink-double-steel","hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["toilet-wallhung","vanity-double-marble","bathtub-freestanding"],
    },
    study: {
      materialIds: { wall: "wall-white", floor: "floor-oak" },
      furnitureIds: ["desk-l-shape-white","chair-ergonomic","bookshelf-solid-walnut","lamp-arc-gold","plant-sansevieria","artwork-impression","decor-books-pile"],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 7: 白墙胡桃木别墅 — ref 2 style: white render + prominent walnut soffit
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_WALNUT_VILLA: StyleTemplate = {
  id: "walnut-villa",
  name: "白墙木底板别墅",
  nameEn: "White Wall + Walnut Soffit Villa",
  emoji: "🏡",
  description: "纯白外墙+胡桃木深挑底板，超大落地玻璃，石材铺地泳池",
  descriptionEn: "White render + walnut soffit overhang, floor-to-ceiling glass, travertine pool deck",
  accent: "#6B3E1A",
  styleTag: "现代",
  exterior: {
    preset: "modern",
    roofStyle: "flat",
    roofColor: "#1E1E1E",
    wallMaterial: "render",
    wallColor: "#F6F4F0",
    accentColor: "#1C1C1C",
    floors: 2,
    yardPreset: "pool",
    showPerimeterFence: false,
  },
  rooms: {
    living: {
      materialIds: { wall: "wall-white", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["sofa-modular-gray","coffee-marble-rect","tvunit-float-white","rug-nordic-geo","lamp-arc-gold","plant-monstera","artwork-abstract","sideboard-walnut","decor-pillows","decor-books-pile","decor-tulip"],
    },
    master: {
      materialIds: { wall: "wall-white", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["bed-platform-white","nightstand-white","nightstand-white","wardrobe-slide-white","dresser-nordic-white","artwork-impression","decor-blanket","plant-sansevieria","lamp-arc-gold","decor-tulip"],
    },
    bedroom: {
      materialIds: { wall: "wall-white", floor: "floor-walnut" },
      furnitureIds: ["bed-fabric-beige","nightstand-white","wardrobe-slide-white","artwork-impression","decor-blanket","plant-sansevieria","lamp-arc-gold","decor-tulip"],
    },
    dining: {
      materialIds: { wall: "wall-white", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["dining-marble-round","chair-modern-gray","chair-modern-gray","chair-modern-gray","chair-modern-gray","plant-sansevieria","artwork-impression","decor-vase-set"],
    },
    kitchen: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["cabinet-lower-white","cabinet-upper-white","fridge-french-door","sink-double-steel","hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["toilet-wallhung","vanity-double-marble","bathtub-freestanding"],
    },
    study: {
      materialIds: { wall: "wall-white", floor: "floor-walnut" },
      furnitureIds: ["desk-l-shape-white","chair-ergonomic","bookshelf-solid-walnut","lamp-arc-gold","plant-sansevieria","artwork-impression","decor-books-pile"],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 8: 石材+木板别墅 — ref 3 style: gray stone cladding + orange wood soffit
// ─────────────────────────────────────────────────────────────────────────────
export const TEMPLATE_STONE_VILLA: StyleTemplate = {
  id: "stone-villa",
  name: "石材+木板现代别墅",
  nameEn: "Stone Cladding + Wood Soffit Villa",
  emoji: "🪨",
  description: "灰色石材外墙+橙木挑板，落地玻璃，大草坪+泳池",
  descriptionEn: "Gray stone cladding + warm wood soffit, floor-to-ceiling glass, lawn + pool courtyard",
  accent: "#4A5568",
  styleTag: "现代",
  exterior: {
    preset: "modern",
    roofStyle: "flat",
    roofColor: "#2C2C2C",
    wallMaterial: "stone",
    wallColor: "#7A8290",
    accentColor: "#1A1A1A",
    floors: 2,
    yardPreset: "pool",
    showPerimeterFence: false,
  },
  rooms: {
    living: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["sofa-leather-brown","coffee-marble-rect","tvunit-walnut","rug-persian","lamp-arc-gold","plant-monstera","artwork-abstract","sideboard-walnut","decor-pillows","decor-books-pile","decor-tulip"],
    },
    master: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["bed-leather-dark","nightstand-oak","nightstand-oak","wardrobe-solid-walnut","dresser-nordic-white","artwork-impression","decor-blanket","plant-sansevieria","lamp-arc-gold","decor-tulip"],
    },
    bedroom: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut" },
      furnitureIds: ["bed-fabric-beige","nightstand-white","wardrobe-slide-white","artwork-impression","decor-blanket","plant-sansevieria","lamp-arc-gold","decor-tulip"],
    },
    dining: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut", light: "light-chandelier" },
      furnitureIds: ["dining-marble-round","chair-modern-gray","chair-modern-gray","chair-modern-gray","chair-modern-gray","plant-sansevieria","artwork-impression","decor-vase-set"],
    },
    kitchen: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["cabinet-lower-gray","cabinet-upper-white","fridge-french-door","sink-double-steel","hood-side-black"],
    },
    bathroom: {
      materialIds: { wall: "wall-tile-white", floor: "floor-white-tile" },
      furnitureIds: ["toilet-wallhung","vanity-double-marble","bathtub-freestanding"],
    },
    study: {
      materialIds: { wall: "wall-beige", floor: "floor-walnut" },
      furnitureIds: ["desk-l-shape-white","chair-ergonomic","bookshelf-solid-walnut","lamp-arc-gold","plant-sansevieria","artwork-impression","decor-books-pile"],
    },
  },
};

export const ALL_TEMPLATES: StyleTemplate[] = [
  TEMPLATE_MODERN_VILLA,
  TEMPLATE_WALNUT_VILLA,
  TEMPLATE_STONE_VILLA,
  TEMPLATE_NORDIC,
  TEMPLATE_LUXURY,
  TEMPLATE_INDUSTRIAL,
  TEMPLATE_JAPANESE,
  TEMPLATE_CHINESE,
];

// ── Build RoomState from template room spec ──────────────────────────────────
// Returns materials map + smart room-type-aware furniture placement.
//
// COORDINATE SYSTEM (floor plan, in cm):
//   x: 0 = left wall → roomW = right wall
//   z: 0 = back wall (opposite camera) → roomD = front (near camera)
//   Center = (roomW/2, roomD/2)
//
// 3D conversion: x3d = x/100 − roomW/100/2,  z3d = z/100 − roomD/100/2
// Rotation (degrees): 0=faces camera (+Z), 90=faces right (+X), 180=faces back wall (-Z), 270=faces left (-X)
// Left-wall items face room (+X) → rot=90. Right-wall items face room (-X) → rot=270.
export function buildTemplateRoomState(
  roomId: RoomType,
  tplRoom: TemplateRoom,
  roomW: number,
  roomD: number,
) {
  // ─── Materials ────────────────────────────────────────────────────────────
  const materials: Record<string, object> = {};
  for (const [cat, matId] of Object.entries(tplRoom.materialIds)) {
    const found = MATERIALS.find(m => m.id === matId);
    if (found) materials[cat] = found;
  }

  // ─── Furniture placement ──────────────────────────────────────────────────
  const placedItems: object[] = [];
  let seq = 0;

  // Effective footprint after rotation: 90/270° swaps w↔d
  function ew(item: ReturnType<typeof getFurnitureById>, rot: number) {
    return (rot % 180 !== 0) ? item!.depth : item!.width;
  }
  function ed(item: ReturnType<typeof getFurnitureById>, rot: number) {
    return (rot % 180 !== 0) ? item!.width : item!.depth;
  }

  // elevationY: explicit height above the floor (cm). Needed for tabletop
  // dressing (books / vase / tulip on a table) and for textiles on a bed or
  // sofa: the clearance checker only treats a small item as "on a table"
  // when elevationY >= 25, otherwise it flags it as a floor obstacle in the
  // carrier's clearance zone. Sofa/bed are NOT auto-climb carriers, so
  // pillows/blanket always need an explicit elevationY (seat ~45 / mattress
  // ~50). The renderer snaps an elevated small item to the carrier surface
  // below it. (Indoor-design pass 2026-11-20.)
  function place(fid: string, x: number, z: number, rotation = 0, elevationY?: number) {
    const f = getFurnitureById(fid);
    if (!f) return;
    const hw = ew(f, rotation) / 2, hd = ed(f, rotation) / 2;
    const px = Math.max(hw + 4, Math.min(roomW - hw - 4, x));
    const pz = Math.max(hd + 4, Math.min(roomD - hd - 4, z));
    placedItems.push({
      instanceId: `tpl_${roomId}_${seq++}_${fid}`,
      furnitureId: fid,
      x: px, z: pz, rotation,
      scaleW: 1, scaleD: 1,
      ...(elevationY != null ? { elevationY } : {}),
    });
  }

  // Resolve items and group by category
  const items = tplRoom.furnitureIds
    .map(id => getFurnitureById(id))
    .filter((f): f is NonNullable<typeof f> => !!f);
  const byCat = new Map<string, typeof items>();
  for (const f of items) {
    const arr = byCat.get(f.category) ?? [];
    arr.push(f);
    byCat.set(f.category, arr);
  }

  // ─── Room layouts ─────────────────────────────────────────────────────────

  if (roomId === "living") {
    // TV unit: back wall, centered, facing room (rot=0 → screen faces +z = camera)
    byCat.get("tv_unit")?.forEach(f => place(f.id, roomW / 2, f.depth / 2 + 8));

    // Rug: center area
    byCat.get("rug")?.forEach(f => place(f.id, roomW / 2, roomD * 0.50));

    // Coffee table: in front of sofa (toward TV)
    const sofa0 = byCat.get("sofa")?.[0];
    const sofaZ = roomD * 0.65;
    byCat.get("coffee_table")?.forEach(f => {
      const frontOfSofa = sofa0 ? sofaZ - sofa0.depth / 2 - f.depth / 2 - 18 : roomD * 0.42;
      place(f.id, roomW / 2, frontOfSofa);
    });

    // Sofa: center area, rotation=180 so it faces back wall (TV)
    byCat.get("sofa")?.forEach((f, i) => {
      const xOff = byCat.get("sofa")!.length > 1 ? (i === 0 ? -roomW * 0.18 : roomW * 0.18) : 0;
      place(f.id, roomW / 2 + xOff, sofaZ, 180);
    });

    // Floor lamp: beside sofa
    byCat.get("floor_lamp")?.forEach((f, i) => {
      const sw = sofa0?.width ?? 200;
      const lampX = roomW / 2 - sw / 2 - f.width / 2 - 5 + i * (sw + f.width + 10);
      place(f.id, lampX, sofaZ - 15);
    });

    // Plants: back corners
    byCat.get("plant")?.forEach((f, i) => {
      if (i === 0) place(f.id, f.width / 2 + 14, f.depth / 2 + 14);
      else         place(f.id, roomW - f.width / 2 - 14, f.depth / 2 + 14);
    });

    // Artwork: back wall (PlacedItemMesh overrides pos to back wall anyway)
    byCat.get("artwork")?.forEach(f => place(f.id, roomW / 2, f.depth / 2 + 5));

    // Sideboard: left wall, door faces room (+X) → rot=90
    byCat.get("sideboard")?.forEach(f => place(f.id, f.depth / 2 + 8, roomD / 2, 90));

    // ── Dressing (indoor-design pass 2026-11-20) ────────────────────────
    // Pillows on the sofa seat, books + tulip on the coffee table, vase on
    // the sideboard. All need an explicit elevationY = the carrier top (see
    // place() note); the two coffee-table pieces are offset ±28cm so they
    // don't stack on each other.
    {
      const coffee = byCat.get("coffee_table")?.[0];
      const coffeeZ = coffee ? (sofa0 ? sofaZ - sofa0.depth / 2 - coffee.depth / 2 - 18 : roomD * 0.42) : roomD * 0.42;
      const sideboard = byCat.get("sideboard")?.[0];
      byCat.get("decor")?.forEach(f => {
        if (f.id === "decor-pillows" && sofa0) {
          place(f.id, roomW / 2, sofaZ, 180, 45);
        } else if (f.id === "decor-books-pile" && coffee) {
          place(f.id, roomW / 2 - 28, coffeeZ, 0, coffee.height);
        } else if (f.id === "decor-tulip" && coffee) {
          place(f.id, roomW / 2 + 28, coffeeZ, 0, coffee.height);
        } else if (f.id === "decor-vase-set" && sideboard) {
          place(f.id, sideboard.depth / 2 + 8, roomD / 2, 90, sideboard.height);
        }
      });
    }

  } else if (roomId === "master" || roomId === "bedroom") {
    const bed = byCat.get("bed")?.[0];
    const bedX = roomW / 2;
    const bedZ = (bed?.depth ?? 210) / 2 + 10;

    // Bed: back wall center, headboard against wall (rot=0 so headboard is at back)
    byCat.get("bed")?.forEach(f => place(f.id, bedX, bedZ));

    // Nightstands: either side of bed
    byCat.get("nightstand")?.forEach((f, i) => {
      const bw = bed?.width ?? 180;
      const side = i % 2 === 0 ? -1 : 1;
      const nsX = bedX + side * (bw / 2 + f.width / 2 + 6);
      place(f.id, nsX, bedZ);
    });

    // Wardrobe: against left wall, door faces room (+X) → rot=90
    byCat.get("wardrobe")?.forEach((f, i) => {
      place(f.id, f.depth / 2 + 8, roomD * 0.55 + i * (f.width + 8), 90);
    });

    // Dresser: against right wall, door faces room (-X) → rot=270
    byCat.get("dresser")?.forEach(f => {
      place(f.id, roomW - f.depth / 2 - 8, roomD * 0.55, 270);
    });

    // Bookshelf: left wall, open side faces room (+X) → rot=90
    byCat.get("bookshelf")?.forEach((f, i) => {
      place(f.id, f.depth / 2 + 8, roomD * 0.3 + i * (f.width + 8), 90);
    });

    // Floor lamp + plant: front corners. Lamp goes front-RIGHT; plant goes
    // front-LEFT — they were both placed at the same front-right spot, so a
    // room with both (e.g. modern-villa master) stacked them on each other.
    // (Indoor-design pass 2026-11-20.)
    byCat.get("floor_lamp")?.forEach(f =>
      place(f.id, roomW - f.width / 2 - 14, roomD - f.depth / 2 - 14)
    );
    byCat.get("plant")?.forEach(f =>
      place(f.id, f.width / 2 + 14, roomD - f.depth / 2 - 14)
    );

    // ── Dressing (indoor-design pass 2026-11-20) ────────────────────────
    // Artwork on the back wall, centered above the bed headboard (the
    // renderer hangs artwork at gallery height by default — no elevationY
    // needed). Blanket on the mattress toward the bed foot (elevationY 50 =
    // mattress top; bed is not an auto-climb carrier). Tulip on the first
    // nightstand (elevationY = nightstand top).
    byCat.get("artwork")?.forEach(f => place(f.id, bedX, f.depth / 2 + 5));
    byCat.get("decor")?.forEach(f => {
      if (f.id === "decor-blanket" && bed) {
        place(f.id, bedX, bedZ + (bed.depth ?? 210) * 0.35, 0, 50);
      } else if (f.id === "decor-tulip") {
        const ns = byCat.get("nightstand")?.[0];
        if (ns) {
          const bw = bed?.width ?? 180;
          place(f.id, bedX - (bw / 2 + ns.width / 2 + 6), bedZ, 0, ns.height);
        }
      }
    });

  } else if (roomId === "dining") {
    const tbl = byCat.get("dining_table")?.[0];
    const tblX = roomW / 2, tblZ = roomD / 2;
    const tblW = tbl?.width ?? 160, tblD = tbl?.depth ?? 90;

    byCat.get("dining_table")?.forEach(f => place(f.id, tblX, tblZ));

    byCat.get("dining_chair")?.forEach((f, i) => {
      // 0=front (rot=180 faces table), 1=back (rot=0), 2=left side (rot=90 faces table), 3=right side (rot=270 faces table), then repeat
      const gap = 6;
      if (i === 0)      place(f.id, tblX,                             tblZ + tblD / 2 + f.depth / 2 + gap, 180);
      else if (i === 1) place(f.id, tblX,                             tblZ - tblD / 2 - f.depth / 2 - gap, 0);
      else if (i === 2) place(f.id, tblX - tblW / 2 - f.depth / 2 - gap, tblZ,                             90);
      else if (i === 3) place(f.id, tblX + tblW / 2 + f.depth / 2 + gap, tblZ,                             270);
      else {
        const side = i % 2 === 0 ? -1 : 1;
        const row  = Math.floor(i / 2) - 1;
        place(f.id, tblX + side * (tblW / 2 + f.depth / 2 + gap), tblZ + row * (tblD * 0.5), side < 0 ? 90 : 270);
      }
    });

    byCat.get("plant")?.forEach((f, i) =>
      place(f.id, i === 0 ? f.width / 2 + 14 : roomW - f.width / 2 - 14, f.depth / 2 + 14)
    );
    byCat.get("artwork")?.forEach(f => place(f.id, roomW / 2, f.depth / 2 + 5));

    // ── Dressing (indoor-design pass 2026-11-20) ────────────────────────
    // Centerpiece on the dining table (elevationY = table top).
    byCat.get("decor")?.forEach(f => {
      if ((f.id === "decor-vase-set" || f.id === "decor-tea-set") && tbl) {
        place(f.id, tblX, tblZ, 0, tbl.height);
      }
    });

  } else if (roomId === "kitchen") {
    // Cabinets (lower + upper) along back wall; fridge in corner; sink & hood near cabinets
    let cabinetZ = 8;
    byCat.get("kitchen_cabinet")?.forEach(f => {
      place(f.id, f.width / 2 + 8, f.depth / 2 + cabinetZ);
      cabinetZ += f.depth + 4;
    });
    byCat.get("kitchen_sink")?.forEach(f  => place(f.id, f.width / 2 + 8, f.depth / 2 + cabinetZ));
    // Fridge: right corner, depth against right wall, door faces room (-X) → rot=270
    byCat.get("refrigerator")?.forEach(f  => place(f.id, roomW - f.depth / 2 - 8, f.width / 2 + 8, 270));
    // Range hood: above center of cabinet run (upper wall mount — place near back wall)
    byCat.get("range_hood")?.forEach(f    => place(f.id, roomW / 2, f.depth / 2 + 10));

  } else if (roomId === "bathroom") {
    // Toilet: back-right corner
    byCat.get("toilet")?.forEach(f =>
      place(f.id, roomW - f.width / 2 - 8, f.depth / 2 + 8)
    );
    // Vanity: left wall, center
    byCat.get("bathroom_vanity")?.forEach(f =>
      place(f.id, f.width / 2 + 8, roomD / 2)
    );
    // Shower: back-left corner
    byCat.get("shower")?.forEach(f =>
      place(f.id, f.width / 2 + 8, f.depth / 2 + 8)
    );
    // Bathtub: along left wall or back wall
    byCat.get("bathtub")?.forEach(f =>
      place(f.id, f.width / 2 + 8, f.depth / 2 + 8)
    );

  } else if (roomId === "study") {
    const desk = byCat.get("desk")?.[0];
    const deskZ = (desk?.depth ?? 65) / 2 + 10;
    // Desk: back wall centered
    byCat.get("desk")?.forEach(f => place(f.id, roomW / 2, deskZ));
    // Chair: in front of desk
    byCat.get("office_chair")?.forEach(f => {
      const dz = deskZ + (desk?.depth ?? 65) / 2 + f.depth / 2 + 8;
      place(f.id, roomW / 2, dz, 180);
    });
    // Bookshelf: left wall, open side faces room (+X) → rot=90
    byCat.get("bookshelf")?.forEach((f, i) =>
      place(f.id, f.depth / 2 + 8, roomD * 0.35 + i * (f.width + 8), 90)
    );
    // Floor lamp: right corner
    byCat.get("floor_lamp")?.forEach(f =>
      place(f.id, roomW - f.width / 2 - 14, roomD * 0.70)
    );
    // Plant: front-right corner
    byCat.get("plant")?.forEach(f =>
      place(f.id, roomW - f.width / 2 - 14, roomD - f.depth / 2 - 14)
    );
    // Dining chairs repurposed as desk chair fallback
    byCat.get("dining_chair")?.forEach(f => {
      const dz = deskZ + (desk?.depth ?? 65) / 2 + f.depth / 2 + 8;
      place(f.id, roomW / 2, dz, 180);
    });

    // ── Dressing (indoor-design pass 2026-11-20) ────────────────────────
    // Artwork on the back wall above the desk; books on the desk
    // (elevationY = desk top, offset left so they sit clear of the chair).
    byCat.get("artwork")?.forEach(f => place(f.id, roomW / 2, f.depth / 2 + 5));
    byCat.get("decor")?.forEach(f => {
      if (f.id === "decor-books-pile" && desk) {
        place(f.id, roomW / 2 - 40, deskZ, 0, desk.height);
      }
    });

  } else if (roomId === "closet") {
    // Wardrobes along back wall
    let xPos = 8;
    byCat.get("wardrobe")?.forEach(f => {
      place(f.id, xPos + f.width / 2, f.depth / 2 + 8);
      xPos += f.width + 8;
    });
    byCat.get("storage")?.forEach(f => place(f.id, roomW / 2, f.depth / 2 + 8));

  } else {
    // Fallback: simple grid
    items.forEach((f, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      place(f.id, roomW * (0.25 + col * 0.25), 80 + row * 100 + f.depth / 2);
    });
  }

  return { materials, placedItems };
}
