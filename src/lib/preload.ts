/**
 * Preload the most commonly used GLTF assets once the page is idle.
 * This kicks off the network fetch after first paint / hydration (instead
 * of racing the critical JS chunks and the current room's GLBs), so by the
 * time the user switches to the 3D / 外观 / 全局 3D view, many assets are
 * already cached and the scene fills in quickly.
 *
 * Loaded lazily: ClientBoot dynamic-imports this module on idle, so the
 * three/drei graph it pulls in stays OUT of the initial JS bundle (on
 * mobile the first screen is a 2D plan — no canvas mounts at startup, so
 * nothing here is needed before first interaction). The crypto.randomUUID
 * polyfill and the Draco decoder path used to live here; they moved to
 * @/lib/cryptoPolyfill (static, tiny) and @/lib/drei (module-level) so
 * this module no longer has to load early to set them up.
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
  // 等首屏 HTML/CSS/JS 与当前房间 GLB 让出带宽与主线程后再预载：load 事件
  // 后 + requestIdleCallback（主线程空闲，5s 超时兜底）；Safari 无 rIC
  // 时用 3s 定时兜底。之前是模块求值后 150ms 就冲 17 个 GLB，正好撞上
  // 首屏 JS 解析与房间 GLB 加载，手机上尤其挤。
  const onIdle = (fn: () => void) => {
    const run = () => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
      if (typeof ric === "function") ric(fn, { timeout: 5000 });
      else setTimeout(fn, 3000);
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
  };

  const preloadOne = (url: string) => {
    try {
      // useGLTF.preload returns a thenable that rejects on 404 etc.
      // Chain .catch so it doesn't surface as unhandled rejection.
      const p = useGLTF.preload(url) as unknown as Promise<unknown> | undefined;
      if (p && typeof (p as Promise<unknown>).catch === "function") {
        (p as Promise<unknown>).catch(() => { /* best-effort */ });
      }
    } catch { /* best-effort */ }
  };

  // 顺序预载（最多 2 并发）：17 个 GLB 一起冲会挤占当前房间 GLB 与关键
  // JS 的带宽；排队下完仍能在用户切视图前命中缓存。
  const preloadSequential = (urls: string[]) => {
    let i = 0;
    let inFlight = 0;
    const pump = () => {
      while (inFlight < 4 && i < urls.length) {
        const url = urls[i++];
        inFlight++;
        try {
          const p = useGLTF.preload(url) as unknown as Promise<unknown> | undefined;
          const done = () => { inFlight--; pump(); };
          if (p && typeof (p as Promise<unknown>).then === "function") (p as Promise<unknown>).then(done, done);
          else done();
        } catch { inFlight--; }
      }
    };
    pump();
  };

  // 移动端跳过批量预载：手机带宽/内存都紧张，10 个 GLB 预载会挤占
  // 关键 JS chunk 的下载（样板间卡"渲染外形图…"的帮凶），且解码后的
  // 几何/纹理常驻内存加速 iOS 杀页。移动端按需加载（Suspense 逐件进）。
  const isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // 移动端只预热解码器，不批量预载：首次进 3D 前 Draco WASM + KTX2
  // 转码器都是冷的，第一件模型要现取 WASM、起 worker、初始化模块
  // （手机上约 0.5–1.5s），之后每件还都要等。只预载 1 个通用小模型
  // （每间房都有的门，206KB）：走同一条 useGLTF 路径，顺带把 drei 的
  // Draco 单例 + 共享 KTX2Loader + worker 池都热起来，代价一个文件。
  if (isMobile) onIdle(() => setTimeout(() => preloadOne("/models/_arch_door/door_with_frame/door_with_frame.glb"), 150));
  else onIdle(() => preloadSequential(HOT_URLS));
}

export {};
