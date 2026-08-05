"use client";
// 临时诊断 HUD:屏幕左上角常驻,显示**全部**内存口径,定位真机 OOM。验证完删。
//
// iOS Safari 不给 performance.memory(读不到 JS 堆),但杀页的那部分内存是**我们自己
// 分配的**,可以自己算 —— 本 HUD 用四个 iOS 也能读的口径把它拼出来:
//   ① GPU 纹理(按 format 区分 ASTC ~1bpp / RGBA 4bpp)
//   ② 几何(BufferGeometry 属性数组;注意 three 默认 CPU+GPU **各留一份**)
//   ③ CPU 残留贴图(上传后 JS 侧仍持有的 image / mipmaps —— 双份占用的那一份)
//   ④ GLB/贴图**下载解码字节**(PerformanceResourceTiming.decodedBodySize,同源可读)
//      → loader 缓存(useGLTF/suspend-react)持有的源数据量,JS 堆大头之一
//   外加帧缓冲(drawingBuffer 尺寸 × 8B;dpr/antialias 是否真生效一眼可见)。
import { useThree } from "@react-three/fiber";
import { useEffect, useSyncExternalStore } from "react";
import { estimateSceneMemoryMB } from "@/lib/sceneMemory";

type Diag = {
  texN?: number; geoN?: number; calls?: number; tris?: number; programs?: number;
  geoMB: number; texMB: number; totalMB: number;
  astc: number; rgba: number; sample: string[];
  cpuTexMB: number; cpuTexN: number;
  dpr?: number; fbW?: number; fbH?: number; fbMB?: number;
  heapMB?: number; heapLimitMB?: number;
  netMB: number; netN: number; netGlbMB: number;
  grand: number;
};
let _diag: Diag = {
  geoMB: 0, texMB: 0, totalMB: 0, astc: 0, rgba: 0, sample: [],
  cpuTexMB: 0, cpuTexN: 0, netMB: 0, netN: 0, netGlbMB: 0, grand: 0,
};
const _subs = new Set<() => void>();

// ── HUD 开关(按钮控制,localStorage 持久化;关掉时连扫描都不跑,零开销)──────
let _open = (() => {
  try { return localStorage.getItem("zy_memhud") === "1"; } catch { return false; }
})();
const _openSubs = new Set<() => void>();
/** 由顶栏 ⚙ 设置菜单调用,开关内存面板。 */
export function setMemHudOpen(v: boolean) {
  _open = v;
  try { localStorage.setItem("zy_memhud", v ? "1" : "0"); } catch { /* ignore */ }
  _openSubs.forEach((f) => f());
}
/** 内存面板当前是否展开(顶栏菜单读它显示勾选态)。 */
export function useMemHudOpen(): boolean {
  return useSyncExternalStore(
    (cb) => { _openSubs.add(cb); return () => { _openSubs.delete(cb); }; },
    () => _open,
    () => false,
  );
}
const useOpen = useMemHudOpen;

/** 已下载并解码的资源字节(GLB/贴图)—— loader 缓存持有的源数据量,iOS 也能读。 */
function scanNetwork(): { netMB: number; netN: number; netGlbMB: number } {
  try {
    const es = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    let bytes = 0, glbBytes = 0, n = 0;
    for (const e of es) {
      if (!/\.(glb|gltf|ktx2|png|jpe?g|webp|bin)(\?|$)/i.test(e.name)) continue;
      const b = e.decodedBodySize || e.transferSize || 0;
      bytes += b; n++;
      if (/\.(glb|gltf)(\?|$)/i.test(e.name)) glbBytes += b;
    }
    return { netMB: bytes / 1048576, netN: n, netGlbMB: glbBytes / 1048576 };
  } catch { return { netMB: 0, netN: 0, netGlbMB: 0 }; }
}

