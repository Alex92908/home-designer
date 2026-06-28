import type { RoomType } from "./types";

/** A piece of furniture the AI wants in a room. The model picks a `category`
 *  (one of FURNITURE_CATEGORIES, e.g. "bookshelf"); the server resolves it to a
 *  concrete furniture item. `id` is only present when echoing back an existing
 *  placed item during 增量微调 — it pins the exact item + position so manual
 *  placements survive an edit. */
export interface AiDesignFurniture {
  /** Concrete furniture id (FURNITURE[].id) — preserved across edits. */
  id?: string;
  /** Furniture category (FurnitureItem["category"]) — resolved to a real item. */
  category?: string;
  /** Position in cm within the room (x from left wall, y from back wall).
   *  Omit → server auto-places. */
  x?: number;
  y?: number;
  /** 朝向（度）。会吸附到最近的 0/90/180/270。缺省 0（正放）。 */
  rotation?: number;
  /** 宽/深/高 缩放倍数（默认 1，服务端夹在 0.2–5）。「放大点」≈1.3，「小一号」≈0.7。 */
  scaleW?: number;
  scaleD?: number;
  scaleH?: number;
  /** 离地高度 cm（默认 0=落地）。用于壁挂/悬空摆件。 */
  elevationY?: number;
  /** true=吊顶安装（吊灯/吊扇/吸顶件），忽略 elevationY、顶贴天花板。 */
  mountCeiling?: boolean;
}

/** A window the AI wants on a room wall. Server assigns the id. */
export interface AiDesignWindow {
  /** 墙向：N=北/后墙 S=南/前墙 W=西/左墙 E=东/右墙 */
  wall: "N" | "S" | "W" | "E";
  /** 沿墙起点的偏移（cm，从该墙左/上端起） */
  pos: number;
  /** 窗宽（cm，沿墙方向） */
  len: number;
  /** 窗高（cm，竖直），缺省 150 */
  h?: number;
  /** 窗台离地高（cm），缺省 90 */
  sill?: number;
  /** 多边形房间（L型/凸字）专用：窗绑定的多边形边索引。AI 一般不用自己生成，
   *  但 edit 模式回传现状时必须带上原值照抄，否则内折角墙上的窗会错位。 */
  edgeIndex?: number;
  /** 窗户款式（WindowStyle）：
   *  - "sliding"  推拉窗（默认，国内最常见）
   *  - "casement" 平开窗（单整块玻璃）
   *  - "fixed"    固定观景窗（无分隔，常用于落地窗）
   *  - "louvered" 百叶窗
   *  - "security" 防盗窗（铁艺栏栅）
   *  - "wooden"   木窗（复古/中式/乡村）
   *  缺省=推拉窗。服务端宽容解析（中文/近义词也认）。 */
  style?: string;
}

/** A door the AI wants on a room wall (多门支持). Server assigns the id. */
export interface AiDesignDoor {
  /** 墙向：N=北/后墙 S=南/前墙 W=西/左墙 E=东/右墙 */
  wall: "N" | "S" | "W" | "E";
  /** 沿墙起点偏移（cm） */
  pos: number;
  /** 门宽（cm），缺省 80 */
  len?: number;
  /** 门高（cm），缺省 200 */
  h?: number;
  /** 门款式，同 AiDesignRoom.door 四选一，宽容解析 */
  style?: string;
}

/** An item the AI wants in the yard (院子, floor 0 only). Either a singleton
 *  outdoor asset (`kind` from OUTDOOR_ASSET_LIBRARY, e.g. "tree.olive") OR a
 *  structural prefab (`prefab`, e.g. "pool"). Exactly one of the two. */
export interface AiDesignYardItem {
  /** Singleton asset kind, e.g. "tree.olive" / "plant.bushLarge" / "rock.large"
   *  / "feature.firepit" / "furniture.parasol". Resolved against the library. */
  kind?: string;
  /** Structural prefab. One of: pool / pergola_classic / outdoor_kitchen / fountain. */
  prefab?: "pool" | "pergola_classic" | "outdoor_kitchen" | "fountain";
  /** World position in cm, origin = house center on the ground. +z=前院(南),
   *  +x=右(东). Omit → server auto-places in the front yard. */
  x?: number;
  z?: number;
  /** Uniform scale multiplier (default 1). */
  scale?: number;
}

/** A paved functional zone the AI wants in the yard (院子分区). Rendered as a
 *  rectangle (widthCm × depthCm) centred at (x, z). Drives default paving +
 *  planting rules. */
