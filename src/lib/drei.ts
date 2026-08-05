// @react-three/drei 的 useGLTF 包装:给每个 GLTFLoader 实例挂 KTX2Loader(通过
// extendLoader 作用于实例,鸭子类型 —— 规避 pnpm 多副本 three-stdlib 的类身份问题)。
// 其余 drei 导出原样透传。用到 useGLTF 的文件从 "@/lib/drei" 导入即可。
/* eslint-disable @typescript-eslint/no-explicit-any */
export * from "@react-three/drei";
import { useGLTF as _u } from "@react-three/drei";
import { extendKtx2 } from "./gltfKtx2";
import { isMobileDevice } from "./device";

const withKtx2 = (extra?: (l: any) => void) => (loader: any) => { extendKtx2(loader); extra?.(loader); };

// 记录所有加载过的 GLB URL —— 供「释放过 CPU 贴图副本后清缓存」用(见 texCpuRelease)。
// drei/suspend-react 的缓存跨画布共用同一批 THREE.Texture;一旦我们释放了它们的 CPU
// 数据,换个画布(新 WebGL context)就无法重新上传 → 车/门渲染成黑(真机实拍)。
// 故在释放过的画布卸载时按这份清单清缓存,下个视图重新解析 GLB,纹理完整。
// ── 移动端专用资产:贴图封顶 512(见 scripts/mobile-assets.mjs)────────────────
// 桌面保持 /models(1024 满画质);手机改走 /models-mobile,同名同路径、贴图小一档。
// 1024² 贴图一间屋子几十张就上百 MB,是外观图「触顶留白膜」和漫游「走多了崩」的同一
// 个根因;512 在手机屏上肉眼无差,每张便宜 4 倍。所有 useGLTF 都经过本包装层,故这里
// 一处改写即可全局生效(含 preload)。
let _mobile: boolean | null = null;
function useMobileAssets(): boolean {
  if (_mobile === null) {
    try { _mobile = isMobileDevice(); } catch { _mobile = false; }
  }
  return _mobile;
}
const toMobile = (p: any): any => {
  if (typeof p === "string") return useMobileAssets() && p.startsWith("/models/") ? p.replace("/models/", "/models-mobile/") : p;
  if (Array.isArray(p)) return p.map(toMobile);
  return p;
};

const _loadedUrls = new Set<string>();
const track = (p: any) => { if (typeof p === "string") _loadedUrls.add(p); else if (Array.isArray(p)) p.forEach(track); };

/** 清空已加载 GLB 的解析缓存(下次用到会重新 fetch+解析;文件走 HTTP 缓存,不重下)。*/
export function clearLoadedGltfCache(): void {
  if (!_loadedUrls.size) return;
  try { (_u as any).clear(Array.from(_loadedUrls)); } catch { /* noop */ }
  _loadedUrls.clear();
}

function useGLTFk(path: any, useDraco: any = true, useMeshopt: any = true, extendLoader?: any): any {
  const p = toMobile(path);
  track(p);
  return (_u as any)(p, useDraco, useMeshopt, withKtx2(extendLoader));
}
useGLTFk.preload = (path: any, useDraco: any = true, useMeshopt: any = true, extendLoader?: any) => {
  const p = toMobile(path);
  track(p);
  return (_u as any).preload(p, useDraco, useMeshopt, withKtx2(extendLoader));
};
useGLTFk.clear = (...a: any[]) => (_u as any).clear(...a);
useGLTFk.setDecoderPath = (...a: any[]) => (_u as any).setDecoderPath(...a);

export const useGLTF = useGLTFk as unknown as typeof _u;
