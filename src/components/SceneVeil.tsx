"use client";

/**
 * SceneVeil —— 3D 视图加载幕布。
 *
 * 三维视图切换时有一段"什么都看不见"的窗口：dynamic() 的 loading 只盖住
 * chunk 下载；drei <Loader> 只盖住 DefaultLoadingManager 里的资产下载；但
 * 场景图构建 / Draco 解码 / 首帧 shader 编译这些主线程重活期间画布是纯白/
 * 纯灰的，观众（尤其录屏时）以为卡死了。
 *
 * 用法：DOM 侧挂 <SceneVeil ready={sceneReady} label="正在构建 3D 场景" />
 * （与 <Canvas> 同层级），Canvas 内挂 <FirstFrameNotifier onReady={...} />，
 * 首帧真正画出来后幕布淡出。幕布在 Canvas 挂载的同一提交里就绘制，因此重活
 * 开始前用户已经看到品牌加载画面。
 */
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

/** Canvas 内组件：第一帧渲染完成后回调一次。 */
export function FirstFrameNotifier({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    // 等这一帧真正提交到屏幕后再通知（下一宏任务）。
    setTimeout(onReady, 0);
  });
  return null;
}

export default function SceneVeil({ ready, label }: { ready: boolean; label: string }) {
  // ready 翻 true 后先播淡出动画，再从 DOM 移除。（ready 在本组件生命周期内
  // 只会 false→true 一次——视图卸载重挂时组件整个重建，无需反向重置。）
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 450);
    return () => clearTimeout(t);
  }, [ready]);
  if (gone) return null;
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center pointer-events-none select-none"
      style={{
        background: "linear-gradient(160deg, #0f1117 0%, #171B26 100%)",
        opacity: ready ? 0 : 1,
        transition: "opacity 0.45s ease",
      }}
    >
      {/* 品牌标 + 呼吸动画 */}
      <div style={{ animation: "zy-veil-pulse 1.6s ease-in-out infinite" }}
        className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
          style={{ background: "linear-gradient(135deg,#007AFF,#5856D6)", boxShadow: "0 8px 32px rgba(0,122,255,0.35)" }}>
          🏠
        </div>
        <div className="text-white/90 text-sm font-bold tracking-widest">筑雅 ZHUYA</div>
        <div className="text-white/50 text-xs">{label}…</div>
      </div>
      {/* 底部细进度暗示（不承诺百分比，纯节奏感） */}
      <div className="mt-6 w-40 h-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.12)" }}>
        <div style={{
          width: "40%", height: "100%", background: "#2dd4bf", borderRadius: 2,
          animation: "zy-veil-slide 1.2s ease-in-out infinite",
        }} />
      </div>
      <style>{`
        @keyframes zy-veil-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.75; transform: scale(0.97); } }
        @keyframes zy-veil-slide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
      `}</style>
    </div>
  );
}
