/**
 * Style templates: one-click full room configuration
 * Each template sets materials and furniture for all enabled rooms.
 */
import { RoomType, StyleTag, WindowConfig, WindowStyle, DoorStyle, ExteriorWall, ExteriorWallDecorItem } from "./types";
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
  }>;
  /** Windows to place on this room's walls. Coordinates stay in cm
   *  relative to the room's base dimensions; loadTemplate scales them
   *  to the user's actual room size. */
  windows?: Array<{
    wall: "back" | "front" | "left" | "right";
    pos: number; len: number; h?: number; sill?: number;
    style?: WindowStyle;
  }>;
  /** Interior door visual style (e.g. wood_panel / french_double / sliding_barn). */
  doorStyle?: DoorStyle;
  /** Optional door placement overrides (wall + position + width). When
   *  set, loadTemplate moves the room's door to this location — lets
   *  templates pin the door at the center of a wall so paired decor
   *  (couplets, wall lamps, house numbers) land symmetrically. */
  doorWall?: "bottom" | "top" | "left" | "right";
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
    const hw = (f.width  * sw) / 2;
    const hd = (f.depth  * sd) / 2;
    const px = Math.max(hw + 4, Math.min(userW - hw - 4, item.x * sx));
    const pz = Math.max(hd + 4, Math.min(userD - hd - 4, item.z * sz));
    return [{
      instanceId: `emb_${roomId}_${seq++}_${item.furnitureId}`,
      furnitureId: item.furnitureId,
      x: px, z: pz,
      rotation: item.rotation,
      scaleW: sw, scaleD: sd,
    }];
  });

  // Scale windows (positions are in cm along the wall)
  const windows: WindowConfig[] = (embedded.windows ?? []).map((w, i) => {
    // For back/front walls, position scales with userW (room width)
    // For left/right walls, position scales with userD (room depth)
    const sAlong = (w.wall === "back" || w.wall === "front") ? sx : sz;
    const wallMax = (w.wall === "back" || w.wall === "front") ? userW : userD;
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

  // Door position: scale along the wall (bottom/top ~ sx, left/right ~ sz)
  const doorSide = embedded.doorWall ?? undefined;
  const doorScale = (doorSide === "left" || doorSide === "right") ? sz : sx;
  const doorPos = embedded.doorPos !== undefined ? Math.round(embedded.doorPos * doorScale) : undefined;
  const doorLen = embedded.doorLen !== undefined ? Math.round(embedded.doorLen * doorScale) : undefined;

  return {
    materials: resolvedMaterials,
    placedItems,
    windows,
    doorStyle: embedded.doorStyle,
    doorWall: embedded.doorWall,
    doorPos,
    doorLen,
    exteriorDecor,
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
      furnitureIds: ["sofa-nordic-blue","coffee-oak-round","tvunit-float-white","lamp-arc-gold","rug-nordic-geo","plant-monstera"],
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
        { furnitureId:"sofa-nordic-blue",   x:250, z:235, rotation:180 },
        { furnitureId:"coffee-oak-round",   x:250, z:140, rotation:0   },
        { furnitureId:"rug-nordic-geo",     x:250, z:165, rotation:0   },
        { furnitureId:"lamp-arc-gold",      x:55,  z:215, rotation:0   },
        { furnitureId:"plant-monstera",     x:465, z:385, rotation:0   },
        { furnitureId:"curtain-modern-gray", x:485, z:200, rotation:270 },
      ],
      windows: [
        { wall:"right", pos:80, len:240, h:180, sill:90, style:"sliding" },
      ],
      doorStyle: "wood_panel",
      // Door centered on front wall so the wall lamps flank it symmetrically.
      doorWall: "bottom", doorPos: 210, doorLen: 80,
      exteriorDecor: [
        // Door spans u≈0.42-0.58; wall lamps safely outside that on each side.
        { furnitureId:"wall-lamp-modern", wall:"front", u:0.25, v:0.72 },
        { furnitureId:"wall-lamp-modern", wall:"front", u:0.75, v:0.72 },
        { furnitureId:"house-number",     wall:"front", u:0.5,  v:0.88 },
        { furnitureId:"light-strip-warm", wall:"front", u:0.5,  v:0.97, scaleW:1.4 },
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
      ],
      windows: [
        { wall:"right", pos:80, len:200, h:180, sill:90, style:"sliding" },
      ],
      doorStyle: "wood_panel",
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-beige", floor:"floor-oak" },
      items: [
        { furnitureId:"bed-single-white",     x:160, z:100, rotation:0   },
        { furnitureId:"nightstand-white",     x:265, z:20,  rotation:0   },
        { furnitureId:"bookshelf-open-white", x:15,  z:130, rotation:90  },
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
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materialIds: { wall:"wall-tile-metro", floor:"floor-white-tile" },
      items: [
        { furnitureId:"cabinet-lower-white", x:65,  z:28, rotation:0 },
        { furnitureId:"cabinet-upper-white", x:65,  z:17, rotation:0 },
        { furnitureId:"sink-double-steel",   x:175, z:22, rotation:0 },
        { furnitureId:"hood-side-black",     x:175, z:16, rotation:0 },
        { furnitureId:"fridge-french-door",  x:310, z:35, rotation:0 },
      ],
    },
    bathroom: {
      baseW: 260, baseD: 220,
      materialIds: { wall:"wall-tile-metro", floor:"floor-white-tile" },
      items: [
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-smart",        x:220, z:28,  rotation:0 },
        { furnitureId:"shower-enclosed",     x:100, z:165, rotation:0 },
      ],
    },
    study: {
      baseW: 320, baseD: 290,
      materialIds: { wall:"wall-white", floor:"floor-oak" },
      items: [
        { furnitureId:"desk-nordic-oak",      x:160, z:33,  rotation:0   },
        { furnitureId:"chair-ergonomic",      x:160, z:128, rotation:180 },
        { furnitureId:"bookshelf-open-white", x:15,  z:130, rotation:90  },
      ],
    },
    closet: {
      baseW: 300, baseD: 240,
      materialIds: { wall:"wall-white", floor:"floor-oak" },
      items: [
        { furnitureId:"wardrobe-open-rack",   x:75,  z:30, rotation:0 },
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
      furnitureIds: ["sofa-leather-brown","coffee-marble-rect","tvunit-walnut","rug-persian","lamp-arc-gold","artwork-abstract"],
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
        { furnitureId:"sofa-nordic-blue",   x:250, z:210, rotation:180 },
        { furnitureId:"coffee-marble-rect", x:250, z:120, rotation:0   },
        { furnitureId:"rug-nordic-geo",     x:250, z:150, rotation:0   },
        { furnitureId:"sideboard-walnut",   x:430, z:19,  rotation:0   },
        { furnitureId:"lamp-arc-gold",      x:35,  z:180, rotation:0   },
        { furnitureId:"plant-monstera",     x:467, z:387, rotation:0   },
        { furnitureId:"plant-rubber-tree",  x:33,  z:393, rotation:0   },
        { furnitureId:"artwork-abstract",   x:250, z:2,   rotation:0   },
        { furnitureId:"curtain-brown-sheer", x:485, z:200, rotation:270 },
      ],
      windows: [
        { wall:"right", pos:60, len:280, h:200, sill:60, style:"fixed" },
      ],
      doorStyle: "french_double",
      doorWall: "bottom", doorPos: 210, doorLen: 80,
      exteriorDecor: [
        // Door spans u≈0.42-0.58. Mural placed well left of door.
        { furnitureId:"mural-great-wave", wall:"front", u:0.22, v:0.55, scaleW:1.0, scaleH:1.0 },
        { furnitureId:"wall-lamp-modern", wall:"front", u:0.38, v:0.72 },
        { furnitureId:"wall-lamp-modern", wall:"front", u:0.62, v:0.72 },
        { furnitureId:"nameplate-family", wall:"front", u:0.78, v:0.82 },
        { furnitureId:"light-strip-rgb",  wall:"front", u:0.5,  v:0.95, scaleW:1.5 },
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
        { furnitureId:"wardrobe-solid-walnut", x:200, z:330, rotation:180 },
        { furnitureId:"dresser-nordic-white",  x:350, z:130, rotation:270 },
        { furnitureId:"rug-modern-gray",       x:200, z:165, rotation:0   },
        { furnitureId:"lamp-arc-gold",         x:28,  z:180, rotation:0   },
        { furnitureId:"plant-sansevieria",     x:382, z:15,  rotation:0   },
        { furnitureId:"artwork-abstract",      x:200, z:2,   rotation:0   },
        { furnitureId:"curtain-brown-sheer",   x:385, z:170, rotation:270 },
      ],
      windows: [
        { wall:"right", pos:60, len:220, h:200, sill:60, style:"fixed" },
      ],
      doorStyle: "french_double",
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
        { furnitureId:"wardrobe-slide-white", x:160, z:270, rotation:180 },
        { furnitureId:"desk-nordic-oak",      x:250, z:182, rotation:270 },
        { furnitureId:"chair-ergonomic",      x:220, z:182, rotation:270 },
        { furnitureId:"bookshelf-open-white", x:50,  z:255, rotation:180 },
        { furnitureId:"plant-sansevieria",    x:15,  z:15,  rotation:0   },
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
        { furnitureId:"fridge-french-door",  x:315, z:35,  rotation:0 },
        { furnitureId:"sink-double-steel",   x:80,  z:22,  rotation:0 },
        { furnitureId:"hood-side-black",     x:175, z:26,  rotation:0 },
        { furnitureId:"cabinet-upper-white", x:60,  z:17,  rotation:0 },
        { furnitureId:"plant-sansevieria",   x:335, z:250, rotation:0 },
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
        { furnitureId:"shower-walkin",       x:90,  z:170, rotation:0 },
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
        { furnitureId:"bookshelf-open-white",   x:305, z:100, rotation:270 },
        { furnitureId:"lamp-arc-gold",          x:293, z:140, rotation:0   },
        { furnitureId:"plant-rubber-tree",      x:33,  z:262, rotation:0   },
        { furnitureId:"artwork-inkwash",        x:160, z:2,   rotation:0   },
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
        { furnitureId:"sofa-fabric-gray",     x:250, z:240, rotation:180 },
        { furnitureId:"coffee-glass-black",   x:250, z:140, rotation:0   },
        { furnitureId:"rug-modern-gray",      x:250, z:178, rotation:0   },
        { furnitureId:"lamp-industrial-black",x:445, z:220, rotation:0   },
      ],
      windows: [
        { wall:"right", pos:100, len:200, h:150, sill:90, style:"security" },
      ],
      doorStyle: "sliding_barn",
      doorWall: "bottom", doorPos: 210, doorLen: 80,
      exteriorDecor: [
        // Door spans u≈0.42-0.58. AC unit well off to one side.
        { furnitureId:"ac-condenser",     wall:"front", u:0.18, v:0.55 },
        { furnitureId:"wall-lamp-modern", wall:"front", u:0.25, v:0.75 },
        { furnitureId:"wall-lamp-modern", wall:"front", u:0.75, v:0.75 },
        { furnitureId:"house-number",     wall:"front", u:0.5,  v:0.85 },
        { furnitureId:"light-strip-warm", wall:"front", u:0.5,  v:0.97, scaleW:1.4 },
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
      ],
      windows: [
        { wall:"right", pos:80, len:180, h:150, sill:90, style:"security" },
      ],
      doorStyle: "sliding_barn",
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-gray", floor:"floor-concrete" },
      items: [
        { furnitureId:"bed-single-white",       x:160, z:100, rotation:0   },
        { furnitureId:"nightstand-white",       x:265, z:20,  rotation:0   },
        { furnitureId:"bookshelf-solid-walnut", x:18,  z:150, rotation:90  },
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
        { furnitureId:"coffee-oak-round", x:250, z:148, rotation:0   },
        { furnitureId:"rug-nordic-geo",   x:250, z:175, rotation:0   },
        { furnitureId:"artwork-inkwash",  x:250, z:2,   rotation:0   },
        { furnitureId:"plant-monstera",   x:40,  z:390, rotation:0   },
        { furnitureId:"plant-rubber-tree",x:465, z:390, rotation:0   },
        { furnitureId:"curtain-modern-gray", x:485, z:200, rotation:270 },
      ],
      windows: [
        { wall:"right", pos:80, len:240, h:180, sill:50, style:"wooden" },
        { wall:"back",  pos:50, len:120, h:100, sill:120, style:"louvered" },
      ],
      doorStyle: "sliding_barn",
      doorWall: "bottom", doorPos: 210, doorLen: 80,
      exteriorDecor: [
        // Lanterns flank centered door at u=0.5.
        { furnitureId:"wall-lamp-lantern", wall:"front", u:0.28, v:0.7 },
        { furnitureId:"wall-lamp-lantern", wall:"front", u:0.72, v:0.7 },
        { furnitureId:"nameplate-family",  wall:"front", u:0.5,  v:0.86 },
        { furnitureId:"border-meander",    wall:"front", u:0.5,  v:0.96, scaleW:1.6 },
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
      ],
      windows: [
        { wall:"right", pos:80, len:200, h:180, sill:50, style:"wooden" },
      ],
      doorStyle: "sliding_barn",
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-beige", floor:"floor-bamboo" },
      items: [
        { furnitureId:"bed-tatami",    x:160, z:110, rotation:0 },
        { furnitureId:"nightstand-oak",x:275, z:21,  rotation:0 },
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
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materialIds: { wall:"wall-wood-panel", floor:"floor-bamboo" },
      items: [
        { furnitureId:"cabinet-lower-white", x:80,  z:28, rotation:0 },
        { furnitureId:"sink-double-steel",   x:185, z:22, rotation:0 },
        { furnitureId:"hood-side-black",     x:185, z:16, rotation:0 },
        { furnitureId:"fridge-single-white", x:315, z:35, rotation:0 },
      ],
    },
    bathroom: {
      baseW: 260, baseD: 220,
      materialIds: { wall:"wall-tile-white", floor:"floor-bamboo" },
      items: [
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-standard",     x:220, z:28,  rotation:0 },
        { furnitureId:"bathtub-builtin",     x:90,  z:170, rotation:0 },
      ],
    },
    study: {
      baseW: 320, baseD: 290,
      materialIds: { wall:"wall-sage", floor:"floor-bamboo" },
      items: [
        { furnitureId:"desk-nordic-oak",    x:160, z:33,  rotation:0   },
        { furnitureId:"chair-simple-fabric",x:160, z:120, rotation:180 },
        { furnitureId:"plant-monstera",     x:290, z:260, rotation:0   },
      ],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Template 5: 新中式
// ─────────────────────────────────────────────────────────────────────────────
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
      furnitureIds: ["sofa-japanese", "coffee-oak-round", "tvunit-walnut", "rug-persian", "plant-monstera", "artwork-inkwash"],
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
        { furnitureId:"sofa-japanese",    x:250, z:235, rotation:180 },
        { furnitureId:"coffee-oak-round", x:250, z:148, rotation:0   },
        { furnitureId:"rug-persian",      x:250, z:175, rotation:0   },
        { furnitureId:"artwork-inkwash",  x:250, z:2,   rotation:0   },
        { furnitureId:"plant-monstera",   x:40,  z:390, rotation:0   },
        { furnitureId:"curtain-brown-sheer", x:485, z:210, rotation:270 },
      ],
      windows: [
        { wall:"right", pos:80, len:260, h:200, sill:70, style:"wooden" },
      ],
      doorStyle: "french_double",
      doorWall: "bottom", doorPos: 210, doorLen: 80,
      exteriorDecor: [
        // Couplets flank the centered door (u≈0.42-0.58). Inner edge of
        // couplet at u=0.35 leaves ~0.07 (35cm) margin to door.
        { furnitureId:"couplet-spring",     wall:"front", u:0.35, v:0.52, scaleH:1.1 },
        { furnitureId:"couplet-prosperity", wall:"front", u:0.65, v:0.52, scaleH:1.1 },
        { furnitureId:"wall-lamp-lantern",  wall:"front", u:0.22, v:0.72 },
        { furnitureId:"wall-lamp-lantern",  wall:"front", u:0.78, v:0.72 },
        { furnitureId:"nameplate-family",   wall:"front", u:0.5,  v:0.9 },
        { furnitureId:"mural-inkwash",      wall:"back",  u:0.5,  v:0.55 },
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
      ],
      windows: [
        { wall:"right", pos:80, len:200, h:180, sill:70, style:"wooden" },
      ],
      doorStyle: "french_double",
    },
    bedroom: {
      baseW: 320, baseD: 300,
      materialIds: { wall:"wall-beige", floor:"floor-walnut" },
      items: [
        { furnitureId:"bed-fabric-beige",       x:160, z:108, rotation:0   },
        { furnitureId:"nightstand-oak",         x:265, z:21,  rotation:0   },
        { furnitureId:"bookshelf-solid-walnut", x:18,  z:150, rotation:90  },
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
      ],
    },
    kitchen: {
      baseW: 360, baseD: 280,
      materialIds: { wall:"wall-tile-metro", floor:"floor-white-tile" },
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
      materialIds: { wall:"wall-tile-white", floor:"floor-white-tile" },
      items: [
        { furnitureId:"vanity-single-white", x:40,  z:25,  rotation:0 },
        { furnitureId:"toilet-smart",        x:220, z:28,  rotation:0 },
        { furnitureId:"bathtub-builtin",     x:90,  z:170, rotation:0 },
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
      ],
    },
  },
};

export const ALL_TEMPLATES: StyleTemplate[] = [
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

  function place(fid: string, x: number, z: number, rotation = 0) {
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

    // Floor lamp + plant: front corners
    byCat.get("floor_lamp")?.forEach(f =>
      place(f.id, roomW - f.width / 2 - 14, roomD - f.depth / 2 - 14)
    );
    byCat.get("plant")?.forEach(f =>
      place(f.id, roomW - f.width / 2 - 14, roomD - f.depth / 2 - 14)
    );

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
