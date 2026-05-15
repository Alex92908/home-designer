"use client";

/**
 * PerfTelemetry — Three.js performance telemetry component (dev only).
 *
 * Mount inside <Canvas>. 每 1 秒（setInterval，独立于 frameloop）采样一次：
 *   - renderer.info.render.calls   (draw calls)
 *   - renderer.info.render.triangles
 *   - renderer.info.memory.geometries / textures
 *   - scene mesh / object 数量
 *   - frame time P50/P95（useFrame 统计实际渲染的帧间隔，frameloop=demand
 *     下也能准确反映 idle 时 "FPS=0" 的情况）
 *   - JS heap (performance.memory，仅 Chrome)
 *
 * 数据挂在 window.__PERF__ 上。每 5s console.log 一行汇总。
 *
 * 用法：在 <Canvas> 子级里加 <PerfTelemetry label="exterior" />
 */

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";

declare global {
  interface Window {
    __PERF__?: PerfSnapshot;
    __PERF_HISTORY__?: PerfSnapshot[];
    dumpPerf?: () => string;
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
  framesInWindow: number;    // renders during the last 1s
  frameMsP50: number;
  frameMsP95: number;
  frameMsMax: number;
  fps: number;
  jsHeapMB: number | null;
}

const SAMPLE_INTERVAL_MS = 1000;

export default function PerfTelemetry({ label = "scene" }: { label?: string }) {
  const { gl, scene, camera } = useThree();
  // Expose camera globally for debugging — read via window.__cam.position
  if (typeof window !== "undefined") {
    (window as unknown as { __cam?: unknown }).__cam = camera;
  }
  // 用 gl.info.render.frame 计数器代替 useFrame（frameloop=demand 下后者不
  // 触发，但 frame counter 仍随每次 .render() 递增）。
  const lastFrameCountRef = useRef<number>(0);
  const lastSampleAtRef = useRef<number>(performance.now());

  const enabled = typeof window !== "undefined" && process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    window.dumpPerf = () => JSON.stringify(window.__PERF_HISTORY__ ?? [], null, 2);
    window.resetPerf = () => { window.__PERF_HISTORY__ = []; };

    // eslint-disable-next-line no-console
    console.log(
      `[PERF ${label}] telemetry started — ` +
      `window.__PERF__ / dumpPerf() / resetPerf()`
    );

    lastFrameCountRef.current = gl.info.render.frame;

    let lastLog = 0;
    const tick = () => {
      const now = performance.now();
      const dtWindow = now - lastSampleAtRef.current;
      lastSampleAtRef.current = now;

      // Frame delta from renderer.info.render.frame —— 比 useFrame 更可靠
      const currentFrameCount = gl.info.render.frame;
      const framesInWindow = currentFrameCount - lastFrameCountRef.current;
      lastFrameCountRef.current = currentFrameCount;

      const fps = +(framesInWindow * 1000 / dtWindow).toFixed(1);
      // 没有 per-frame interval 数据时，估算平均帧时间（dtWindow/frames）
      const p50 = framesInWindow > 0 ? +(dtWindow / framesInWindow).toFixed(2) : 0;
      const p95 = p50;  // 没有分布信息，先用平均值占位
      const maxMs = p50;

      let meshCount = 0, sceneObjectCount = 0;
      scene.traverse((o) => {
        sceneObjectCount++;
        // @ts-expect-error isMesh exists at runtime
        if (o.isMesh) meshCount++;
      });

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
        framesInWindow,
        frameMsP50: +p50.toFixed(2),
        frameMsP95: +p95.toFixed(2),
        frameMsMax: +maxMs.toFixed(2),
        fps,
        jsHeapMB,
      };

      window.__PERF__ = snap;
      const hist = window.__PERF_HISTORY__ ?? [];
      hist.push(snap);
      if (hist.length > 120) hist.shift();
      window.__PERF_HISTORY__ = hist;

      if (now - lastLog > 5000) {
        lastLog = now;
        // eslint-disable-next-line no-console
        console.log(
          `[PERF ${label}] fps=${snap.fps} ` +
          `frames/s=${framesInWindow} ` +
          `draws=${snap.drawCalls} ` +
          `tris=${snap.triangles.toLocaleString()} ` +
          `mesh=${snap.meshCount}/${snap.sceneObjectCount} ` +
          `frameMs p50=${snap.frameMsP50} p95=${snap.frameMsP95} ` +
          `geo=${snap.geometries} tex=${snap.textures}` +
          (snap.jsHeapMB ? ` heap=${snap.jsHeapMB}MB` : "")
        );
      }
    };

    const id = window.setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      // eslint-disable-next-line no-console
      console.log(`[PERF ${label}] telemetry stopped`);
    };
  }, [enabled, label, gl, scene]);

  return null;
}
