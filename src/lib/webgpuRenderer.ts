/**
 * webgpuRenderer.ts — WebGPU support detection utilities
 *
 * R3F's `gl` prop does NOT support async factory functions, so we can't
 * swap the renderer at Canvas creation time via the `gl` prop.
 *
 * Instead, WebGPU is used via SSGIPostProcessing.tsx which mounts inside
 * the Canvas and checks gl.isWebGPURenderer at runtime.
 *
 * This file provides detection helpers and documents the upgrade path.
 */

/** Returns true when the browser has WebGPU support */
export function hasWebGPUSupport(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Upgrade path for full WebGPU rendering:
 *
 * R3F supports WebGPU via a custom renderer, but requires a synchronous
 * renderer factory. Since WebGPURenderer.init() is async, you need to
 * initialise it *before* the Canvas mounts, e.g.:
 *
 *   const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
 *
 *   useLayoutEffect(() => {
 *     if (!hasWebGPUSupport()) return;
 *     import("three/webgpu").then(({ WebGPURenderer }) => {
 *       const r = new WebGPURenderer({ antialias: false });
 *       r.init().then(() => { rendererRef.current = r; setReady(true); });
 *     });
 *   }, []);
 *
 *   // Then pass rendererRef.current to Canvas gl prop once ready.
 *
 * For now, HouseCanvas uses standard WebGL (fully compatible everywhere).
 * SSGI is available via SSGIPostProcessing.tsx on browsers where
 * three/webgpu is already initialised externally.
 */
export type WebGPURendererOptions = {
  toneMapping?: number;
  toneMappingExposure?: number;
  preserveDrawingBuffer?: boolean;
  antialias?: boolean;
};
