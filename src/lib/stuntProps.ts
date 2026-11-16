/**
 * stuntProps —— 特技道具（特殊位置 / 动作戏的载体）。
 *
 * 特殊位置的动作总要"站/贴/骑/躲在什么上"：桌子在场景家具里就有，
 * 树/车/火车/剑/扫帚/马/摩托/直升机/墙/屋顶/山坡/桥/绳索/飞板没有——
 * 这里用程序化几何现场造（简单 Three.js 几何，不引新模型文件）。
 *
 * 每个道具：注册表给名字、默认尺寸、站上去的高度（topY）、贴上去的高度
 * （sideY）、默认安全备注。渲染见 components/StuntProps.tsx。
 * 道具实例存在 cine store（stuntProps，持久化），位置为地面 [x, z]。
 */
export type StuntPropKind =
  | "tree" | "car" | "train" | "sword" | "broom"
  | "horse" | "motorcycle" | "helicopter"
  | "wall" | "platform" | "slope" | "bridge" | "rope" | "flyboard";

export interface StuntPropDef {
  kind: StuntPropKind;
  nameZh: string;
  nameEn: string;
  /** 占地（米）：[宽, 深] */
  size: [number, number];
  /** 本体高度（米） */
  height: number;
  /** 站到顶上的高度（米）——屋顶/墙头/火车顶/树杈 */
  topY: number;
  /** 贴在侧面的高度（米）——贴火车/贴墙 */
  sideY: number;
  /** 默认安全备注（特技不是儿戏） */
  safety: string;
}

export const STUNT_PROP_REGISTRY: Record<StuntPropKind, StuntPropDef> = {
  tree:       { kind: "tree",       nameZh: "树",     nameEn: "Tree",       size: [1.2, 1.2], height: 4.0, topY: 2.2, sideY: 1.2, safety: "威亚+垫子" },
  car:        { kind: "car",        nameZh: "汽车",   nameEn: "Car",        size: [4.2, 1.8], height: 1.5, topY: 1.4, sideY: 0.8, safety: "替身+垫子" },
  train:      { kind: "train",      nameZh: "火车车厢", nameEn: "Train car", size: [10, 2.8],  height: 3.2, topY: 3.0, sideY: 1.5, safety: "威亚+垫子+封锁线路" },
  sword:      { kind: "sword",      nameZh: "剑",     nameEn: "Sword",      size: [1.2, 0.2], height: 0.1, topY: 0.0, sideY: 0.0, safety: "威亚" },
  broom:      { kind: "broom",      nameZh: "扫帚",   nameEn: "Broom",      size: [1.4, 0.2], height: 0.1, topY: 0.0, sideY: 0.0, safety: "威亚" },
  horse:      { kind: "horse",      nameZh: "马",     nameEn: "Horse",      size: [2.2, 0.8], height: 1.6, topY: 1.4, sideY: 0.8, safety: "驯马师+护具" },
  motorcycle: { kind: "motorcycle", nameZh: "摩托",   nameEn: "Motorcycle", size: [2.0, 0.8], height: 1.1, topY: 0.8, sideY: 0.5, safety: "护具+封闭道路" },
  helicopter: { kind: "helicopter", nameZh: "直升机", nameEn: "Helicopter", size: [6.0, 2.2], height: 2.4, topY: 2.0, sideY: 1.4, safety: "威亚+专业飞手" },
  wall:       { kind: "wall",       nameZh: "墙",     nameEn: "Wall",       size: [6.0, 0.4], height: 2.2, topY: 2.2, sideY: 1.2, safety: "垫子" },
  platform:   { kind: "platform",   nameZh: "平台/屋顶", nameEn: "Platform / rooftop", size: [5.0, 4.0], height: 3.0, topY: 3.0, sideY: 1.5, safety: "威亚+垫子" },
  slope:      { kind: "slope",      nameZh: "山坡",   nameEn: "Slope",      size: [6.0, 4.0], height: 2.5, topY: 2.5, sideY: 1.2, safety: "防滑+垫子" },
  bridge:     { kind: "bridge",     nameZh: "桥",     nameEn: "Bridge",     size: [8.0, 2.0], height: 2.2, topY: 2.0, sideY: 1.0, safety: "威亚+垫子" },
  rope:       { kind: "rope",       nameZh: "绳索",   nameEn: "Rope",       size: [0.2, 0.2], height: 3.5, topY: 3.5, sideY: 1.8, safety: "威亚+头盔+垫子" },
  flyboard:   { kind: "flyboard",   nameZh: "飞行器", nameEn: "Flyer",      size: [1.0, 0.6], height: 0.15, topY: 0.0, sideY: 0.0, safety: "威亚" },
};

export const STUNT_PROP_LIST: StuntPropDef[] = Object.values(STUNT_PROP_REGISTRY);

export function stuntPropDef(kind: string): StuntPropDef | undefined {
  return (STUNT_PROP_REGISTRY as Record<string, StuntPropDef>)[kind];
}

/** 特技道具实例（存在 cine store，持久化） */
export interface StuntProp {
  id: string;
  kind: StuntPropKind;
  /** 地面位置（米，世界坐标） */
  x: number;
  z: number;
  /** 朝向（弧度），缺省 0 */
  rotation?: number;
  /** 缩放，缺省 1 */
  scale?: number;
}

export function makeStuntProp(kind: StuntPropKind, x: number, z: number, opts?: { rotation?: number; scale?: number }): StuntProp {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    kind,
    x,
    z,
    ...(opts?.rotation !== undefined ? { rotation: opts.rotation } : {}),
    ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
  };
}

/**
 * 动作 → 默认特技道具 + 安全备注（文字解析与"＋加特技动作"共用）。
 * 飞行类动作的道具随人走（剑/扫帚/飞板是"坐骑"，位置 = 演员位置）；
 * 其余道具固定在场景里。
 */
export const STUNT_ACTION_PROPS: Record<string, { prop: StuntPropKind | null; safety: string }> = {
  jump:      { prop: null,        safety: "垫子" },
  climb:     { prop: null,        safety: "威亚+垫子" },
  cling:     { prop: null,        safety: "威亚+垫子" },
  ride:      { prop: null,        safety: "护具" },
  flySword:  { prop: "sword",     safety: "威亚" },
  flyBroom:  { prop: "broom",     safety: "威亚" },
  wireFly:   { prop: null,        safety: "威亚+垫子" },
  hide:      { prop: null,        safety: "无" },
  prone:     { prop: null,        safety: "垫子" },
  leap:      { prop: "wall",      safety: "威亚+垫子" },
  rappel:    { prop: "rope",      safety: "威亚+头盔+垫子" },
  swim:      { prop: null,        safety: "救生员+替身" },
};
