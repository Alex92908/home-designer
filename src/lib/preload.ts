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

// Point DRACOLoader at self-hosted decoder files (public/draco/*). drei's
// default is https://www.gstatic.com/draco/v1/decoders/ — that CDN is
// occasionally slow/blocked from mainland China. The decoder is ~340KB
// (wasm) + 700KB (js fallback), cached aggressively by the browser.
useGLTF.setDecoderPath("/draco/");

// One representative GLTF per common furniture category. Deliberately small
// list — preloading too many will saturate the network and hurt TTFB.
const HOT_URLS = [
  // Living
  "/models/sofa/sofa_03/sofa_03_1k.gltf",
  "/models/coffee_table/coffee_table_round_01/coffee_table_round_01_1k.gltf",
  "/models/tv_unit/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf",
  "/models/sideboard/vintage_cabinet_01/vintage_cabinet_01_1k.gltf",
  "/models/bookshelf/steel_frame_shelves_01/steel_frame_shelves_01_1k.gltf",

  // Bedroom
  "/models/bed/bed_07/bed_07.gltf",
  "/models/nightstand/side_table_01/side_table_01_1k.gltf",
  "/models/wardrobe/wardrobe_dylanheyes/wardrobe_dylanheyes.gltf",

  // Windows/doors (highest-reuse assets — every room typically has one)
  "/models/_arch_window/modern_window_archviz/scene.gltf",
  "/models/_arch_door/door_with_frame/scene.gltf",
];

// Fire preload on module import. Safe to call multiple times — useGLTF
// dedupes by URL and it's a no-op if already cached.
if (typeof window !== "undefined") {
  // Small defer so the initial document/CSS get priority on the network
  // queue. 150ms ≈ one LCP frame on mid-range hardware.
  setTimeout(() => {
    for (const url of HOT_URLS) {
      try { useGLTF.preload(url); } catch { /* ignore — preload best-effort */ }
    }
  }, 150);
}

export {};
