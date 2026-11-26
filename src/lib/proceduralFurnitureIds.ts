/**
 * 程序化家具 id 的纯标识逻辑（从 proceduralFurniture.ts 拆出）。
 *
 * 本模块故意不 import three：目录缩略图（catalogThumbnails，经
 * LeftPanel 常驻首屏）只需要判断「是不是 proc- 件」，不需要建几何。
 * 几何 builder 仍在 ./proceduralFurniture（three 依赖，只进 3D chunk）。
 */

/** 程序化家具 id 前缀（目录 id、模板引用、渲染分流共用）。 */
export const PROCEDURAL_PREFIX = "proc-";

export function isProceduralFurnitureId(id: string): boolean {
  return id.startsWith(PROCEDURAL_PREFIX);
}
