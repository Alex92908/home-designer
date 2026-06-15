/**
 * defaultProject — 内置的「默认方案」(度假泳池别墅)。
 *
 * 来源是导出格式的 JSON(src/data/defaultProject.json，top-left 坐标)。这里：
 *   1. 把家具 placedItems 的 top-left 坐标转成 store 内部用的中心坐标
 *      (与 ExportModal 导入逻辑同源)。
 *   2. 导出 makeDefaultProject() —— 每次返回全新深拷贝，避免模块级单例被
 *      store 的可变更新就地改动后污染。
 *
 * 用途：
 *   · store 冷启动初始 state（无本地存档的新用户首次打开即见此方案）。
 *   · /showcase 模板画廊的内置样板。
 */
import rawDefaultProject from "@/data/defaultProject.json";
import { getFurnitureById } from "./furniture";
import type { FloorPlan, ExteriorSettings } from "./types";

type RawPlaced = { furnitureId: string; x: number; z: number; scaleW?: number; scaleD?: number };
type RawFloorPlan = { rooms: Record<string, { placedItems: RawPlaced[] }> };

// top-left 角 → 中心：x += halfWidth, z += halfDepth（按家具实际尺寸 × 缩放）。
function toCenterCoords(floorPlans: RawFloorPlan[]): FloorPlan[] {
  return floorPlans.map((fp) => ({
    ...fp,
    rooms: Object.fromEntries(
      Object.entries(fp.rooms).map(([rid, rs]) => [
        rid,
        {
          ...rs,
          placedItems: (rs.placedItems ?? []).map((p) => {
            const f = getFurnitureById(p.furnitureId);
            if (!f) return p;
            return {
              ...p,
              x: p.x + (f.width * (p.scaleW ?? 1)) / 2,
              z: p.z + (f.depth * (p.scaleD ?? 1)) / 2,
            };
          }),
        },
      ]),
    ),
  })) as unknown as FloorPlan[];
}

const raw = rawDefaultProject as unknown as {
  floorPlans: RawFloorPlan[];
  exterior?: Partial<ExteriorSettings>;
  scores?: { style: number; space: number; light: number; dominantStyle: string };
};

// 预计算一次（坐标转换），后续每次 make 只做深拷贝。
const FLOORPLANS_CENTER = toCenterCoords(raw.floorPlans);
const EXTERIOR = raw.exterior ?? {};
const SCORES = raw.scores ?? { style: 0, space: 0, light: 0, dominantStyle: "" };

export interface DefaultProject {
  floorPlans: FloorPlan[];
  exterior: Partial<ExteriorSettings>;
  scores: { style: number; space: number; light: number; dominantStyle: string };
}

/** 返回全新深拷贝，可安全交给 store 直接 mutate。 */
export function makeDefaultProject(): DefaultProject {
  return structuredClone({ floorPlans: FLOORPLANS_CENTER, exterior: EXTERIOR, scores: SCORES });
}