export interface AiDesignYardZone {
  /** social(社交核心) | private(私密休闲) | utility(功能配套/车道) |
   *  agro(菜园) | lawn(草坪过渡). */
  kind: "social" | "private" | "utility" | "agro" | "lawn";
  /** Centre in cm, origin = house center. +z=前院(南), +x=右(东). */
  x: number;
  z: number;
  widthCm: number;
  depthCm: number;
}

/** A room entry returned by the AI design API */
export interface AiDesignRoom {
  type: RoomType;
  widthCm: number;
  depthCm: number;
  x: number;
  y: number;
  /** Furniture in this room. Undefined = leave existing furniture untouched;
   *  present (even empty) = the room's furniture is rebuilt from this list. */
  furniture?: AiDesignFurniture[];
  /** 墙面材质 id（MATERIALS 中 category==="wall"）。缺省=不动现有墙面。 */
  wall?: string;
  /** 地板材质 id（category==="floor"）。缺省=不动。 */
  floor?: string;
  /** 灯具/吊灯材质 id（category==="light"）。缺省=不动。 */
  light?: string;
  /** 瓷砖材质 id（category==="tile"，多用于厨卫）。缺省=不动。 */
  tile?: string;
  /** 窗户列表。Undefined=不动现有窗；给了（含空数组[]=清空）=按此重建该房间窗户。 */
  windows?: AiDesignWindow[];
  /** 开放式/拆墙：要"打通"的墙 N/S/W/E 列表。Undefined=不动；
   *  []=把四面墙都补回（取消开放）。只管 NSWE，吊顶等其它隐藏不受影响。 */
  openWalls?: ("N" | "S" | "W" | "E")[];
  /** 房门款式。取值（DoorStyle）：
   *  - "wood_panel"    实木门板（默认）
   *  - "frosted_glass" 磨砂玻璃木框门
   *  - "sliding_barn"  谷仓推拉门
   *  - "french_double" 法式对开玻璃门
   *  缺省=不动现有门款。服务端宽容解析（中文/近义词也认）。 */
  door?: string;
  /** 门在哪面墙：N=北/后 S=南/前 W=西/左 E=东/右。缺省=不动。 */
  doorWall?: "N" | "S" | "W" | "E";
  /** 门沿墙偏移（cm，从该墙起点）。缺省=不动。 */
  doorPos?: number;
  /** 门宽（cm，默认 80）。缺省=不动。 */
  doorLen?: number;
  /** false=这间不要门（开放门洞房间/储物间等）。缺省=不动。 */
  hasDoor?: boolean;
  /** 房间形状："rect"(矩形,默认) | "l-shape"(L型) | "convex"(凸字型)。
   *  缺省=不动现有形状。给了就按当前宽深重建该形状多边形。 */
  shape?: string;
  /** 房间自定义名称（如把 study 叫"琴房"）。缺省=不改名。 */
  name?: string;
  /** 该房间外立面："glass"=玻璃幕墙 | "concrete"=实墙开窗 | "auto"=自动。
   *  缺省=不动。 */
  exteriorStyle?: string;
  /** 天花板材质 id（复用 category==="wall" 的材质条目）。缺省=不动。 */
  ceiling?: string;
  /** 墙裙/护墙板材质 id（category==="wall"）。下半墙用它、上半墙用 wall。
   *  缺省=不动。 */
  wallLower?: string;
  /** 灯开关：true=开 false=关。缺省=不动。 */
  lightOn?: boolean;
  /** 灯亮度倍数 0.3–2.0。缺省=不动。 */
  lightBrightness?: number;
  /** 灯色温/颜色 hex（如 #FFD8A0 暖光、#F2F8FF 冷白）。缺省=不动。 */
  lightColor?: string;
  /** 多门列表。Undefined=不动现有门；给了（含[]）=按此重建该房间的门列表
   *  （覆盖单门旧字段）。 */
  doors?: AiDesignDoor[];
  /** 外墙装饰（壁灯/壁画/春联/门牌/信箱/爬藤…，FURNITURE 里
   *  category==="exterior_wall_decor" 的 id）。贴在该房间外墙的外侧面。
   *  Undefined=不动；给了（含[]）=按此重建该房间外墙装饰。
   *  u/v 是墙面归一化坐标：u 0=左 1=右（从外看），v 0=地 1=顶，缺省居中偏上。 */
  wallDecor?: Array<{
    id: string;
    wall: "N" | "S" | "W" | "E";
    u?: number;
    v?: number;
  }>;
}

