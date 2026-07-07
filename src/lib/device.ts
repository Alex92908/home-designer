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
