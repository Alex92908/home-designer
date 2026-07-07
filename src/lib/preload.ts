/**
 * Preload the most commonly used GLTF assets as soon as the app mounts.
 * This kicks off the network fetch immediately (instead of waiting for
 * Suspense to trigger when the Canvas renders), so by the time the user
 * switches to the 3D / 外观 / 全局 3D view, many assets are already
 * cached and the scene fills in quickly.
 *
 * Triggered from app/layout.tsx via a side-effectful import.
 */
import { useGLTF } from "@react-three/drei";

// One representative GLTF per common furniture category. Deliberately small
// list — preloading too many will saturate the network and hurt TTFB.
const HOT_URLS = [
  // Living
  "/models/sofa/sofa_03/sofa_03_1k.glb",
  "/models/coffee_table/coffee_table_round_01/coffee_table_round_01_1k.glb",
  "/models/tv_unit/modern_wooden_cabinet/modern_wooden_cabinet_1k.glb",
  "/models/sideboard/vintage_cabinet_01/vintage_cabinet_01_1k.glb",
  "/models/bookshelf/steel_frame_shelves_01/steel_frame_shelves_01_1k.glb",

  // Bedroom
  "/models/bed/bed_07/bed_07.glb",
  "/models/nightstand/side_table_01/side_table_01_1k.glb",
  "/models/wardrobe/wardrobe_dylanheyes/wardrobe_dylanheyes.glb",

  // Windows/doors (highest-reuse assets — every room typically has one)
  "/models/_arch_window/modern_window_archviz/scene.glb",
  "/models/_arch_door/door_with_frame/door_with_frame.glb",
];

// All client-only side effects. Gate on window so SSR / hydration pass
// doesn't trigger drei internals that might touch browser-only APIs.
if (typeof window !== "undefined") {
  // Point DRACOLoader at self-hosted decoder files (public/draco/*).
  // drei default = gstatic CDN, sometimes slow/blocked from mainland China.
  try { useGLTF.setDecoderPath("/draco/"); } catch { /* noop */ }

  // 移动端跳过批量预载：手机带宽/内存都紧张，10 个 GLB 预载会挤占
  // 关键 JS chunk 的下载（样板间卡"渲染外形图…"的帮凶），且解码后的
  // 几何/纹理常驻内存加速 iOS 杀页。移动端按需加载（Suspense 逐件进）。
  const isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // Small defer so the initial document/CSS get priority on the network
  // queue. 150ms ≈ one LCP frame on mid-range hardware.
  if (!isMobile) setTimeout(() => {
    for (const url of HOT_URLS) {
      try {
        // useGLTF.preload returns a thenable that rejects on 404 etc.
        // Chain .catch so it doesn't surface as unhandled rejection.
        const p = useGLTF.preload(url) as unknown as Promise<unknown> | undefined;
        if (p && typeof (p as Promise<unknown>).catch === "function") {
          (p as Promise<unknown>).catch(() => { /* best-effort */ });
        }
      } catch { /* best-effort */ }
    }
  }, 150);
}

export {};