/** Per-floor layout returned by the AI */
export interface AiDesignFloor {
  floorIndex: number;
  rooms: AiDesignRoom[];
  /** 要从这层删除的房间类型列表（仅 edit 模式有意义）。
   *  「把书房去掉」→ removeRooms: ["study"]。缺省=不删。 */
  removeRooms?: string[];
}

/** Full AI design result — returned by POST /api/ai-design */
export interface AiDesignResult {
  /** Regular-floor count. 1-99 (楼层不再限制最多 4 层). */
  floors: number;
  exterior: {
    /** Canonical EXTERIOR_PRESETS id — the single style 主线. When present,
     *  applyAiDesign runs applyExteriorPreset(preset) so the whole package
     *  (facade + room materials + yard) stays consistent with the UI. */
    preset?: string;
    wallColor?: string;
    roofType?: "flat" | "gable" | "hip" | "chinese";
    roofColor?: string;
    accentColor?: string;
    /** Whether the building has a usable 天台 (rooftop floor). */
    hasRooftop?: boolean;
    /** 外墙材质类型：render(抹灰)|brick(砖)|stone(石材)|wood(木)|concrete(清水混凝土)|glass(玻璃)。
     *  缺省=不动。服务端宽容解析中文。 */
    wallMaterial?: string;
    /** 楼体轮廓："rect"(矩形,默认) | "L" | "U" | "T"。缺省=不动。 */
    footprintShape?: string;
    /** 架空层高度（米，0–4）。>0 整楼抬起、四角混凝土柱（吊脚楼/底层架空）。
     *  缺省=不动。 */
    pilotis?: number;
    /** 是否渲染外围栅栏。缺省=不动。 */
    fence?: boolean;
    /** 整屋玻璃幕墙：true=隐框玻璃幕墙立面（实墙隐藏、玻璃+框架显示）；
     *  false=常规实墙开窗。缺省=不动。 */
    glassCurtain?: boolean;
    /** 分层外墙（自下而上叠带）。如上玻璃下砖：
     *  [{material:"brick",color:"#B05030",heightFraction:0.4},
     *   {material:"glass",color:"#C8E0F0",heightFraction:0.6}]。
     *  heightFraction 总和应为 1（服务端会归一化）。缺省=不动。 */
    wallZones?: Array<{ material: string; color: string; heightFraction: number }>;
  };
  floorLayouts: AiDesignFloor[];
  /** 院子（floor 0）改动。Undefined=不动现有院子。给了则：先按 clear 决定是否清空，
   *  再追加 add 里的物件。结构件（泳池/廊架等）用 prefab，植物/石头等用 kind。 */
  yard?: {
    /** 是否先清空现有院子物件（保留小径/铺装）。默认 false=在现有基础上追加。 */
    clear?: boolean;
    /** 要加进院子的物件列表。 */
    add?: AiDesignYardItem[];
    /** 功能分区（铺装区块）。用真实设计师的「环」语汇组织院子：社交核心、
     *  私密休闲、功能配套(车道)、菜园、草坪过渡。每个分区是一块矩形铺装。 */
    zones?: AiDesignYardZone[];
    /** 要追加的小径/铺装。points 是世界坐标 cm 折线（原点=房子中心，
     *  +z=前院/南，+x=右/东）。material: stone(石板)|gravel(砾石)|
     *  grass(草径)|brick(砖路)，缺省 stone；widthCm 缺省 80。 */
    paths?: Array<{
      points: Array<[number, number]>;
      widthCm?: number;
      material?: string;
    }>;
  };
  /** Short Chinese summary shown to the user after generation */
  summary?: string;
}

/** Generation mode. "create" rebuilds from scratch; "edit" feeds the AI the
 *  current design (`current`) so it can apply incremental tweaks. */
export type AiDesignMode = "create" | "edit";

/** Request body for POST /api/ai-design */
export interface AiDesignRequest {
  description: string;
  floors?: number;
  provider?: string;
  apiKey?: string;
  mode?: AiDesignMode;
  /** Serialized current design — only used when mode === "edit". */
  current?: AiDesignResult;
  /** 参考房间照片（data URL，base64）。给了就走视觉模型「按图复刻房间」：
   *  识别照片的家具/材质/窗户并输出单房间设计。可与 description 组合
   *  （如「把客厅照这张图搭」）。 */
  image?: string;
}
