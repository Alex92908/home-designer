"use client";

import { useEffect, useRef, useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { generateRoomPrompt } from "@/lib/roomPrompt";
import { generateExteriorPrompt } from "@/lib/sceneToPrompt";
import { generateControlNetWorkflow, generateTxt2ImgWorkflow, SD_MODELS } from "@/lib/comfyWorkflow";
import { useT } from "@/lib/i18n";
import ImageImportModal from "@/components/ImageImportModal";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = "controlnet" | "txt2img" | "multicontrolnet" | "ipadapter-chain" | "hires4k";
type Phase = "idle" | "submitting" | "generating" | "done" | "error";

const POLL_INTERVAL = 2500; // ms

interface AnglePreset {
  id: string;
  icon: string;
  getPos:    (W: number, D: number, H: number) => [number, number, number];
  getLookAt: (W: number, D: number, H: number) => [number, number, number];
}

const ANGLE_PRESETS: AnglePreset[] = [
  {
    id: "front-right",
    icon: "↗",
    getPos:    (W, D, H) => [ W * 0.40,  H * 0.50,  D * 0.40],
    getLookAt: (W, D, H) => [-W * 0.10,  H * 0.20, -D * 0.25],
  },
  {
    id: "front-left",
    icon: "↖",
    getPos:    (W, D, H) => [-W * 0.40,  H * 0.50,  D * 0.40],
    getLookAt: (W, D, H) => [ W * 0.10,  H * 0.20, -D * 0.25],
  },
  {
    id: "front-center",
    icon: "→",
    getPos:    (W, D, H) => [ W * 0.18,   H * 0.45,  D * 0.38],
    getLookAt: (W, D, H) => [-W * 0.05,   H * 0.20, -D * 0.30],
  },
  {
    id: "aerial",
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
  const t = useT();
  // Store — grab current room data for prompt generation
  const floorPlans        = useDesignerStore(s => s.floorPlans);
  const activeFloor       = useDesignerStore(s => s.activeFloor);
  const activeRoom        = useDesignerStore(s => s.activeRoom);
  const cameraAndCapture  = useDesignerStore(s => s.cameraAndCapture);
  // Exterior scene data — used when generating prompts for the 3D exterior view
  const exterior          = useDesignerStore(s => s.exterior);
  const viewMode          = useDesignerStore(s => s.viewMode);
  const sunHour           = useDesignerStore(s => s.sunHour);
  const siteLatLng        = useDesignerStore(s => s.siteLatLng);
  const sdModel                = useDesignerStore(s => s.sdModel);
  const setSdModel             = useDesignerStore(s => s.setSdModel);
  const referenceImageDataUrl  = useDesignerStore(s => s.referenceImageDataUrl);
  const setReferenceImageDataUrl = useDesignerStore(s => s.setReferenceImageDataUrl);
  const promptAdditions        = useDesignerStore(s => s.promptAdditions);

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
  const [importOpen,   setImportOpen]   = useState(false);

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

  /**
   * Get a prompt for the exterior / yard scene.
   * Called automatically when viewMode is "exterior" or "global3d".
   * Wraps generateExteriorPrompt (sceneToPrompt.ts) to match the same
   * { positive, negative, seed } shape that generateControlNetWorkflow expects.
   */
  function getExteriorPrompt() {
    const fp       = floorPlans[activeFloor];
    const yardItems = fp?.yardPlan?.items ?? [];
    const result   = generateExteriorPrompt({
      exterior,
      yardItems,
      sunHour,     // live from the global sun slider
      styleTag: siteLatLng.lat > 28 && siteLatLng.lat < 35 ? "contemporary" : undefined,
    });
    return {
      roomType: "exterior" as const,
      roomName: "exterior",
      positive: [result.positive, promptAdditions].filter(Boolean).join(", "),
      negative: result.negative,
      seed:     Math.floor(Math.random() * 2 ** 31),
    };
  }

  /** Returns the right prompt for the active view (interior room OR exterior). */
  function getActivePrompt() {
    const isExteriorView = viewMode === "exterior" || viewMode === "global3d";
    if (isExteriorView) return getExteriorPrompt();
    const roomData = getCurrentRoomData();
    return roomData ? generateRoomPrompt(roomData) : getExteriorPrompt();
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
    promptData: ReturnType<typeof getActivePrompt>;
  }): Promise<string> {
    const res = await fetch("/api/comfyui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshot:      params.screenshot,
        referenceImages: params.referenceImages,
        seed:            params.seed,
        roomData:        params.promptData,
        mode:            "ipadapter-chain",
        model:           sdModel,
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
    const promptData  = getActivePrompt();
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
          promptData,
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
      setError(t.airErrChain(msg));
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
      const promptData = getActivePrompt();

      // For controlnet / multicontrolnet: capture the selected angle
      const needsCapture = (mode === "controlnet" || mode === "multicontrolnet") && cameraAndCapture;
      const capturedShot = needsCapture ? capturePreset(selectedAngle) : null;
      const body = {
        screenshot:     capturedShot ?? screenshot,
        roomData:       promptData,
        mode,
        model:          sdModel,
        referenceImage: referenceImageDataUrl ?? undefined,
      };

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
          setError(t.airErrComfyTask);
          setPhase("error");
        }
      }, POLL_INTERVAL);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t.airErrSubmit(msg));
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
    const prompt = getActivePrompt();

    const workflow = wfMode === "controlnet"
      ? generateControlNetWorkflow("your_screenshot.png", prompt, { model: sdModel })
      : generateTxt2ImgWorkflow(prompt, { model: sdModel });

    downloadJson(workflow, `home_designer_${wfMode}_workflow.json`);
  }

  if (!open) return null;

  const busy    = phase === "submitting" || phase === "generating";
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <>
    <ImageImportModal open={importOpen} onClose={() => setImportOpen(false)} />
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
            <h2 className="text-sm font-bold text-gray-800">{t.airModalTitle}</h2>
            {comfyAvailable === true && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: "#d1fae5", color: "#065f46" }}>
                {t.airBadgeLocal}
              </span>
            )}
            {comfyAvailable === false && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: "#fee2e2", color: "#991b1b" }}>
                {t.airBadgeOffline}
              </span>
            )}
            {comfyAvailable === null && (
              <span className="text-[10px] text-gray-400">{t.airBadgeChecking}</span>
            )}
            {referenceImageDataUrl && (
              <div className="flex items-center gap-1.5 ml-2">
                <img src={referenceImageDataUrl} className="w-6 h-6 rounded object-cover" alt="参考图" />
                <span className="text-[10px] text-indigo-600 font-medium">风格参考已锁定</span>
                <button onClick={() => setReferenceImageDataUrl(null)} className="text-gray-400 text-xs hover:text-gray-600">✕</button>
              </div>
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

          {/* Import from photo banner */}
          {phase === "idle" && (
            <button onClick={() => setImportOpen(true)}
              className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border text-left transition-all"
              style={{ border: "1px dashed #6366f1", background: "#eef2ff" }}>
              <span>📷</span>
              <div>
                <p className="text-xs font-semibold text-indigo-700">从参考图片导入设计风格</p>
                <p className="text-[10px] text-indigo-400">上传建筑照片，AI 自动识别风格 · 材质 · 配色</p>
              </div>
            </button>
          )}

          {/* Camera angle tip */}
          {phase === "idle" && comfyAvailable === true && (mode === "controlnet" || mode === "multicontrolnet") && (
            <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5"
              style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
              <span className="text-base shrink-0 mt-0.5">📐</span>
              <p className="text-[11px] text-amber-700 leading-relaxed">
                {cameraAndCapture
                  ? <><span className="font-semibold">{t.airTipAuto}</span>{t.airTipAutoSuffix}</>
                  : <><span className="font-semibold">{t.airTipManual}</span>{t.airTipManualSuffix}</>
                }
              </p>
            </div>
          )}

          {/* ── ComfyUI available: mode selector ── */}
          {comfyAvailable === true && phase === "idle" && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-2 uppercase tracking-wider">
                {t.airModeLabel}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: "controlnet",       icon: "✦",  title: t.airModes.controlnet.title,        desc: t.airModes.controlnet.desc },
                  { id: "multicontrolnet",  icon: "✦✦", title: t.airModes.multicontrolnet.title,   desc: t.airModes.multicontrolnet.desc },
                  { id: "ipadapter-chain",  icon: "⛓",  title: t.airModes["ipadapter-chain"].title, desc: t.airModes["ipadapter-chain"].desc },
                  { id: "txt2img",          icon: "✎",  title: t.airModes.txt2img.title,           desc: t.airModes.txt2img.desc },
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

          {/* ── Model picker ── */}
          {comfyAvailable === true && phase === "idle" && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-2 uppercase tracking-wider">
                模型 · SD Checkpoint
              </p>
              <div className="flex flex-col gap-1.5">
                {SD_MODELS.map(m => {
                  const active = sdModel === m.id;
                  const isRecommended = m.tags.includes("recommended");
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSdModel(m.id)}
                      className="flex items-start gap-3 py-2.5 px-3 rounded-xl border text-left transition-all"
                      style={{
                        borderColor: active ? "#6366f1" : "#e5e7eb",
                        background:  active ? "#eef2ff" : "#fafafa",
                      }}
                    >
                      {/* Active indicator */}
                      <span className="mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
                        style={{
                          borderColor: active ? "#6366f1" : "#d1d5db",
                          background:  active ? "#6366f1" : "transparent",
                        }}>
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold"
                            style={{ color: active ? "#4f46e5" : "#374151" }}>
                            {m.labelZh}
                          </span>
                          <span className="text-[9px] font-mono opacity-50">{m.label}</span>
                          {isRecommended && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                              style={{ background: "#fef3c7", color: "#92400e" }}>
                              推荐
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] mt-0.5 leading-snug"
                          style={{ color: active ? "#6366f1" : "#9ca3af" }}>
                          {m.descZh}
                        </p>
                        <p className="text-[9px] font-mono mt-0.5 truncate"
                          style={{ color: active ? "#818cf8" : "#d1d5db" }}>
                          {m.id}
                        </p>
                      </div>
                      <a
                        href={m.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[9px] px-1.5 py-1 rounded shrink-0 mt-0.5 hover:opacity-80 transition-opacity"
                        style={{ background: "#f3f4f6", color: "#6b7280" }}
                        title="下载模型">
                        ↗ 下载
                      </a>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
                模型文件放入 <span className="font-mono">ComfyUI/models/checkpoints/</span> 后即可选用
              </p>
            </div>
          )}

          {/* ── Angle picker (single-view modes) — single select ── */}
          {comfyAvailable === true && phase === "idle" && (mode === "controlnet" || mode === "multicontrolnet") && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
                {t.airAngleLabel}
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
                        {preset.icon} {t.airAngles[preset.id]}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                {t.airAngleHint}
              </p>
            </div>
          )}

          {/* ── Chain mode angle picker (multi-select, max 4) ── */}
          {comfyAvailable === true && phase === "idle" && mode === "ipadapter-chain" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                  {t.airAngleLabel} <span className="normal-case text-gray-300">{t.airChainAngleSuffix}</span>
                </p>
                <span className="text-[10px] text-indigo-400 font-medium">
                  {t.airChainAngleSelected(chainAngles.length)}
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
                        {preset.icon} {t.airAngles[preset.id]}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                {t.airChainAngleHint}
              </p>
            </div>
          )}

          {/* Screenshot preview */}
          {screenshot && phase !== "done" && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                {t.airScreenshotLabel}
              </p>
              <img
                src={screenshot}
                className="w-full rounded-xl object-cover border border-gray-100"
                style={{ maxHeight: 200 }}
                alt={t.airScreenshotAlt}
              />
            </div>
          )}

          {/* Generating — progress indicator */}
          {(phase === "submitting" || phase === "generating") && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin" />
              <p className="text-sm font-medium text-gray-700">
                {mode === "ipadapter-chain"
                  ? t.airProgressChain(chainIndex + 1, chainAngles.length)
                  : phase === "submitting" ? t.airProgressSubmit : t.airProgressGen}
              </p>
              {phase === "generating" && (
                <p className="text-xs text-gray-400">
                  {t.airProgressElapsed(timeStr)}
                  {mode === "ipadapter-chain"
                    ? t.airEtaChain(chainAngles.length * 5)
                    : (mode === "multicontrolnet" ? t.airEtaMulti : t.airEtaSingle)}
                </p>
              )}
              {/* Chain gallery while in progress */}
              {mode === "ipadapter-chain" && chainResults.length > 0 && (
                <div className="grid grid-cols-2 gap-2 w-full mt-2">
                  {chainResults.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt={t.airChainDoneAlt(i + 1)}
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
                {t.airResultLabel}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                className="w-full rounded-xl object-cover shadow-lg"
                alt={t.airResultAlt}
              />
              <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                {t.airResultDone(timeStr)}
              </p>
            </div>
          )}

          {/* Chain results gallery */}
          {phase === "done" && mode === "ipadapter-chain" && chainResults.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                {t.airChainResultLabel(chainResults.length)}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {chainResults.map((url, i) => {
                  const preset = ANGLE_PRESETS.find(p => p.id === chainAngles[i]);
                  return (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} className="w-full rounded-xl object-cover shadow-md" alt={t.airChainAngleAlt(i + 1)} />
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] px-2 py-0.5 rounded-full text-white font-medium"
                        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
                        {preset?.icon} {preset ? t.airAngles[preset.id] : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 text-center">{t.airResultDone(timeStr)}</p>
            </div>
          )}

          {/* Error */}
          {(phase === "error" || error) && (
            <div className="bg-red-50 text-red-600 text-xs rounded-xl px-4 py-3 leading-relaxed">
              ⚠️ {error ?? t.airErrGeneric}
            </div>
          )}

          {/* ── No ComfyUI: download mode ── */}
          {comfyAvailable === false && (
            <div className="flex flex-col gap-3">
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700 leading-relaxed">
                <p className="font-semibold mb-1">{t.airNoComfyTitle}</p>
                <p>{t.airNoComfyDesc}</p>
              </div>

              {/* Download 3D screenshot */}
              {screenshot && (
                <div>
                  <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                    {t.airStep1Label}
                  </p>
                  <button
                    onClick={() => downloadDataUrl(screenshot, `hd_screenshot_${Date.now()}.jpg`)}
                    className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    {t.airStep1Btn}
                  </button>
                </div>
              )}

              {/* Download workflows */}
              <div>
                <p className="text-[11px] font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                  {t.airStep2Label}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => downloadWorkflow("controlnet")}
                    className="py-3 px-3 rounded-xl border border-indigo-200 text-left hover:bg-indigo-50 transition-colors"
                  >
                    <div className="text-xs font-semibold text-indigo-700">{t.airWfCNTitle}</div>
                    <div className="text-[10px] text-indigo-400 mt-0.5">{t.airWfCNDesc}</div>
                  </button>
                  <button
                    onClick={() => downloadWorkflow("txt2img")}
                    className="py-3 px-3 rounded-xl border border-gray-200 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="text-xs font-semibold text-gray-700">{t.airWfT2ITitle}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{t.airWfT2IDesc}</div>
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-[11px] text-gray-500 leading-relaxed">
                <p className="font-medium text-gray-600 mb-1">{t.airHowToTitle}</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>{t.airHowTo1}</li>
                  <li>{t.airHowTo2Pre}<strong>LoadImage</strong>{t.airHowTo2Post}</li>
                  <li>{t.airHowTo3Pre}<strong>Queue Prompt</strong>{t.airHowTo3Post}</li>
                  <li>{t.airHowTo4}</li>
                </ol>
              </div>
            </div>
          )}

          {/* Checking state */}
          {comfyAvailable === null && !screenshot && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
              <div className="w-4 h-4 rounded-full border-2 border-gray-200 border-t-gray-400 animate-spin" />
              {t.airChecking}
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
                {t.airBtnRetry}
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
                💾 {mode === "ipadapter-chain" ? t.airBtnDownloadChain(chainResults.length) : t.airBtnDownloadSingle}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={busy}
                className="py-2.5 px-5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors font-medium disabled:opacity-30"
              >
                {t.airBtnClose}
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
                  {phase === "submitting" ? t.airBtnSubmitting :
                   phase === "generating" ? t.airBtnGenerating :
                   mode === "ipadapter-chain" ? t.airBtnChainStart(chainAngles.length) :
                   t.airBtnGenerate}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
