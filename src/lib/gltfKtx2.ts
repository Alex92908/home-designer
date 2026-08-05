"use client";
// KTX2(GPU 压缩纹理)加载支持 —— 让 KHR_texture_basisu 的 .ktx2 贴图在移动端以
// 压缩态常驻显存(ASTC/ETC ≈ RGBA 的 1/6~1/8),做到「全分辨率 + 不崩」。
//
// 集成要点(踩过的坑):
//  · pnpm 装了多份 three-stdlib(按 three 版本分裂),GLTFLoader 类身份不一致 →
//    patch prototype 打不中 drei 的类。故改「在具体 loader 实例上挂」(extendKtx2),
//    鸭子类型跨副本生效。各 three-stdlib 都是 2.36.1,KTX2Loader 接口一致,可互用。
//  · 之前把 detectSupport(要开渲染器)和「挂 loader」耦合在一起:detectSupport 在
//    /showcase 开第二个 WebGL context 被 iOS 拒→抛错→setKTX2Loader 被跳过→curtain
//    报 "setKTX2Loader must be called"。现在拆开:extendKtx2 只无条件挂;detectSupport
//    交给 <Ktx2Detect/> 用**真实渲染器**跑一次(不另开 context)。
import { KTX2Loader } from "three-stdlib";
import { WebGLRenderer } from "three";
import { useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { isIOSDevice } from "@/lib/device";

let _ktx2: KTX2Loader | null = null;
let _detected = false;

export function getKtx2Loader(): KTX2Loader {
  if (!_ktx2) _ktx2 = new KTX2Loader().setTranscoderPath("/basis/");
  return _ktx2;
}

/** KTX2 是否已用**真实/合适的渲染器**探好压缩格式。移动端串行加载器据此等待,确保不会
 *  在探测完成前就转码(否则会退回 RGBA 未压 → 显存暴涨崩页)。 */
export function isKtx2Ready(): boolean { return _detected; }

/** detectSupport 决定 basis 转码目标格式。**这一步在 iOS 上极其关键**:
 *  之前用一次性 throwaway WebGLRenderer 抢先探测,但 iOS 的离屏 context 探不到 ASTC →
 *  KTX2Loader 退回把纹理转成 RGBA(未压,每张 1024² = 5.3MB)→ 两层别墅 ~102 张就顶爆
 *  Safari 单页 ~592MB 上限崩掉。真机实测证据:info.tex 102 张 = 556MB(均 5.4MB/张=RGBA)。
 *  修法:**只在非 iOS 用 throwaway 抢先探**(消除桌面预载竞态);iOS 一律用真实 Canvas
 *  上下文探(它有 WEBGL_compressed_texture_astc)→ 转 ASTC(1024² ≈ 1MB,省 5 倍)。 */
function ensureSupportThrowaway(): void {
  if (_detected || isIOSDevice()) return;
  try {
    const gl = new WebGLRenderer();
    getKtx2Loader().detectSupport(gl);
    _detected = true;
    gl.forceContextLoss?.();
    gl.dispose();
  } catch { /* 失败靠 <Ktx2Detect/> 用真实渲染器兜底 */ }
}

/** 把共享 KTX2Loader 挂到这个 GLTFLoader 实例(先挂,再探——探失败也不影响挂,绝不漏挂)。 */
export function extendKtx2(loader: unknown): void {
  try {
    const l = loader as { ktx2Loader?: unknown; setKTX2Loader?: (k: unknown) => void };
    if (l && typeof l.setKTX2Loader === "function" && !l.ktx2Loader) {
      l.setKTX2Loader(getKtx2Loader());
      ensureSupportThrowaway();
    }
  } catch { /* noop */ }
}

/** 用**真实渲染器**探测压缩格式(iOS 的唯一正确来源:真 Canvas 上下文才有 ASTC 扩展)。
 *  useMemo 在 render 阶段跑,早于子组件异步加载完成的转码;挂在各 Canvas 里、且尽量靠前。 */
export function Ktx2Detect(): null {
  const gl = useThree((s) => s.gl);
  useMemo(() => {
    if (_detected || !gl) return;
    try { getKtx2Loader().detectSupport(gl as never); _detected = true; } catch { /* noop */ }
  }, [gl]);
  return null;
}
