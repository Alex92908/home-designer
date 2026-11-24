// 当前房间 GLB 预载(桌面端):用户在 2D 里选房/改布局时就把该房间的
// 模型下好解好,切到「室内装修」时直接命中 useGLTF 缓存,不用再等
// 29 个 GLB 现下现解。只在桌面做 —— 移动端内存紧张,按需加载
// (见 preload.ts 的说明);用户导入的自定义家具不预载(走 IndexedDB
// 路径,按需加载)。
import { useGLTF } from "@/lib/drei";
import { isMobileDevice } from "@/lib/device";
import { getFurnitureById } from "@/lib/furniture";
import type { PlacedItem } from "@/lib/types";

/** 一个房间去重后的 GLB URL(排序后,签名稳定)。 */
export function collectRoomGlbUrls(placedItems: PlacedItem[] | undefined): string[] {
  if (!placedItems?.length) return [];
  const urls = new Set<string>();
  for (const p of placedItems) {
    const url = getFurnitureById(p.furnitureId)?.model3d?.url;
    if (url) urls.add(url);
  }
  return [...urls].sort();
}

// 已发起过预载的 URL(进程内去重;useGLTF.preload 本身也按 URL 缓存,
// 这里只是避免重复调)。桌面端不清 GLTF 缓存,故无需失效。
const _preloaded = new Set<string>();

/** 预载一批 GLB URL(桌面端,尽力而为,失败静默)。 */
export function preloadGlbUrls(urls: string[]): void {
  if (typeof window === "undefined" || !urls.length) return;
  try { if (isMobileDevice()) return; } catch { /* ignore */ }
  for (const url of urls) {
    if (_preloaded.has(url)) continue;
    _preloaded.add(url);
    try {
      const p = useGLTF.preload(url) as unknown as Promise<unknown> | undefined;
      if (p && typeof (p as Promise<unknown>).catch === "function") {
        (p as Promise<unknown>).catch(() => { _preloaded.delete(url); });
      }
    } catch { _preloaded.delete(url); }
  }
}
