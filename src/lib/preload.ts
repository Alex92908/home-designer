/**
 * Preload the most commonly used GLTF assets as soon as the app mounts.
 * This kicks off the network fetch immediately (instead of waiting for
 * Suspense to trigger when the Canvas renders), so by the time the user
 * switches to the 3D / 外观 / 全局 3D view, many assets are already
 * cached and the scene fills in quickly.
 *
 * Triggered from app/layout.tsx via a side-effectful import.
 */
import { useGLTF } from "@/lib/drei";

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
  // ── crypto.randomUUID 兜底(治真机崩溃)──────────────────────────────
  // crypto.randomUUID 只在「安全上下文」(HTTPS 或 localhost)存在。通过明文
  // http + 局域网 IP(如 http://192.168.x.x:3000)访问时它是 undefined，代码里
  // 十几处直接调用会抛 "crypto.randomUUID is not a function" → 整页错误边界。
  // 用不安全上下文也有的 getRandomValues 补一个 RFC4122 v4 实现。放最前，早于
  // 任何 useEffect/事件里的调用。(线上 HTTPS 有原生实现，guard 会跳过。)
  try {
    const c = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
    if (c && typeof c.randomUUID !== "function" && typeof c.getRandomValues === "function") {
      (c as { randomUUID: () => string }).randomUUID = function randomUUID() {
        const b = c.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h: string[] = [];
        for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, "0"));
        return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
      };
    }
  } catch { /* ignore */ }

  // 全分辨率不再靠「解码降分」——纹理走 KTX2(GPU 压缩、压缩态常驻显存),
  // 全分辨率也装得下。见 gltfKtx2.ts。

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
