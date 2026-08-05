// 估算一个 three 场景的显存占用(MB)—— 用真实数据给移动端串行加载器做**内存预算**,
// 让它在顶爆 iOS Safari 单页上限(实测某 15 Pro ~592MB)前停手,远处家具留占位盒也不崩。
//
//  · 几何:遍历 BufferGeometry,累加顶点/索引缓冲 byteLength。
//  · 纹理:遍历材质贴图去重,按 format 判真压缩(ASTC/ETC/S3TC,枚举 >=33776)——
//    注意 KTX2 退回 RGBA 时纹理仍是 CompressedTexture 实例但 format=RGBAFormat,必须看
//    format 而非 isCompressedTexture。压缩按 ~1bpp、RGBA 按 4bpp,各 ×1.33 计 mip 链。
import * as THREE from "three";

const TEX_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const;

export type SceneMemory = {
  geoMB: number; texMB: number; totalMB: number;
  astc: number; rgba: number; sample: string[];
  /** 贴图上传 GPU 后**仍留在 JS 侧**的那份副本(image / mipmaps)。iOS 读不到
   *  performance.memory,但这块是我们自己分配的,可以自己算 —— 它和 GLB 源 buffer
   *  一起构成「不在 GPU 估算里、却真实占 iOS 单页额度」的 JS 堆大头。 */
  cpuTexMB: number; cpuTexN: number;
};

/** 估一个贴图在 JS 侧残留副本的字节数(0 = 已释放)。 */
function cpuBytesOf(t: THREE.Texture): number {
  const src = (t as unknown as { source?: { data?: unknown } }).source;
  const data = (src?.data ?? (t as unknown as { image?: unknown }).image) as
    | { width?: number; height?: number; byteLength?: number; length?: number }
    | null | undefined;
  let bytes = 0;
  if (data) {
    if (typeof data.byteLength === "number") bytes += data.byteLength;          // 类型化数组
    else if (data.width && data.height) bytes += data.width * data.height * 4;  // ImageBitmap/Canvas/Image
  }
  // 压缩纹理(KTX2)的 mip 链是一组 Uint8Array,同样常驻 JS 侧。
  const mips = (t as unknown as { mipmaps?: Array<{ data?: { byteLength?: number } ; byteLength?: number }> }).mipmaps;
  if (Array.isArray(mips)) {
    for (const m of mips) bytes += m?.data?.byteLength ?? m?.byteLength ?? 0;
  }
  return bytes;
}

export function estimateSceneMemoryMB(scene: THREE.Object3D): SceneMemory {
  let astc = 0, rgba = 0, texBytes = 0, geoBytes = 0, cpuTexBytes = 0, cpuTexN = 0;
  const seenT = new Set<THREE.Texture>();
  const seenG = new Set<THREE.BufferGeometry>();
  const sample: string[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    if (g && g.isBufferGeometry && !seenG.has(g)) {
      seenG.add(g);
      for (const name in g.attributes) {
        const a = g.attributes[name] as THREE.BufferAttribute;
        const arr = a?.array as (ArrayLike<number> & { byteLength?: number }) | undefined;
        if (arr) geoBytes += arr.byteLength ?? arr.length * 4;
      }
      const idx = g.index?.array as (ArrayLike<number> & { byteLength?: number }) | undefined;
      if (idx) geoBytes += idx.byteLength ?? idx.length * 4;
    }
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const k of TEX_KEYS) {
        const t = (m as unknown as Record<string, THREE.Texture | null>)[k];
        if (t && !seenT.has(t)) {
          seenT.add(t);
          // 释放 CPU 副本后 image 为 null,尺寸从 userData 留档里取(见 texCpuRelease),
          // 否则 GPU 估算会假性归零、看不出真实占用。
          const img = t.image as { width?: number; height?: number } | undefined;
          const ud = t.userData as { __w?: number; __h?: number } | undefined;
          const w = img?.width ?? ud?.__w ?? 0, h = img?.height ?? ud?.__h ?? 0;
          const fmt = (t as { format?: number }).format ?? 0;
          const compressed = fmt >= 33776 && fmt <= 37820;
          if (compressed) { astc++; texBytes += w * h * 1 * 1.33; }
          else { rgba++; texBytes += w * h * 4 * 1.33; }
          const cpu = cpuBytesOf(t);
          if (cpu > 0) { cpuTexBytes += cpu; cpuTexN++; }
          if (sample.length < 5 && w) sample.push(`${compressed ? "压" : "RGBA"} ${w}x${h}`);
        }
      }
    }
  });
  const geoMB = geoBytes / 1048576, texMB = texBytes / 1048576;
  return {
    geoMB, texMB, totalMB: geoMB + texMB, astc, rgba, sample,
    cpuTexMB: cpuTexBytes / 1048576, cpuTexN,
  };
}
