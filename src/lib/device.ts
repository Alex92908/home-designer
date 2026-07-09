/**
 * 设备能力检测 —— 移动端（尤其 iOS WebKit，Chrome iOS 也是 WebKit 内核）
 * 对单页内存有硬上限（约 1–1.5GB），超限直接杀掉渲染进程（"无法打开此网页"）。
 * 3D 画布在移动端必须降配：dpr 封顶 1.5（iPhone dpr=3 → 全分辨率帧缓冲
 * 是 1.5 的 4 倍内存）、跳过批量预载让关键 chunk 先到。
 */

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isIOSDevice()) return true;
  if (/Android/i.test(navigator.userAgent)) return true;
  // 兜底：粗指针 + 多点触控（排除触屏笔记本的 fine pointer）
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true &&
    navigator.maxTouchPoints > 1
  );
}

/** 移动端 [1, 1.5]，桌面 [1, 2] —— 直接喂给 <Canvas dpr={...}>。 */
export function canvasDpr(): [number, number] {
  return isMobileDevice() ? [1, 1.5] : [1, 2];
}

/** 重型场景（外观图/全屋3D：整栋 + 院子 + 树/车/泳池几十个 GLB）移动端
 *  dpr 锁 1（帧缓冲比 1.5 再省 ~2.25x），桌面 [1, 2]。 */
export function canvasDprHeavy(): [number, number] {
  return isMobileDevice() ? [1, 1] : [1, 2];
}

/** 移动端关阴影/HDR 环境光：阴影贴图是额外的大帧缓冲 + 一遍渲染，HDR
 *  的 PMREM 立方图常驻十几 MB 显存 —— 都是 iOS 杀页大头。桌面保留。 */
export function mobileLiteScene(): boolean {
  return isMobileDevice();
}

// ── 移动端「逐房间家具 GLB」开关 ─────────────────────────────
// iOS 内存有限，室内几十个不同家具 GLB 一次全上会杀页。策略：院子 GLB
// （泳池/车/树，模型少）默认全渲染；室内家具默认全用占位盒，只有「当前
// 点亮的那一间」才加载完整家具 GLB —— 一次只亮一间，显存有界。切换房间
// 时重挂 Canvas 释放上一间的 GPU 资源。桌面永远全量（下面带 isMobileDevice）。
let _mobileGlbRoom: string | null = null;
export function setMobileGlbRoom(r: string | null): void { _mobileGlbRoom = r; }
export function mobileGlbRoom(): string | null { return _mobileGlbRoom; }
/** 家具 GLB 是否为该房间渲染：桌面恒真；移动端仅「当前点亮的房间」。 */
export function mobileFurnitureGlbAllowed(room: string): boolean {
  return !isMobileDevice() || _mobileGlbRoom === room;
}

// ── 移动端纹理瘦身 ───────────────────────────────────────────
// GLB 里 1024² 的 WebP 解码上传 GPU 后是 RGBA + mipmap ≈ 5.3MB/张，
// 一个房间几十个模型 × 每模型多张贴图 → 数百 MB GPU 内存，iOS 直接杀页。
// 移动端在首次上传前把贴图重采样到 256（相对 1024 省 16 倍显存）——手机
// 屏幕小、贴图很少显示超过 256px，画质损失几乎看不出，却能塞下多得多的
// GLB。纹理对象在 useGLTF 缓存里共享，就地改一次全部实例受益；WeakSet 防重复。
const _shrunk = new WeakSet<object>();
const TEX_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const;

export function shrinkSceneTexturesForMobile(root: { traverse: (cb: (o: unknown) => void) => void }, maxSize = 256): void {
  if (!isMobileDevice()) return;
  root.traverse((obj) => {
    const mesh = obj as { isMesh?: boolean; material?: unknown };
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      for (const key of TEX_KEYS) {
        const tex = (mat as Record<string, unknown>)[key] as {
          image?: { width?: number; height?: number };
          isCompressedTexture?: boolean;
          needsUpdate?: boolean;
        } | null | undefined;
        if (!tex || tex.isCompressedTexture || _shrunk.has(tex)) continue;
        const img = tex.image;
        const w = img?.width ?? 0, h = img?.height ?? 0;
        if (!img || Math.max(w, h) <= maxSize) { _shrunk.add(tex); continue; }
        try {
          const scale = maxSize / Math.max(w, h);
          const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement("canvas");
          canvas.width = cw; canvas.height = ch;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.drawImage(img as CanvasImageSource, 0, 0, cw, ch);
          (tex as { image: unknown }).image = canvas;
          tex.needsUpdate = true;
          _shrunk.add(tex);
        } catch { /* 画不了（跨域/特殊格式）就保持原样 */ }
      }
    }
  });
}
