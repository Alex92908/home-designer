// 贴图上传 GPU 后**释放 CPU 侧那份副本** —— 移动端 OOM 的最大单项。
//
// 实测证据(iPhone 同款路径,HUD):合计 842MB 里 **CPU 残留贴图 546MB(256 张)**,
// 占 65%;而 GPU 纹理只有 179MB、帧缓冲仅 7MB。three 默认在上传后仍在 JS 侧持有
// image(ImageBitmap/Canvas)和压缩纹理的 mip 链 → 等于双份占用,把 JS 堆顶到 1.1GB,
// iOS Jetsam 按瞬时水位杀页。
//
// 释放时机必须是「已上传之后」:three 的 WebGLTextures.uploadTexture 末尾会调
// texture.onUpdate(texture),这是唯一安全的钩子 —— 早于它清数据会上传空贴图。
//
// ⚠️ 代价:GL context 丢失后无法重新上传(变黑)。移动端崩页比偶发 context lost 严重
// 得多,故只在移动端启用;需要动态重绘的贴图(canvas 动画等)用 markTexDynamic 排除。
import type * as THREE from "three";

const DYNAMIC = new WeakSet<THREE.Texture>();

/** 标记「会被重复重绘/重新上传」的贴图 —— 永不释放其 CPU 副本。 */
export function markTexDynamic(tex: THREE.Texture): void { DYNAMIC.add(tex); }

// 本画布是否真的释放过 CPU 副本。释放过 ⇒ 这些 THREE.Texture 已无法在**新的 WebGL
// context** 里重新上传(切视图会重挂画布),必须在卸载时清掉 GLTF 解析缓存,
// 否则下个视图复用到它们就是黑图(真机实拍:效果图里车/门全黑)。
let _released = false;
export function hasReleasedCpuTextures(): boolean { return _released; }
export function resetReleasedFlag(): void { _released = false; }

type Src = { data?: unknown } | undefined;

/** 给贴图挂上「上传完就释放 CPU 副本」的钩子(幂等)。 */
export function releaseCpuAfterUpload(tex: THREE.Texture): void {
  if (!tex || DYNAMIC.has(tex)) return;
  const ud = tex.userData as { __cpuRelease?: string; __w?: number; __h?: number };
  if (ud.__cpuRelease) return;           // 已挂钩或已释放

  // ⚠️ 只释放**压缩纹理(KTX2/ASTC)**的 CPU 副本 —— 它们是大头(真机实测 CPU 残留
  //    546MB→7MB 主要来自这里),且只被家具 GLB 用。
  //    绝不碰 canvas/image 背景的贴图:墙面/地面/壁画等程序化贴图在 textures.ts 里
  //    **跨视图共享缓存**,切视图会重挂画布 = 新 WebGL context = 必须重新上传一次;
  //    数据被清掉就没得传 → 整片墙渲染成黑(用户实拍:楼体黑块)。这些贴图已被
  //    shrink 压到 256²,留着也很小,不值得为省这点冒黑图风险。
  const data0 = ((tex as unknown as { source?: { data?: unknown } }).source?.data
    ?? (tex as unknown as { image?: unknown }).image) as unknown;
  const isCompressed = !!(tex as { isCompressedTexture?: boolean }).isCompressedTexture;
  const isBitmap = typeof ImageBitmap !== "undefined" && data0 instanceof ImageBitmap;
  if (!isCompressed && !isBitmap) return;  // canvas/HTMLImage 背景的共享贴图,放过

  ud.__cpuRelease = "hooked";

  // 先把尺寸留档:释放后 image 为 null,诊断/估算仍要知道它多大。
  const img = tex.image as { width?: number; height?: number } | undefined;
  if (img?.width) { ud.__w = img.width; ud.__h = img.height; }

  tex.onUpdate = () => {
    try {
      const src = (tex as unknown as { source?: Src }).source;
      const data = src?.data as { close?: () => void; width?: number; height?: number } | null | undefined;
      if (data) {
        if (!ud.__w && data.width) { ud.__w = data.width; ud.__h = data.height; }
        // ImageBitmap 占的是 JS 堆外内存,Safari 回收很慢 —— 必须显式 close。
        if (typeof data.close === "function") data.close();
      }
      if (src) src.data = null;
      // 压缩纹理(KTX2)的 mip 链是一组 Uint8Array,上传后同样可弃。
      (tex as unknown as { mipmaps?: unknown[] }).mipmaps = [];
      ud.__cpuRelease = "released";
      _released = true;
    } catch { /* 释放失败不影响渲染 */ }
    tex.onUpdate = null;
  };
  // ⚠️ 这里**不能**写 tex.needsUpdate = true 来「逼已上传的纹理再传一次好走到钩子」:
  // 并发加载多时,很多纹理的数据还没解码完就被这行逼着上传了一次空内容 → onUpdate 触发
  // → 我们把 CPU 数据清掉 → 真数据永远传不上去 → 家具大面积变黑(用户实拍:放宽纹理
  // 预算、并发件数翻倍后尤其明显)。
  // 只挂钩子、不催上传:绝大多数纹理在首次上传前就被扫描到(解码比 0.4s 扫描周期慢),
  // 照样能释放;个别漏网的保留 CPU 副本即可 —— 内存早已不是瓶颈(实测合计仅 323MB)。
}
