// @react-three/drei 的 useGLTF 包装:给每个 GLTFLoader 实例挂 KTX2Loader(通过
// extendLoader 作用于实例,鸭子类型 —— 规避 pnpm 多副本 three-stdlib 的类身份问题)。
// 其余 drei 导出原样透传。用到 useGLTF 的文件从 "@/lib/drei" 导入即可。
/* eslint-disable @typescript-eslint/no-explicit-any */
export * from "@react-three/drei";
import { useGLTF as _u } from "@react-three/drei";
import { extendKtx2 } from "./gltfKtx2";

const withKtx2 = (extra?: (l: any) => void) => (loader: any) => { extendKtx2(loader); extra?.(loader); };

// 记录所有加载过的 GLB URL —— 供「释放过 CPU 贴图副本后清缓存」用(见 texCpuRelease)。
// drei/suspend-react 的缓存跨画布共用同一批 THREE.Texture;一旦我们释放了它们的 CPU
// 数据,换个画布(新 WebGL context)就无法重新上传 → 车/门渲染成黑(真机实拍)。
// 故在释放过的画布卸载时按这份清单清缓存,下个视图重新解析 GLB,纹理完整。
const _loadedUrls = new Set<string>();
const track = (p: any) => { if (typeof p === "string") _loadedUrls.add(p); else if (Array.isArray(p)) p.forEach(track); };

/** 清空已加载 GLB 的解析缓存(下次用到会重新 fetch+解析;文件走 HTTP 缓存,不重下)。*/
export function clearLoadedGltfCache(): void {
  if (!_loadedUrls.size) return;
  try { (_u as any).clear(Array.from(_loadedUrls)); } catch { /* noop */ }
  _loadedUrls.clear();
}

function useGLTFk(path: any, useDraco: any = true, useMeshopt: any = true, extendLoader?: any): any {
  track(path);
  return (_u as any)(path, useDraco, useMeshopt, withKtx2(extendLoader));
}
useGLTFk.preload = (path: any, useDraco: any = true, useMeshopt: any = true, extendLoader?: any) => {
  track(path);
  return (_u as any).preload(path, useDraco, useMeshopt, withKtx2(extendLoader));
};
useGLTFk.clear = (...a: any[]) => (_u as any).clear(...a);
useGLTFk.setDecoderPath = (...a: any[]) => (_u as any).setDecoderPath(...a);

export const useGLTF = useGLTFk as unknown as typeof _u;
