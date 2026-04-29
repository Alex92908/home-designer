"use client";

/**
 * VillaDecomposer — "整图拆解" panel
 *
 * Full pipeline:
 *   1. User uploads (or reuses) a villa reference photo
 *   2. GLM-4V / Claude detects each outdoor element + bounding box
 *   3. Each bbox is drawn on the preview image so user can see what was found
 *   4. User selects which elements to generate (all selected by default)
 *   5. Client crops each bbox from the photo using HTML Canvas
 *   6. Each crop is sent to POST /api/image-to-3d (TripoSR / SF3D)
 *   7. Results shown as a "parts collection" — add all to yard with one click
 *
 * This achieves the "one photo → 3D component collection" vision:
 *   photo → decompose → parts → assemble in R3F → AI render
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import type { YardPrefab } from "@/lib/types";
import type { DetectedElement } from "@/app/api/villa-decompose/route";

// ─── Crop helper (client-side, no server deps) ─────────────────────
// Draws the sub-region of an image onto a temporary canvas and returns
// the result as a base64 JPEG. Runs entirely in the browser.
async function cropImageToBase64(
  imageDataUrl: string,
  bbox: [number, number, number, number], // [x, y, w, h] as fractions 0-1
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [fx, fy, fw, fh] = bbox;
      // Add 10% padding around each element for better TripoSR context
      const PAD = 0.05;
      const x = Math.max(0, fx - PAD) * img.width;
      const y = Math.max(0, fy - PAD) * img.height;
      const w = Math.min(1, fw + PAD * 2) * img.width;
      const h = Math.min(1, fh + PAD * 2) * img.height;

      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

// ─── Types ────────────────────────────────────────────────────────
interface PartResult {
  element: DetectedElement;
  status: "pending" | "generating" | "done" | "error";
  glbSrc?: string;
  error?: string;
}

type Stage = "upload" | "detecting" | "selecting" | "generating" | "done";

const BBOX_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
];

// ─── Main component ────────────────────────────────────────────────
export function VillaDecomposer({ onClose }: { onClose?: () => void }) {
  const referenceImageDataUrl = useDesignerStore(s => s.referenceImageDataUrl);
  const addYardItem           = useDesignerStore(s => s.addYardItem);
  const requestAiRender       = useDesignerStore(s => s.requestAiRender);

  const [uploadedImg, setUploadedImg] = useState<string | null>(null);
  const [stage, setStage]             = useState<Stage>("upload");
  const [elements, setElements]       = useState<DetectedElement[]>([]);
  const [selected, setSelected]       = useState<Set<number>>(new Set());
  const [parts, setParts]             = useState<PartResult[]>([]);
  const [globalError, setGlobalError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef  = useRef<HTMLImageElement>(null);

  const activeImage = uploadedImg ?? referenceImageDataUrl ?? null;

  // ── Upload ──────────────────────────────────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setUploadedImg(ev.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  // ── Step 1: Detect elements ─────────────────────────────────────
  const detect = useCallback(async () => {
    if (!activeImage) { setGlobalError("请先上传别墅图片"); return; }
    setStage("detecting");
    setGlobalError("");
    try {
      const res  = await fetch("/api/villa-decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: activeImage }),
      });
      const json = await res.json() as { elements?: DetectedElement[]; error?: string };
      if (!res.ok || !json.elements?.length) throw new Error(json.error ?? "识别失败");
      setElements(json.elements);
      setSelected(new Set(json.elements.map((_, i) => i)));  // select all by default
      setStage("selecting");
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
      setStage("upload");
    }
  }, [activeImage]);

  // ── Step 2: Crop + generate GLBs ───────────────────────────────
  const generateAll = useCallback(async () => {
    if (!activeImage) return;
    const chosen = elements.filter((_, i) => selected.has(i));
    if (!chosen.length) { setGlobalError("请至少选择一个元素"); return; }

    const initial: PartResult[] = chosen.map(el => ({ element: el, status: "pending" }));
    setParts(initial);
    setStage("generating");
    setGlobalError("");

    // Generate sequentially to avoid overwhelming TripoSR queue
    for (let i = 0; i < chosen.length; i++) {
      const el = chosen[i];
      setParts(prev => prev.map((p, idx) => idx === i ? { ...p, status: "generating" } : p));
      try {
        // Crop this element from the original image
        const crop = await cropImageToBase64(activeImage, el.bbox);
        // Call TripoSR / SF3D
        const res  = await fetch("/api/image-to-3d", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: crop, partHint: el.label }),
        });
        const json = await res.json() as { glbBase64?: string; glbUrl?: string; error?: string };
        if (!res.ok || (!json.glbBase64 && !json.glbUrl)) throw new Error(json.error ?? "生成失败");
        const src = json.glbUrl ?? json.glbBase64!;
        setParts(prev => prev.map((p, idx) => idx === i ? { ...p, status: "done", glbSrc: src } : p));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setParts(prev => prev.map((p, idx) => idx === i ? { ...p, status: "error", error: msg } : p));
      }
    }
    setStage("done");
  }, [activeImage, elements, selected]);

  // ── Step 3: Add all successful parts to scene ──────────────────
  const addAllToScene = useCallback((andRender: boolean) => {
    const successful = parts.filter(p => p.status === "done" && p.glbSrc);
    if (!successful.length) return;
    successful.forEach((p, i) => {
      const prefab: YardPrefab = {
        id:         `glb_${Date.now()}_${i}`,
        type:       "prefab",
        prefabKind: "glb_model",
        x:          (i % 3) * 350 + 200,   // spread parts out so they don't stack
        z:          Math.floor(i / 3) * 350 + 300,
        rot:        0,
        scale:      1,
        glbSrc:     p.glbSrc!,
        partLabel:  p.element.chinese || p.element.label,
      };
      addYardItem(prefab);
    });
    if (andRender) setTimeout(() => requestAiRender(), 400);
    onClose?.();
  }, [parts, addYardItem, requestAiRender, onClose]);

  // ── Render ──────────────────────────────────────────────────────
  const doneCount       = parts.filter(p => p.status === "done").length;
  const errorCount      = parts.filter(p => p.status === "error").length;
  const generatingIndex = parts.findIndex(p => p.status === "generating");

  return (
    <div style={{
      width: 400, maxHeight: "90vh", overflowY: "auto",
      background: "#FAFAFA", border: "1px solid #E0E0E0",
      borderRadius: 16, padding: 20,
      fontFamily: "sans-serif", fontSize: 13, color: "#222",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>🏗 整图拆解 → 3D 零件集合</div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
            一张别墅图 → AI识别元素 → 各自生成GLB → 一套可编辑组件
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#888" }}>×</button>
        )}
      </div>

      {/* Pipeline steps */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["upload", "detecting", "selecting", "generating", "done"] as Stage[]).map((s, i) => {
          const labels = ["上传图", "识别中", "选元素", "生成中", "完成"];
          const done   = ["upload","detecting","selecting","generating","done"].indexOf(stage) > i;
          const active = stage === s;
          return (
            <div key={s} style={{ flex: 1, textAlign: "center" }}>
              <div style={{
                height: 3, borderRadius: 2, marginBottom: 3,
                background: done ? "#16A34A" : active ? "#3B82F6" : "#E5E7EB",
              }} />
              <div style={{ fontSize: 9, color: done ? "#16A34A" : active ? "#3B82F6" : "#9CA3AF", fontWeight: active ? 700 : 400 }}>
                {labels[i]}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── STAGE: upload ────────────────────────────────────────── */}
      {(stage === "upload" || stage === "detecting") && (
        <>
          {/* Image preview */}
          <div style={{ marginBottom: 12 }}>
            {activeImage ? (
              <div style={{ position: "relative" }}>
                <img src={activeImage} alt="villa" ref={imgRef}
                  style={{ width: "100%", borderRadius: 10, border: "1px solid #DDD", display: "block" }} />
                <button onClick={() => fileRef.current?.click()} style={{
                  position: "absolute", bottom: 8, right: 8,
                  background: "rgba(0,0,0,0.6)", color: "#fff",
                  border: "none", borderRadius: 6, padding: "3px 10px",
                  fontSize: 10, cursor: "pointer",
                }}>换图</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} style={{
                width: "100%", height: 140,
                border: "2px dashed #C8C8C8", borderRadius: 10,
                background: "#F5F5F5", cursor: "pointer",
                color: "#888", fontSize: 14, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <span style={{ fontSize: 32 }}>🏠</span>
                <span>上传别墅参考图片</span>
                <span style={{ fontSize: 10, color: "#AAA" }}>支持 JPG / PNG</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
          </div>

          {globalError && (
            <div style={{ color: "#DC2626", fontSize: 11, marginBottom: 8 }}>⚠ {globalError}</div>
          )}

          <button onClick={detect} disabled={stage === "detecting" || !activeImage} style={{
            width: "100%", padding: "10px 0",
            background: stage === "detecting" ? "#9CA3AF" : "#3B82F6",
            color: "#fff", border: "none", borderRadius: 8,
            fontSize: 14, fontWeight: 600, cursor: stage === "detecting" ? "not-allowed" : "pointer",
          }}>
            {stage === "detecting" ? "⏳ AI 识别元素中…" : "🔍 识别场景元素"}
          </button>
        </>
      )}

      {/* ── STAGE: selecting ─────────────────────────────────────── */}
      {stage === "selecting" && activeImage && (
        <>
          <div style={{ marginBottom: 10, fontWeight: 600, fontSize: 12 }}>
            识别到 {elements.length} 个元素，选择需要生成3D的：
          </div>

          {/* Annotated image with bboxes */}
          <div style={{ position: "relative", marginBottom: 12 }}>
            <img src={activeImage} alt="villa"
              style={{ width: "100%", borderRadius: 8, display: "block" }} />
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              viewBox="0 0 100 100" preserveAspectRatio="none">
              {elements.map((el, i) => {
                const [bx, by, bw, bh] = el.bbox.map(v => v * 100);
                const color = BBOX_COLORS[i % BBOX_COLORS.length];
                const isSelected = selected.has(i);
                return (
                  <g key={i} style={{ cursor: "pointer" }}
                    onClick={() => setSelected(prev => {
                      const next = new Set(prev);
                      next.has(i) ? next.delete(i) : next.add(i);
                      return next;
                    })}>
                    <rect x={bx} y={by} width={bw} height={bh}
                      fill={isSelected ? `${color}22` : "transparent"}
                      stroke={color} strokeWidth={isSelected ? 0.5 : 0.3}
                      strokeDasharray={isSelected ? "none" : "2,1"} />
                    <rect x={bx} y={by - 4.5} width={Math.min(bw, 22)} height={4.5} fill={color} rx={0.5} />
                    <text x={bx + 0.8} y={by - 0.8} fontSize={2.8} fill="#fff" fontWeight="bold">
                      {i + 1}. {el.chinese}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Element list checkboxes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {elements.map((el, i) => {
              const color = BBOX_COLORS[i % BBOX_COLORS.length];
              return (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(i)}
                    onChange={() => setSelected(prev => {
                      const next = new Set(prev);
                      next.has(i) ? next.delete(i) : next.add(i);
                      return next;
                    })} />
                  <span style={{ width: 12, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{el.chinese}</span>
                  <span style={{ color: "#888", fontSize: 11 }}>{el.label}</span>
                </label>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button onClick={() => setSelected(new Set(elements.map((_, i) => i)))}
              style={{ flex: 1, padding: "6px 0", background: "#F3F4F6", border: "1px solid #DDD", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
              全选
            </button>
            <button onClick={() => setSelected(new Set())}
              style={{ flex: 1, padding: "6px 0", background: "#F3F4F6", border: "1px solid #DDD", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
              全不选
            </button>
          </div>

          <div style={{ fontSize: 10, color: "#888", marginBottom: 10 }}>
            已选 {selected.size} 个，每个约 30-60 秒，共约 {Math.round(selected.size * 45 / 60)} 分钟
          </div>

          <button onClick={generateAll} disabled={selected.size === 0} style={{
            width: "100%", padding: "10px 0",
            background: selected.size === 0 ? "#9CA3AF" : "#7C3AED",
            color: "#fff", border: "none", borderRadius: 8,
            fontSize: 14, fontWeight: 600, cursor: selected.size === 0 ? "not-allowed" : "pointer",
          }}>
            🚀 批量生成 {selected.size} 个 3D 零件
          </button>
        </>
      )}

      {/* ── STAGE: generating / done ─────────────────────────────── */}
      {(stage === "generating" || stage === "done") && (
        <>
          <div style={{ marginBottom: 10, fontWeight: 600 }}>
            {stage === "generating"
              ? `⏳ 生成中 ${doneCount + errorCount}/${parts.length}…`
              : `✅ 完成！成功 ${doneCount} 个${errorCount ? `，失败 ${errorCount} 个` : ""}`}
          </div>

          {/* Part cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {parts.map((p, i) => {
              const color = BBOX_COLORS[elements.indexOf(p.element) % BBOX_COLORS.length];
              const icon = p.status === "done" ? "✅" : p.status === "error" ? "❌" : p.status === "generating" ? "⏳" : "⏸";
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: 8,
                  border: `1px solid ${p.status === "done" ? "#BBF7D0" : p.status === "error" ? "#FECACA" : "#E5E7EB"}`,
                  background: p.status === "done" ? "#F0FDF4" : p.status === "error" ? "#FEF2F2" : "#FAFAFA",
                }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{p.element.chinese}</span>
                  <span>{icon}</span>
                  {p.status === "generating" && (
                    <span style={{ fontSize: 10, color: "#6B7280" }}>约30-60秒…</span>
                  )}
                  {p.status === "error" && (
                    <span style={{ fontSize: 10, color: "#DC2626" }}>{p.error}</span>
                  )}
                </div>
              );
            })}
          </div>

          {stage === "done" && doneCount > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => addAllToScene(false)} style={{
                flex: 1, padding: "10px 0",
                background: "#16A34A", color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                ➕ 全部加入场景
              </button>
              <button onClick={() => addAllToScene(true)} style={{
                flex: 1, padding: "10px 0",
                background: "#7C3AED", color: "#fff",
                border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                🎨 加入并渲染整体
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
