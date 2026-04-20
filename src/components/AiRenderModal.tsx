"use client";

import { useEffect, useRef, useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { generateRoomPrompt } from "@/lib/roomPrompt";
import { generateControlNetWorkflow, generateTxt2ImgWorkflow } from "@/lib/comfyWorkflow";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = "controlnet" | "txt2img" | "multicontrolnet" | "ipadapter-chain";
type Phase = "idle" | "submitting" | "generating" | "done" | "error";

const POLL_INTERVAL = 2500; // ms

interface AnglePreset {
  id: string;
  label: string;
  icon: string;
  getPos:    (W: number, D: number, H: number) => [number, number, number];
  getLookAt: (W: number, D: number, H: number) => [number, number, number];
}

const ANGLE_PRESETS: AnglePreset[] = [
  {
    id: "front-right",
    label: "右前角 45°",
    icon: "↗",
    getPos:    (W, D, H) => [ W * 0.40,  H * 0.50,  D * 0.40],
    getLookAt: (W, D, H) => [-W * 0.10,  H * 0.20, -D * 0.25],
  },
  {
    id: "front-left",
    label: "左前角 45°",
    icon: "↖",
    getPos:    (W, D, H) => [-W * 0.40,  H * 0.50,  D * 0.40],
    getLookAt: (W, D, H) => [ W * 0.10,  H * 0.20, -D * 0.25],
  },
  {
    id: "front-center",
    label: "正面偏右",
    icon: "→",
    getPos:    (W, D, H) => [ W * 0.18,   H * 0.45,  D * 0.38],
    getLookAt: (W, D, H) => [-W * 0.05,   H * 0.20, -D * 0.30],
  },
  {
    id: "aerial",
    label: "鸟瞰",
    icon: "↓",
    getPos:    (W, D, H) => [ W * 0.20,   H * 1.60,  D * 0.50],
    getLookAt: (_W, _D, _H) => [ 0,        0,          0        ],
  },
];

// ─── Helper: download JSON file ──────────────────────────────
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Helper: download data-URL as PNG ────────────────────────
function downloadDataUrl(dataUrl: string, filename: string) {
  const a    = document.createElement("a");
  a.href     = dataUrl;
  a.download = filename;
  a.click();
}

export default function AiRenderModal({ open, onClose }: Props) {
  // Store — grab current room data for prompt generation
  const floorPlans        = useDesignerStore(s => s.floorPlans);
  const activeFloor       = useDesignerStore(s => s.activeFloor);
  const activeRoom        = useDesignerStore(s => s.activeRoom);
  const cameraAndCapture  = useDesignerStore(s => s.cameraAndCapture);

  // Local state
  const [screenshot,     setScreenshot]     = useState<string | null>(null);
  const [comfyAvailable, setComfyAvailable] = useState<boolean | null>(null);
  const [mode,           setMode]           = useState<Mode>("controlnet");
  const [phase,          setPhase]          = useState<Phase>("idle");
  const [resultUrl,      setResultUrl]      = useState<string | null>(null);
  const [error,          setError]          = useState<string | null>(null);
  const [elapsed,        setElapsed]        = useState(0);
  const [selectedAngle, setSelectedAngle] = useState<string>("front-right");
  // Chain mode: selected angles (multi), gallery results, progress
  const [chainAngles,  setChainAngles]  = useState<string[]>(["front-right", "front-left"]);
  const [chainResults, setChainResults] = useState<string[]>([]);  // image URLs
  const [chainIndex,   setChainIndex]   = useState(0);             // current angle index being rendered

  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const promptRef = useRef<string | null>(null);

  // ── Reset on close ──────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      clearInterval(pollRef.current ?? undefined);
      clearInterval(timerRef.current ?? undefined);
      setScreenshot(null);
      setComfyAvailable(null);
      setPhase("idle");
      setResultUrl(null);
      setError(null);
      setElapsed(0);
      setSelectedAngle("front-right");
      setChainAngles(["front-right", "front-left"]);
      setChainResults([]);
      setChainIndex(0);
      promptRef.current = null;
      return;
    }

    // Capture default angle preview (or fallback to raw canvas)
    const t = setTimeout(() => {
      // Try programmatic angle capture first
      const store = useDesignerStore.getState();
      const fn = store.cameraAndCapture;
      if (fn) {
        const fp   = store.floorPlans[store.activeFloor];
        const dims = fp?.roomDimensions?.[store.activeRoom];
        const W = (dims?.width  ?? 500) / 100;
        const D = (dims?.depth  ?? 400) / 100;
        const H = 2.8;
        const preset = ANGLE_PRESETS.find(a => a.id === "front-right")!;
        const shot = fn(preset.getPos(W, D, H), preset.getLookAt(W, D, H));
        if (shot) { setScreenshot(shot); return; }
      }
      // Fallback: snapshot current canvas view
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      if (!canvas) return;
      try {
        setScreenshot(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        // preserveDrawingBuffer might not be set — soft fail
      }
    }, 80);

    // Check ComfyUI health
    fetch("/api/comfyui/health")
      .then(r => r.json())
      .then((d: { available: boolean }) => setComfyAvailable(d.available))
      .catch(() => setComfyAvailable(false));

    return () => clearTimeout(t);
  }, [open]);

  // ── Get current room data for prompt generation ─────────────
  function getCurrentRoomData() {
    const fp   = floorPlans[activeFloor];
    if (!fp) return null;
    const room = fp.rooms[activeRoom];
    const dims = fp.roomDimensions?.[activeRoom];
    const wins = fp.roomWindows?.[activeRoom] ?? [];
    if (!room) return null;

    return {
      roomType:    activeRoom,
      width:       dims?.width  ?? 500,
      depth:       dims?.depth  ?? 400,
      height:      280,
      materials:   room.materials ?? {},
      placedItems: (room.placedItems ?? []).map(p => ({
        furnitureId: p.furnitureId,
        x:           p.x,
        z:           p.z,
        rotation:    p.rotation,
      })),
      windows: wins.map(w => ({ wall: w.wall, len: w.len, pos: w.pos })),
    };
  }

  // ── Get room dimensions in meters ──────────────────────────
  function getRoomDims() {
    const fp   = floorPlans[activeFloor];
    const dims = fp?.roomDimensions?.[activeRoom];
    return {
      W: (dims?.width  ?? 500) / 100,
      D: (dims?.depth  ?? 400) / 100,
      H: 2.8,
    };
  }

  // ── Capture a specific angle → returns data URL ──────────────
  function capturePreset(presetId: string): string | null {
    if (!cameraAndCapture) return null;
    const { W, D, H } = getRoomDims();
    const preset = ANGLE_PRESETS.find(a => a.id === presetId)!;
    return cameraAndCapture(preset.getPos(W, D, H), preset.getLookAt(W, D, H));
  }

  // ── Select angle + immediately update preview ─────────────────
  function handleSelectAngle(presetId: string) {
    setSelectedAngle(presetId);
    const shot = capturePreset(presetId);
    if (shot) setScreenshot(shot);
  }

  // ── Chain mode: toggle angle in multi-select list ────────────
  function toggleChainAngle(presetId: string) {
    setChainAngles(prev => {
      if (prev.includes(presetId)) {
        return prev.length > 1 ? prev.filter(a => a !== presetId) : prev;
      }
      return prev.length >= 4 ? prev : [...prev, presetId];   // cap at 4
    });
  }

  // ── Fetch image URL → data URL (needed to pass as reference) ─
  async function urlToDataUrl(url: string): Promise<string> {
    const res  = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  // ── Submit one step of the chain, poll until done, return image URL ─
  async function renderChainStep(params: {
    screenshot: string;
    referenceImages?: string[];   // 0 = first frame, 1 = single-ref, 2-5 = multi-ref blend
    seed: number;
    roomData: ReturnType<typeof getCurrentRoomData>;
  }): Promise<string> {
    const res = await fetch("/api/comfyui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshot:      params.screenshot,
        referenceImages: params.referenceImages,
        seed:            params.seed,
        roomData:        params.roomData,
        mode:            "ipadapter-chain",
      }),
    });
    const data = await res.json() as { promptId?: string; error?: string };
    if (!res.ok || !data.promptId) throw new Error(data.error ?? "submit_failed");

    // Poll until this step completes
    return await new Promise<string>((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const r = await fetch(`/api/comfyui/status?id=${data.promptId}`);
          const s = await r.json() as { status: string; filename?: string; subfolder?: string; type?: string };
          if (s.status === "done" && s.filename) {
            clearInterval(iv);
            resolve(`/api/comfyui/image?filename=${encodeURIComponent(s.filename)}&subfolder=${encodeURIComponent(s.subfolder ?? "")}&type=${s.type ?? "output"}`);
          } else if (s.status === "error") {
            clearInterval(iv);
            reject(new Error("comfy_step_error"));
          }
        } catch (err) {
          clearInterval(iv);
          reject(err);
        }
      }, POLL_INTERVAL);
    });
  }

  // ── Start chain rendering: render selected angles sequentially ─
  async function startChainRender() {
    if (!cameraAndCapture) return;
    const { W, D, H } = getRoomDims();
    const roomData    = getCurrentRoomData();
    const seed        = Math.floor(Math.random() * 2 ** 31);

    setPhase("submitting");
    setError(null);
    setChainResults([]);
    setChainIndex(0);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    try {
      const resultUrls:    string[] = [];   // for UI / download
      const resultDataUrls:string[] = [];   // for re-feeding as references

      for (let i = 0; i < chainAngles.length; i++) {
        setChainIndex(i);
        setPhase("generating");
        const angleId = chainAngles[i];
        const preset  = ANGLE_PRESETS.find(a => a.id === angleId)!;
        const shotUrl = cameraAndCapture(preset.getPos(W, D, H), preset.getLookAt(W, D, H));

        // Reference strategy:
        //  - First frame: no refs (establishes the look)
        //  - Aerial frame: ALL previous frames blended → style fingerprint only
        //                   (geometry can't align between aerial vs eye-level)
        //  - Other frames: just the previous frame (single ref, strong geom+style match)
        let refs: string[] = [];
        if (i > 0) {
          refs = angleId === "aerial"
            ? resultDataUrls.slice(0, 5)                        // multi-ref blend
            : [resultDataUrls[resultDataUrls.length - 1]];       // single-ref
        }

        const imgUrl = await renderChainStep({
          screenshot:      shotUrl,
          referenceImages: refs,
          seed,
          roomData,
        });

        resultUrls.push(imgUrl);
        setChainResults([...resultUrls]);

        // Convert this output for next iteration's reference pool (skip on last)
        if (i < chainAngles.length - 1) {
          resultDataUrls.push(await urlToDataUrl(imgUrl));
        }
      }

      clearInterval(timerRef.current ?? undefined);
      setPhase("done");
    } catch (err) {
      clearInterval(timerRef.current ?? undefined);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`链式渲染失败：${msg}`);
      setPhase("error");
    }
  }

  // ── Start ComfyUI render ─────────────────────────────────────
  async function startRender() {
    if (phase !== "idle") return;
    // Chain mode has its own orchestrator
    if (mode === "ipadapter-chain") { return startChainRender(); }
    const needsShot = mode === "controlnet" || mode === "multicontrolnet";
    if (needsShot && !cameraAndCapture && !screenshot) return;
    setPhase("submitting");
    setError(null);
    setResultUrl(null);
    setElapsed(0);

    try {
      const roomData = getCurrentRoomData();

      // For controlnet / multicontrolnet: capture the selected angle
      const needsCapture = (mode === "controlnet" || mode === "multicontrolnet") && cameraAndCapture;
      const capturedShot = needsCapture ? capturePreset(selectedAngle) : null;
      const body = { screenshot: capturedShot ?? screenshot, roomData, mode };

      const res = await fetch("/api/comfyui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json() as { promptId?: string; error?: string };
      if (!res.ok || !data.promptId) {
        throw new Error(data.error ?? "submit_failed");
      }

      promptRef.current = data.promptId;
      setPhase("generating");

      // Elapsed timer
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

      // Poll for completion
      pollRef.current = setInterval(async () => {
        const sid  = promptRef.current;
        if (!sid) return;
        const sres = await fetch(`/api/comfyui/status?id=${sid}`);
        const sdata = await sres.json() as { status: string; filename?: string; subfolder?: string; type?: string };

        if (sdata.status === "done" && sdata.filename) {
          clearInterval(pollRef.current ?? undefined);
          clearInterval(timerRef.current ?? undefined);
          const imgUrl = `/api/comfyui/image?filename=${encodeURIComponent(sdata.filename)}&subfolder=${encodeURIComponent(sdata.subfolder ?? "")}&type=${sdata.type ?? "output"}`;
          setResultUrl(imgUrl);
          setPhase("done");
        } else if (sdata.status === "error") {
          clearInterval(pollRef.current ?? undefined);
          clearInterval(timerRef.current ?? undefined);
          setError("ComfyUI 任务出错，请检查 ComfyUI 控制台");
          setPhase("error");
        }
      }, POLL_INTERVAL);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`提交失败：${msg}`);
      setPhase("error");
    }
  }

  // ── Download result image ────────────────────────────────────
  async function downloadResult() {
    if (!resultUrl) return;
    const res  = await fetch(resultUrl);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `hd_render_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Download workflow for offline use ────────────────────────
  function downloadWorkflow(wfMode: "controlnet" | "txt2img") {
    const roomData = getCurrentRoomData();
    const prompt   = roomData
      ? generateRoomPrompt(roomData)
      : {
          roomType: "living room",
          roomName: "living room",
          positive: "RAW photo, photorealistic, ultra-detailed 8K, professional interior design photography, modern living room, wide-angle lens, no people",
          negative: "people, cartoon, low quality, blurry, 3D render",
          seed:     Math.floor(Math.random() * 2 ** 31),
        };

    const workflow = wfMode === "controlnet"
      ? generateControlNetWorkflow("your_screenshot.png", prompt)
      : generateTxt2ImgWorkflow(prompt);

    downloadJson(workflow, `home_designer_${wfMode}_workflow.json`);
  }

  if (!open) return null;

  const busy    = phase === "submitting" || phase === "generating";
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <div
      className="fixed inset-0 z-[8888] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        className="bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(680px, 100%)", maxHeight: "92vh" }}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">🎨</span>
            <h2 className="text-sm font-bold text-gray-800">AI 效果图生成</h2>
            {comfyAvailable === true && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: "#d1fae5", color: "#065f46" }}>
                ComfyUI ● 本地
              </span>
            )}
            {comfyAvailable === false && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: "#fee2e2", color: "#991b1b" }}>
                ComfyUI 未运行
              </span>
            )}
            {comfyAvailable === null && (
              <span className="text-[10px] text-gray-400">检测中…</span>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-30"
          >✕</button>
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-4">

          {/* Camera angle tip */}
          {phase === "idle" && comfyAvailable === true && (mode === "controlnet" || mode === "multicontrolnet") && (
            <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
              style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
              <span className="text-base shrink-0 mt-0.5">📐</span>
              <p className="text-[11px] text-amber-700 leading-relaxed">
                {cameraAndCapture
                  ? <><span className="font-semibold">已自动定位到所选角度</span>，可直接点击生成</>
                  : <><span className="font-semibold">建议先调整3D视角再生成</span>
                    ：将相机旋转至 <span className="font-semibold">45° 左右俯角</span>，确保地面和墙面同时可见，ControlNet 深度图效果最佳。</>
                }
              </p>
            </div>
          )}

          {/* ── ComfyUI available: mode selector ── */}
          {comfyAvailable === true && phase === "idle" && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-2 uppercase tracking-wider">
                渲染模式
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: "controlnet",       icon: "✦",  title: "ControlNet",  desc: "深度图空间控制" },
                  { id: "multicontrolnet",  icon: "✦✦", title: "多重控制",    desc: "深度+边缘+法线" },
                  { id: "ipadapter-chain",  icon: "⛓",  title: "链式多视角",  desc: "多角度一致生成" },
                  { id: "txt2img",          icon: "✎",  title: "文生图",      desc: "纯 prompt" },
                ] as { id: Mode; icon: string; title: string; desc: string }[]).map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className="py-3 px-3 rounded-xl border text-left transition-all"
                    style={{
                      borderColor: mode === m.id ? "#6366f1" : "#e5e7eb",
                      background:  mode === m.id ? "#eef2ff" : "#fafafa",
                    }}
                  >
                    <div className="text-xs font-semibold"
                      style={{ color: mode === m.id ? "#4f46e5" : "#374151" }}>
                      {m.icon} {m.title}
                    </div>
                    <div className="text-[10px] mt-0.5"
                      style={{ color: mode === m.id ? "#6366f1" : "#9ca3af" }}>
                      {m.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Angle picker (single-view modes) — single select ── */}
          {comfyAvailable === true && phase === "idle" && (mode === "controlnet" || mode === "multicontrolnet") && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
                拍摄角度
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ANGLE_PRESETS.map(preset => {
                  const active = selectedAngle === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleSelectAngle(preset.id)}
                      className="py-3 px-3 rounded-xl border text-left transition-all relative"
                      style={{
                        borderColor: active ? "#6366f1" : "#e5e7eb",
                        background:  active ? "#eef2ff" : "#fafafa",
                      }}
                    >
                      {active && (
                        <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full"
                          style={{ background: "#6366f1" }} />
                      )}
                      <div className="text-xs font-semibold"
                        style={{ color: active ? "#4f46e5" : "#374151" }}>
                        {preset.icon} {preset.label}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                右前角 45° 或左前角 45° 综合展示墙面与地面，效果最佳
              </p>
            </div>
          )}

          {/* ── Chain mode angle picker (multi-select, max 4) ── */}
          {comfyAvailable === true && phase === "idle" && mode === "ipadapter-chain" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                  拍摄角度 <span className="normal-case text-gray-300">（最多 4 个）</span>
                </p>
                <span className="text-[10px] text-indigo-400 font-medium">
                  已选 {chainAngles.length} / 4
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ANGLE_PRESETS.map(preset => {
                  const active = chainAngles.includes(preset.id);
                  const order  = chainAngles.indexOf(preset.id) + 1;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => toggleChainAngle(preset.id)}
                      className="py-3 px-3 rounded-xl border text-left transition-all relative"
                      style={{
                        borderColor: active ? "#6366f1" : "#e5e7eb",
                        background:  active ? "#eef2ff" : "#fafafa",
                      }}
                    >
                      {active && (
                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full text-[10px] flex items-center justify-center text-white font-bold"
                          style={{ background: "#6366f1" }}>{order}</span>
                      )}
                      <div className="text-xs font-semibold"
                        style={{ color: active ? "#4f46e5" : "#374151" }}>
                        {preset.icon} {preset.label}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                按数字顺序生成。普通视角参考前一张，鸟瞰会综合前面所有视角的色彩材质（建议放最后）。单张约 3-8 分钟。
              </p>
            </div>
          )}

          {/* Screenshot preview */}
          {screenshot && phase !== "done" && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                当前3D截图
              </p>
              <img
                src={screenshot}
                className="w-full rounded-xl object-cover border border-gray-100"
                style={{ maxHeight: 200 }}
                alt="3D截图"
              />
            </div>
          )}

          {/* Generating — progress indicator */}
          {(phase === "submitting" || phase === "generating") && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin" />
              <p className="text-sm font-medium text-gray-700">
                {mode === "ipadapter-chain"
                  ? `链式渲染中… 第 ${chainIndex + 1} / ${chainAngles.length} 张`
                  : phase === "submitting" ? "正在提交任务…" : "ComfyUI 渲染中…"}
              </p>
              {phase === "generating" && (
                <p className="text-xs text-gray-400">
                  已用时 {timeStr}
                  {mode === "ipadapter-chain"
                    ? `，约需 ${chainAngles.length * 5} 分钟`
                    : `，约需 ${mode === "multicontrolnet" ? "40–70 秒" : "25–45 秒"}`}
                </p>
              )}
              {/* Chain gallery while in progress */}
              {mode === "ipadapter-chain" && chainResults.length > 0 && (
                <div className="grid grid-cols-2 gap-2 w-full mt-2">
                  {chainResults.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt={`已完成 ${i+1}`}
                      className="w-full rounded-lg shadow-sm border border-gray-100" />
                  ))}
                </div>
              )}
              <div className="w-full max-w-xs bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: phase === "submitting" ? "10%" : `${Math.min(95, elapsed * 2.5)}%`,
                    background: "linear-gradient(90deg,#6366f1,#818cf8)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Single result */}
          {phase === "done" && resultUrl && mode !== "ipadapter-chain" && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                生成结果
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                className="w-full rounded-xl object-cover shadow-lg"
                alt="AI效果图"
              />
              <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                渲染完成 · 用时 {timeStr}
              </p>
            </div>
          )}

          {/* Chain results gallery */}
          {phase === "done" && mode === "ipadapter-chain" && chainResults.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                链式生成结果 · {chainResults.length} 张
              </p>
              <div className="grid grid-cols-2 gap-2">
                {chainResults.map((url, i) => {
                  const preset = ANGLE_PRESETS.find(p => p.id === chainAngles[i]);
                  return (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} className="w-full rounded-xl object-cover shadow-md" alt={`视角 ${i+1}`} />
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] px-2 py-0.5 rounded-full text-white font-medium"
                        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                        {preset?.icon} {preset?.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 text-center">渲染完成 · 用时 {timeStr}</p>
            </div>
          )}

          {/* Error */}
          {(phase === "error" || error) && (
            <div className="bg-red-50 text-red-600 text-xs rounded-xl px-4 py-3 leading-relaxed">
              ⚠️ {error ?? "渲染失败，请检查 ComfyUI 是否正常运行"}
            </div>
          )}

          {/* ── No ComfyUI: download mode ── */}
          {comfyAvailable === false && (
            <div className="flex flex-col gap-3">
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700 leading-relaxed">
                <p className="font-semibold mb-1">ComfyUI 未在本机运行</p>
                <p>可下载工作流 JSON，在安装了 ComfyUI 的电脑上手动运行。</p>
              </div>

              {/* Download 3D screenshot */}
              {screenshot && (
                <div>
                  <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                    第一步：下载3D截图
                  </p>
                  <button
                    onClick={() => downloadDataUrl(screenshot, `hd_screenshot_${Date.now()}.jpg`)}
                    className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    📷 下载当前3D截图
                  </button>
                </div>
              )}

              {/* Download workflows */}
              <div>
                <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                  第二步：下载工作流
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => downloadWorkflow("controlnet")}
                    className="py-3 px-3 rounded-xl border border-indigo-200 text-left hover:bg-indigo-50 transition-colors"
                  >
                    <div className="text-xs font-semibold text-indigo-700">✦ ControlNet 工作流</div>
                    <div className="text-[10px] text-indigo-400 mt-0.5">精准空间 · 推荐</div>
                  </button>
                  <button
                    onClick={() => downloadWorkflow("txt2img")}
                    className="py-3 px-3 rounded-xl border border-gray-200 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="text-xs font-semibold text-gray-700">✎ 文生图工作流</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">纯 prompt · 无需截图</div>
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-[11px] text-gray-500 leading-relaxed">
                <p className="font-medium text-gray-600 mb-1">使用方法</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>打开 ComfyUI → 菜单 → 文件 → 打开 → 选择下载的工作流 JSON</li>
                  <li>找到 <strong>LoadImage</strong> 节点 → 上传刚才下载的截图</li>
                  <li>点击 <strong>Queue Prompt</strong> 开始生成</li>
                  <li>结果保存在 ComfyUI/output/ 目录</li>
                </ol>
              </div>
            </div>
          )}

          {/* Checking state */}
          {comfyAvailable === null && !screenshot && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <div className="w-4 h-4 rounded-full border-2 border-gray-200 border-t-gray-400 animate-spin" />
              正在检测 ComfyUI 状态…
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          {phase === "done" ? (
            <>
              <button
                onClick={() => {
                  setPhase("idle"); setResultUrl(null); setError(null); setElapsed(0);
                  setChainResults([]); setChainIndex(0);
                }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium"
              >
                重新生成
              </button>
              <button
                onClick={async () => {
                  if (mode === "ipadapter-chain") {
                    // Download all chain results in sequence
                    for (let i = 0; i < chainResults.length; i++) {
                      const r = await fetch(chainResults[i]);
                      const b = await r.blob();
                      const u = URL.createObjectURL(b);
                      const a = document.createElement("a");
                      a.href = u;
                      a.download = `hd_chain_${i+1}_${chainAngles[i]}_${Date.now()}.png`;
                      a.click();
                      URL.revokeObjectURL(u);
                      await new Promise(res => setTimeout(res, 200));
                    }
                  } else {
                    await downloadResult();
                  }
                }}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}
              >
                💾 {mode === "ipadapter-chain" ? `下载 ${chainResults.length} 张` : "下载效果图"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={busy}
                className="py-2.5 px-5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium disabled:opacity-30"
              >
                关闭
              </button>
              {comfyAvailable === true && (
                <button
                  onClick={startRender}
                  disabled={
                    busy ||
                    ((mode === "controlnet" || mode === "multicontrolnet") && !cameraAndCapture && !screenshot) ||
                    (mode === "ipadapter-chain" && (!cameraAndCapture || chainAngles.length === 0))
                  }
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}
                >
                  {phase === "submitting" ? "截取角度中…" :
                   phase === "generating" ? "渲染中…" :
                   mode === "ipadapter-chain" ? `⛓ 链式生成 ${chainAngles.length} 张` :
                   "✨ 生成效果图"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
