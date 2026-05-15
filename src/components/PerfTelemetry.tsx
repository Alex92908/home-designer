"use client";

/**
 * PerfTelemetry — Three.js performance telemetry component (dev only).
 *
 * 挂在 Canvas 内（必须是 R3F 的子组件，用 useThree 拿 renderer info）。
 * 每秒采样一次：
 *   - renderer.info.render.calls   (draw calls)
 *   - renderer.info.render.triangles
 *   - renderer.info.memory.geometries / textures
 *   - scene.children mesh 数量
 *   - frame time (P50 / P95 — 用 ring buffer)
 *   - JS heap (performance.memory，仅 Chrome)
 *
 * 数据挂在 window.__PERF__ 上，可用 javascript_tool 抓取。
 * 同时每 5 秒在 console.log 打印一行汇总。
 *
 * 用法：在 <Canvas> 子级里加 <PerfTelemetry label="exterior" />
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

declare global {
  interface Window {
    __PERF__?: PerfSnapshot;
    __PERF_HISTORY__?: PerfSnapshot[];
    /** 在控制台手动调用 dumpPerf() 拿 JSON 历史 */
    dumpPerf?: () => string;
    /** 重置历史以方便单独测某个场景 */
    resetPerf?: () => void;
  }
}

interface PerfSnapshot {
  label: string;
  timestamp: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  meshCount: number;
  sceneObjectCount: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsMax: number;
  fps: number;
  jsHeapMB: number | null;
}

const FRAME_BUFFER_SIZE = 120;  // 2 秒 @ 60fps 的样本量

export default function PerfTelemetry({ label = "scene" }: { label?: string }) {
  const { gl, scene } = useThree();
  const frameRef = useRef<number[]>([]);
  const lastFrameRef = useRef<number>(performance.now());
  const lastReportRef = useRef<number>(performance.now());

  // Disable in production
  const enabled = typeof window !== "undefined" && process.env.NODE_ENV !== "production";

  useFrame(() => {
    if (!enabled) return;
    const now = performance.now();
    const dt = now - lastFrameRef.current;
    lastFrameRef.current = now;
    const buf = frameRef.current;
    buf.push(dt);
    if (buf.length > FRAME_BUFFER_SIZE) buf.shift();

    // Sample every ~1s
    if (now - lastReportRef.current < 1000) return;
    lastReportRef.current = now;

    // Compute P50/P95
    const sorted = [...buf].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.50)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const maxMs = sorted[sorted.length - 1] ?? 0;
    const avg = buf.reduce((a, b) => a + b, 0) / Math.max(1, buf.length);

    // Count meshes (recursive)
    let meshCount = 0, sceneObjectCount = 0;
    scene.traverse((o) => {
      sceneObjectCount++;
      // @ts-expect-error isMesh exists at runtime
      if (o.isMesh) meshCount++;
    });

    // Read renderer info
    const info = gl.info;
    const jsHeapMB =
      // @ts-expect-error performance.memory is Chrome-only
      typeof performance.memory !== "undefined"
        // @ts-expect-error performance.memory.usedJSHeapSize
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null;

    const snap: PerfSnapshot = {
      label,
      timestamp: Date.now(),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      meshCount,
      sceneObjectCount,
      frameMsP50: +p50.toFixed(2),
      frameMsP95: +p95.toFixed(2),
      frameMsMax: +maxMs.toFixed(2),
      fps: avg > 0 ? +(1000 / avg).toFixed(1) : 0,
      jsHeapMB,
    };

    if (typeof window !== "undefined") {
      window.__PERF__ = snap;
      const hist = window.__PERF_HISTORY__ ?? [];
      hist.push(snap);
      if (hist.length > 60) hist.shift();
      window.__PERF_HISTORY__ = hist;

      // Throttle console log to 5s
      // @ts-expect-error attach private last-log timestamp
      const lastLog = window.__PERF_LAST_LOG__ ?? 0;
      if (now - lastLog > 5000) {
        // @ts-expect-error attach private last-log timestamp
        window.__PERF_LAST_LOG__ = now;
        // eslint-disable-next-line no-console
        console.log(
          `[PERF ${label}] fps=${snap.fps} ` +
          `draws=${snap.drawCalls} ` +
          `tris=${snap.triangles.toLocaleString()} ` +
          `mesh=${snap.meshCount}/${snap.sceneObjectCount} ` +
          `frameMs p50=${snap.frameMsP50} p95=${snap.frameMsP95} ` +
          `geo=${snap.geometries} tex=${snap.textures}` +
          (snap.jsHeapMB ? ` heap=${snap.jsHeapMB}MB` : "")
        );
      }
    }
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    window.dumpPerf = () => JSON.stringify(window.__PERF_HISTORY__ ?? [], null, 2);
    window.resetPerf = () => { window.__PERF_HISTORY__ = []; };
    // eslint-disable-next-line no-console
    console.log(
      `[PERF ${label}] telemetry started — ` +
      `read window.__PERF__, window.__PERF_HISTORY__, ` +
      `call dumpPerf() / resetPerf()`
    );
    return () => {
      // eslint-disable-next-line no-console
      console.log(`[PERF ${label}] telemetry stopped`);
    };
  }, [enabled, label]);

  return null;
}