export function SceneDiag(): null {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const open = useOpen();
  // ⚠️ 用定时器而非 useFrame:外观 Canvas 是 frameloop="demand",静止时 useFrame 不 tick
  //    → 面板数值会一直是 0。定时器不依赖帧循环,四个画布通用。收起时不注册,零开销。
  useEffect(() => {
    if (!open) return;
    const scan = () => {
    const m = estimateSceneMemoryMB(scene);
    const cv = gl.domElement as HTMLCanvasElement;
    const fbW = cv.width, fbH = cv.height;
    const fbMB = (fbW * fbH * 8) / 1048576; // color(4)+depth(4);antialias:false 无 MSAA 倍数
    const perf = (performance as unknown as {
      memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
    }).memory;
    const net = scanNetwork();
    const grand = m.totalMB + m.cpuTexMB + fbMB + net.netMB;
    _diag = {
      texN: gl.info.memory?.textures, geoN: gl.info.memory?.geometries,
      calls: gl.info.render?.calls, tris: gl.info.render?.triangles,
      programs: gl.info.programs?.length,
      geoMB: Math.round(m.geoMB), texMB: Math.round(m.texMB), totalMB: Math.round(m.totalMB),
      astc: m.astc, rgba: m.rgba, sample: m.sample,
      cpuTexMB: Math.round(m.cpuTexMB), cpuTexN: m.cpuTexN,
      dpr: Math.round((gl.getPixelRatio?.() ?? 0) * 100) / 100, fbW, fbH, fbMB: Math.round(fbMB),
      heapMB: perf?.usedJSHeapSize ? Math.round(perf.usedJSHeapSize / 1048576) : undefined,
      heapLimitMB: perf?.jsHeapSizeLimit ? Math.round(perf.jsHeapSizeLimit / 1048576) : undefined,
      netMB: Math.round(net.netMB), netN: net.netN, netGlbMB: Math.round(net.netGlbMB),
      grand: Math.round(grand),
    };
    _subs.forEach((f) => f());
    };
    scan();
    const id = setInterval(scan, 800);
    return () => clearInterval(id);
  }, [open, gl, scene]);
  return null;
}

export function SceneDiagHUD(): React.ReactElement {
  const open = useOpen();
  const d = useSyncExternalStore(
    (cb) => { _subs.add(cb); return () => { _subs.delete(cb); }; },
    () => _diag,
    () => _diag,
  );
  // 开关收在顶栏 ⚙ 设置菜单里(见 TopBar),这里只负责面板本身。
  return (
    <>
      {open && (
        <div style={{
          // 用 absolute 相对**画布容器**(各 Canvas 外层都是 w-full h-full relative)定位,
          // 而不是 fixed 相对视口 —— fixed 会随视口固定,左侧房间栏展开时被压住(用户实拍)。
          // 贴画布自身左上角:天然避开顶栏和左栏,栏收起/展开都不重叠。
          position: "absolute", top: 8, left: 8, zIndex: 30,
          background: "rgba(0,0,0,0.82)", color: "#0f0", font: "11px/1.35 monospace",
          padding: "5px 7px", borderRadius: 5, pointerEvents: "none", whiteSpace: "pre",
          maxWidth: "calc(100vw - 8px)", overflow: "hidden",
        }}>
          {`【合计 ${d.grand} MB】= GPU ${d.totalMB} + CPU贴图 ${d.cpuTexMB} + 帧缓冲 ${d.fbMB ?? "-"} + 已下载 ${d.netMB}
GPU 纹理 ${d.texMB}MB   几何 ${d.geoMB}MB (CPU+GPU各一份)
  压缩ASTC ${d.astc} / RGBA未压 ${d.rgba}
CPU残留贴图 ${d.cpuTexMB}MB (${d.cpuTexN}张未释放)
已下载解码 ${d.netMB}MB (${d.netN}个, 其中GLB ${d.netGlbMB}MB)
帧缓冲 ${d.fbW ?? "-"}x${d.fbH ?? "-"} = ${d.fbMB ?? "-"}MB   dpr ${d.dpr ?? "-"}
JS堆 ${typeof d.heapMB === "number" ? `${d.heapMB}MB / 上限 ${d.heapLimitMB}MB` : "iOS读不到(用上面合计)"}
info.tex ${d.texN ?? "-"}  geo ${d.geoN ?? "-"}  prog ${d.programs ?? "-"}
draw ${d.calls ?? "-"}  tris ${(d.tris ?? 0).toLocaleString()}
样本 ${d.sample.join(" ")}`}
        </div>
      )}
    </>
  );
}
