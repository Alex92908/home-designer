"use client";

/**
 * proceduralThumbnail — 给程序化家具（id 以 proc- 开头，140 件）烤缩略图。
 *
 * 复用 glbThumbnail 的工作室成片（renderObjectThumbnail）与
 * proceduralFurniture 的 builder（buildProceduralGeometry，纯 three.js，
 * 与 RoomCanvas 的 ProceduralFurnitureMesh 是同一几何源——缩略图与摆进
 * 房间的模型长得一致）。
 *
 * 尺寸单位：目录 width/depth/height 是厘米，builder 要米。
 */
import type { FurnitureItem } from "./types";
import { buildProceduralGeometry } from "./proceduralFurniture";
import { renderObjectThumbnail, disposeObject } from "./glbThumbnail";

export async function makeProceduralThumbnail(item: FurnitureItem, size = 128): Promise<string | null> {
  const w = Math.max((item.width ?? 100) / 100, 0.05);
  const d = Math.max((item.depth ?? 100) / 100, 0.05);
  const h = Math.max((item.height ?? 100) / 100, 0.05);
  let group: ReturnType<typeof buildProceduralGeometry> = null;
  try {
    group = buildProceduralGeometry(item.id, w, d, h, item.color || "#8a8a8a", item.secondaryColor);
    if (!group) return null;
    return await renderObjectThumbnail(group, size);
  } catch {
    return null;
  } finally {
    if (group) {
      try {
        const THREE = await import("three");
        disposeObject(THREE, group);
      } catch { /* noop */ }
    }
  }
}
