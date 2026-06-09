"use client";

/**
 * VillaTo3D — correct "one photo → complete 3D → decomposed parts" pipeline.
 *
 * Stage 1: Upload villa photo
 * Stage 2: POST /api/trellis  → Trellis (Microsoft open-source) generates
 *           a COMPLETE 3D mesh of the ENTIRE villa scene (not per-element crops)
 * Stage 3: POST /api/glb-segment → server parses the GLB binary, clusters
 *           faces by normal direction / Y-position / material into semantic
 *           parts (roof, upper walls, ground, pool, facade)
 * Stage 4: Show all parts → user picks which to keep → add to yard as
 *           independent draggable GLB prefabs
 * Stage 5: Optional: open AI render modal on the assembled scene
 *
 * Why this is fundamentally better than the old approach:
 *   Old: crop 2D bbox → TripoSR per crop → disconnected objects, bad quality
 *   New: full scene → Trellis → one coherent mesh → geometric split →
 *        consistent scale / orientation / texture across all parts
 */

import { useState, useRef, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import { useT, useLocale } from "@/lib/i18n";
import type { YardPrefab } from "@/lib/types";
import {
  getModel3dProvider,
  Model3dProviderId,
} from "@/lib/model3dProviders";
import {
  getModel3dKey,
  setModel3dKey,
  getSelected3dProvider,
  setSelected3dProvider,
} from "@/lib/model3dKeys";
import Model3dKeyPromptModal from "./Model3dKeyPromptModal";

// ─── Types ────────────────────────────────────────────────────────
interface SegmentedPart {
  label: string;
  chinese: string;
  seg: string;
  faceCount: number;
  glbBase64: string;
}

type Stage =
  | "upload"
  | "generating_full"   // Trellis running
  | "segmenting"        // GLB splitting running
  | "selecting"         // user reviews parts
  | "done";

const SEG_EMOJI: Record<string, string> = {
  roof:   "🏠", upper: "🏢", wall: "🧱", ground: "🌿", pool: "🏊",
};

// ─── Component ────────────────────────────────────────────────────
export function VillaTo3D({
  onClose,
  mode = "decompose",
}: {
  onClose?: () => void;
  /** decompose = 整图 → glb-segment 拆零件；single = 整模型直接入场景 */
  mode?: "decompose" | "single";
}) {
  const t = useT();
  const en = useLocale() === "en";
  const referenceImageDataUrl = useDesignerStore(s => s.referenceImageDataUrl);
  const addYardItem           = useDesignerStore(s => s.addYardItem);
  const requestAiRender       = useDesignerStore(s => s.requestAiRender);

  // 选中的 3D 后端（TRELLIS 1.0/2.0/Hunyuan）—— 即「选模型」+「选凭证」
  const [provider, setProvider] = useState<Model3dProviderId>(() => getSelected3dProvider());
  const [keyPrompt, setKeyPrompt] = useState(false);
  const providerMeta = getModel3dProvider(provider)!;

  const STAGE_LABELS: Record<Stage, string> = {
    upload:           t.villaTo3d.stageUpload,
    generating_full:  t.villaTo3d.stageGenerating,
    segmenting:       t.villaTo3d.stageSegmenting,
    selecting:        t.villaTo3d.stageSelecting,
    done:             t.villaTo3d.stageDone,
  };

  const [uploadedImg, setUploadedImg]   = useState<string | null>(null);
  const [stage, setStage]               = useState<Stage>("upload");
  const [error, setError]               = useState("");
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [fullGlb, setFullGlb]           = useState<string | null>(null);
  const [savedGlbUrl, setSavedGlbUrl]   = useState<string | null>(null);
  const [parts, setParts]               = useState<SegmentedPart[]>([]);
  const [selected, setSelected]         = useState<Set<number>>(new Set());
  // Scale slider for "set as main building" — user adjusts until model looks right
  const [buildingScale, setBuildingScale] = useState(1.0);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeImage = uploadedImg ?? referenceImageDataUrl ?? null;

  // ── Upload ──────────────────────────────────────────────────────
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setUploadedImg(ev.target?.result as string);
    reader.readAsDataURL(f);
  }, []);

  // ── Full pipeline（统一走 /api/model-3d，token 自带） ─────────────
  const run = useCallback(async (hfToken: string) => {
    if (!activeImage) { setError(t.villaTo3d.needUploadImg); return; }
    setError("");
    setQuotaExceeded(false);

    // ── Step 1: 后端模型 → 整场景 GLB ─────────────────────────────
    setStage("generating_full");
    let glbB64: string;
    try {
      const res  = await fetch("/api/model-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, hfToken, imageBase64: activeImage }),
      });
      const json = await res.json() as {
        glbBase64?: string; glbUrl?: string; error?: string; quotaExceeded?: boolean;
      };
      if (res.status === 429 && json.quotaExceeded) {
        setQuotaExceeded(true);
        setError(t.villaTo3d.quotaUsedUp);
        setStage("upload");
        return;
      }
      if (!res.ok || (!json.glbBase64 && !json.glbUrl)) throw new Error(json.error ?? t.villaTo3d.trellisFailed);
      glbB64 = json.glbBase64 ?? `data:model/gltf-binary;base64,${json.glbUrl}`;
      setFullGlb(glbB64);
      if (json.glbUrl) setSavedGlbUrl(json.glbUrl);
    } catch (err) {
      setError(t.villaTo3d.fullGenFailed(err instanceof Error ? err.message : String(err)));
      setStage("upload");
      return;
    }

    // ── Step 2: GLB 拆件（single 模式整模型直接入场景，不拆） ──────
    if (mode === "single") {
      setParts([{ label: providerMeta.label, chinese: providerMeta.label, seg: "wall", faceCount: 0, glbBase64: glbB64 }]);
      setSelected(new Set([0]));
      setStage("selecting");
      return;
    }

    setStage("segmenting");
    try {
      const res  = await fetch("/api/glb-segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ glbBase64: glbB64 }),
      });
      const json = await res.json() as { parts?: SegmentedPart[]; error?: string };
      if (!res.ok || !json.parts?.length) throw new Error(json.error ?? t.villaTo3d.segFailed);
      setParts(json.parts);
      setSelected(new Set(json.parts.map((_, i) => i)));
      setStage("selecting");
    } catch (err) {
      setError(t.villaTo3d.segFailedMsg(err instanceof Error ? err.message : String(err)));
      setParts([{ label: "complete villa", chinese: t.villaTo3d.completeVilla, seg: "wall", faceCount: 0, glbBase64: glbB64 }]);
      setSelected(new Set([0]));
      setStage("selecting");
    }
  }, [activeImage, provider, mode, providerMeta.label, t]);

  // ── BYOK 网关：选中后端有 key 就跑，没有就弹窗填 key ──────────────
  const ensureKeyThenRun = useCallback(() => {
    const key = getModel3dKey(providerMeta.credential);
    if (key) void run(key);
    else setKeyPrompt(true);
  }, [providerMeta.credential, run]);

  // ── Add selected parts to scene ─────────────────────────────────
  // asMainBuilding=true → single GLB at origin (0,0), user-set scale
  //                        Used for the full TRELLIS villa model
  // asMainBuilding=false → tile parts offset from each other (legacy)
  const addToScene = useCallback((andRender: boolean, asMainBuilding = false) => {
    const chosen = parts.filter((_, i) => selected.has(i));
    if (!chosen.length) return;

    chosen.forEach((p, i) => {
      const prefab: YardPrefab = {
        id:         `glb_${Date.now()}_${i}`,
        type:       "prefab",
        prefabKind: "glb_model",
        // Main building → center of the yard (house origin)
        // Parts → spread out so they don't overlap
        x:          asMainBuilding ? 0   : (i % 3) * 400 + 150,
        z:          asMainBuilding ? 0   : Math.floor(i / 3) * 400 + 200,
        rot:        0,
        scale:      asMainBuilding ? buildingScale : 1,
        glbSrc:     p.glbBase64,
        partLabel:  p.chinese,
      };
      addYardItem(prefab);
    });

    setStage("done");
    if (andRender) setTimeout(() => requestAiRender(), 400);
    setTimeout(() => onClose?.(), andRender ? 100 : 600);
  }, [parts, selected, buildingScale, addYardItem, requestAiRender, onClose]);

  // ── Progress step bar ───────────────────────────────────────────
  const stageOrder: Stage[] = ["upload", "generating_full", "segmenting", "selecting", "done"];
  const stageIdx = stageOrder.indexOf(stage);

  return (
    <div style={{
      width: 420, maxHeight: "92vh", overflowY: "auto",
      background: "#FAFAFA", border: "1px solid #E0E0E0",
      borderRadius: 16, padding: 22,
      fontFamily: "sans-serif", fontSize: 13, color: "#222",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {t.villaTo3d.title}
            <span style={{
              marginLeft: 8, fontSize: 10,
              background: "#7C3AED", color: "#fff",
              borderRadius: 4, padding: "1px 6px", verticalAlign: "middle",
            }}>{providerMeta.label}</span>
          </div>
          <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>
            {en ? providerMeta.blurb.en : providerMeta.blurb.zh}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#AAA", flexShrink: 0 }}>×</button>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ display: "flex", gap: 3, marginBottom: 20 }}>
        {stageOrder.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{
              height: 4, borderRadius: 2, marginBottom: 4,
              background: i < stageIdx ? "#16A34A" : i === stageIdx ? "#7C3AED" : "#E5E7EB",
              transition: "background 0.3s",
            }} />
            <div style={{
              fontSize: 8, textAlign: "center",
              color: i < stageIdx ? "#16A34A" : i === stageIdx ? "#7C3AED" : "#9CA3AF",
              fontWeight: i === stageIdx ? 700 : 400,
            }}>
              {STAGE_LABELS[s]}
            </div>
          </div>
        ))}
      </div>

      {/* ── STAGE: upload ─────────────────────────────────────────── */}
      {stage === "upload" && (
        <>
          <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 11 }}>
            <b style={{ color: "#0369A1" }}>{t.villaTo3d.diffTitle}</b>
            <div style={{ color: "#0C4A6E", marginTop: 4, lineHeight: 1.6 }}>
              {t.villaTo3d.diffBody1}<br />
              <b>{t.villaTo3d.diffBody2a}</b>{t.villaTo3d.diffBody2b}
            </div>
          </div>

          {activeImage ? (
            <div style={{ position: "relative", marginBottom: 14 }}>
              <img src={activeImage} alt="villa" style={{ width: "100%", borderRadius: 10, border: "1px solid #DDD", display: "block" }} />
              <button onClick={() => fileRef.current?.click()} style={{
                position: "absolute", bottom: 8, right: 8,
                background: "rgba(0,0,0,0.6)", color: "#fff",
                border: "none", borderRadius: 6, padding: "3px 10px",
                fontSize: 10, cursor: "pointer",
              }}>{t.villaTo3d.replaceImg}</button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} style={{
              width: "100%", height: 140, border: "2px dashed #C8C8C8",
              borderRadius: 10, background: "#F5F5F5",
              cursor: "pointer", color: "#888",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 8,
              marginBottom: 14,
            }}>
              <span style={{ fontSize: 36 }}>🏠</span>
              <span>{t.villaTo3d.uploadVillaRef}</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />

          {error && !quotaExceeded && (
            <div style={{ color: "#DC2626", fontSize: 11, marginBottom: 10 }}>⚠ {error}</div>
          )}

          {/* Quota exceeded — offer fast mode or Pro upgrade */}
          {quotaExceeded && (
            <div style={{
              background: "#FFF7ED", border: "1px solid #FED7AA",
              borderRadius: 10, padding: "12px 14px", marginBottom: 12,
            }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "#92400E", marginBottom: 6 }}>
                {t.villaTo3d.quotaTitle}
              </div>
              <div style={{ fontSize: 11, color: "#78350F", lineHeight: 1.7, marginBottom: 10 }}>
                {t.villaTo3d.quotaBody1}<br />
                {t.villaTo3d.quotaOptions}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  onClick={() => ensureKeyThenRun()}
                  disabled={!activeImage}
                  style={{
                    padding: "8px 0", borderRadius: 8,
                    background: "#D97706", color: "#fff",
                    border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {t.villaTo3d.retryGen}
                </button>
                <a
                  href="https://huggingface.co/subscribe/pro"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block", textAlign: "center",
                    padding: "7px 0", borderRadius: 8,
                    border: "1px solid #D97706", color: "#92400E",
                    fontSize: 11, fontWeight: 600, textDecoration: "none",
                  }}
                >
                  {t.villaTo3d.upgradePro}
                </a>
                <div style={{ fontSize: 10, color: "#9CA3AF", textAlign: "center" }}>
                  {t.villaTo3d.waitReset}
                </div>
              </div>
            </div>
          )}

          {/* 后端选择条：当前模型 + 换/填密钥 */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, padding: "8px 10px", marginBottom: 10,
            border: "1px solid #E5E7EB", borderRadius: 8, background: "#FAFAFA",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>
                {en ? "Backend" : "后端模型"}：{providerMeta.label}
              </div>
              <div style={{ fontSize: 9, color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {en ? providerMeta.blurb.en : providerMeta.blurb.zh}
              </div>
            </div>
            <button onClick={() => setKeyPrompt(true)} style={{
              flexShrink: 0, padding: "5px 10px", borderRadius: 6,
              border: "1px solid #C4B5FD", background: "#fff",
              color: "#6D28D9", fontSize: 10, fontWeight: 700, cursor: "pointer",
            }}>
              {en ? "Switch / key" : "更换 / 密钥"}
            </button>
          </div>

          <button onClick={() => ensureKeyThenRun()} disabled={!activeImage} style={{
            width: "100%", padding: "11px 0",
            background: !activeImage ? "#9CA3AF" : "linear-gradient(135deg,#7C3AED,#4F46E5)",
            color: "#fff", border: "none", borderRadius: 10,
            fontSize: 14, fontWeight: 700, cursor: !activeImage ? "not-allowed" : "pointer",
            marginBottom: 6,
          }}>
            {t.villaTo3d.genBtn}
          </button>

          <div style={{ fontSize: 10, color: "#9CA3AF", textAlign: "center", marginTop: 8 }}>
            {t.villaTo3d.genHint}
          </div>
        </>
      )}

      {/* ── STAGE: generating_full ────────────────────────────────── */}
      {stage === "generating_full" && (
        <div style={{ textAlign: "center", padding: "30px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚙️</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
            {t.villaTo3d.genFullV1}
          </div>
          <div style={{ color: "#666", fontSize: 12, lineHeight: 1.7 }}>
            {t.villaTo3d.genFullBody1}<br />
            {t.villaTo3d.genFullBody2}<br />
            {t.villaTo3d.genFullEtaV1}
          </div>
          <div style={{ marginTop: 20, height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", background: "#7C3AED", borderRadius: 2,
              animation: "slide 2s ease-in-out infinite",
              width: "40%",
            }} />
          </div>
          <style>{`@keyframes slide { 0%{margin-left:0} 50%{margin-left:60%} 100%{margin-left:0} }`}</style>
        </div>
      )}

      {/* ── STAGE: segmenting ─────────────────────────────────────── */}
      {stage === "segmenting" && (
        <div style={{ textAlign: "center", padding: "30px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✂️</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{t.villaTo3d.segmenting}</div>
          <div style={{ color: "#666", fontSize: 12, lineHeight: 1.7 }}>
            {t.villaTo3d.segBody1}<br />
            {t.villaTo3d.segBody2}<br />
            {t.villaTo3d.segBody3}
          </div>
        </div>
      )}

      {/* ── STAGE: selecting ─────────────────────────────────────── */}
      {stage === "selecting" && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            {t.villaTo3d.partsCount(parts.length)}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {parts.map((p, i) => (
              <label key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 10,
                border: `1px solid ${selected.has(i) ? "#C4B5FD" : "#E5E7EB"}`,
                background: selected.has(i) ? "#FAF5FF" : "#FAFAFA",
                cursor: "pointer",
              }}>
                <input type="checkbox" checked={selected.has(i)}
                  onChange={() => setSelected(prev => {
                    const n = new Set(prev);
                    n.has(i) ? n.delete(i) : n.add(i);
                    return n;
                  })} />
                <span style={{ fontSize: 22 }}>{SEG_EMOJI[p.seg] ?? "📦"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{p.chinese}</div>
                  <div style={{ fontSize: 10, color: "#888" }}>
                    {p.label} · {p.faceCount.toLocaleString()} {t.villaTo3d.faceUnit}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {error && (
            <div style={{
              background: "#FEF3C7", border: "1px solid #FDE68A",
              borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: "#92400E",
            }}>
              ⚠ {t.villaTo3d.segNote(error)}
            </div>
          )}

          {/* ── 普通加入 ── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => addToScene(false)} disabled={selected.size === 0} style={{
              flex: 1, padding: "10px 0",
              background: selected.size === 0 ? "#9CA3AF" : "#16A34A",
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: selected.size === 0 ? "not-allowed" : "pointer",
            }}>
              {t.villaTo3d.addToScene}
            </button>
            <button onClick={() => addToScene(true)} disabled={selected.size === 0} style={{
              flex: 1, padding: "10px 0",
              background: selected.size === 0 ? "#9CA3AF" : "#7C3AED",
              color: "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: selected.size === 0 ? "not-allowed" : "pointer",
            }}>
              {t.villaTo3d.addAndRender}
            </button>
          </div>

          {/* ── 设为主建筑（居中+缩放） ── */}
          <div style={{
            border: "1px solid #C4B5FD", borderRadius: 10,
            padding: "12px 14px", background: "#FAF5FF",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#5B21B6", marginBottom: 8 }}>
              {t.villaTo3d.setMainTitle}
            </div>
            <div style={{ fontSize: 11, color: "#6D28D9", marginBottom: 8 }}>
              {t.villaTo3d.scaleLabelPre}<b>{buildingScale.toFixed(1)}×</b>
            </div>
            <input
              type="range" min={0.1} max={5} step={0.05}
              value={buildingScale}
              onChange={e => setBuildingScale(Number(e.target.value))}
              style={{ width: "100%", marginBottom: 10, accentColor: "#7C3AED" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => addToScene(false, true)}
                disabled={selected.size === 0}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                  background: selected.size === 0 ? "#9CA3AF" : "#5B21B6",
                  color: "#fff", fontSize: 12, fontWeight: 700,
                  cursor: selected.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                {t.villaTo3d.setMain}
              </button>
              <button
                onClick={() => addToScene(true, true)}
                disabled={selected.size === 0}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                  background: selected.size === 0 ? "#9CA3AF" : "#7C3AED",
                  color: "#fff", fontSize: 12, fontWeight: 700,
                  cursor: selected.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                {t.villaTo3d.setMainRender}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── STAGE: done ──────────────────────────────────────────── */}
      {stage === "done" && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 44 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginTop: 10 }}>{t.villaTo3d.addedToScene}</div>
          <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>
            {t.villaTo3d.addedBody}
          </div>

          {/* ── 本地保存提示 + 下载按钮 ── */}
          <div style={{
            marginTop: 20, padding: "12px 16px", borderRadius: 12,
            background: "#F0FDF4", border: "1px solid #86EFAC",
            textAlign: "left",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", marginBottom: 6 }}>
              {t.villaTo3d.glbSaved}
            </div>
            {savedGlbUrl && (
              <div style={{
                fontSize: 10, color: "#15803D", fontFamily: "monospace",
                wordBreak: "break-all", marginBottom: 10,
                background: "#DCFCE7", borderRadius: 6, padding: "4px 8px",
              }}>
                public{savedGlbUrl}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              {/* 下载完整 GLB */}
              {fullGlb && (
                <button
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = fullGlb!;
                    a.download = `${provider}_villa_${Date.now()}.glb`;
                    a.click();
                  }}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: "none",
                    background: "#16A34A", color: "#fff",
                    fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {t.villaTo3d.downloadFullGlb}
                </button>
              )}
              {/* 在新标签预览（如果已保存到 public） */}
              {savedGlbUrl && (
                <button
                  onClick={() => window.open(savedGlbUrl!, "_blank")}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8,
                    border: "1px solid #16A34A", background: "transparent",
                    color: "#16A34A", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {t.villaTo3d.onlinePreview}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {keyPrompt && (
        <Model3dKeyPromptModal
          initialProvider={provider}
          onSave={(p, k) => {
            setModel3dKey(getModel3dProvider(p)!.credential, k);
            setSelected3dProvider(p);
            setProvider(p);
            setKeyPrompt(false);
            // 填完即跑：用刚保存的 key 直接生成
            void run(k);
          }}
          onClose={() => setKeyPrompt(false)}
        />
      )}
    </div>
  );
}
