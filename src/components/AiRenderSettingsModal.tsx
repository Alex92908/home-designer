"use client";

import { useEffect, useState } from "react";
import {
  getAiRenderConfig,
  saveAiRenderConfig,
  defaultBaseUrl,
  newId,
  buildWorkflowFromPreset,
  localizeBackendName,
  localizeWorkflowName,
  type AiRenderConfig,
  type RenderBackend,
  type RenderWorkflow,
  type BackendKind,
} from "@/lib/aiRenderConfig";
import { WORKFLOW_PRESETS, PRESET_CATEGORIES, presetName, presetCategoryLabel, type WorkflowPreset } from "@/lib/workflowPresets";
import { useT, useLocale } from "@/lib/i18n";

// ─── 通用 AI 出图设置：管理后端列表 + 工作流列表（均可自由增删）──────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 9,
  border: "1px solid var(--ds-border, #e5e7eb)",
  fontSize: 12,
  background: "var(--ds-surface, #fff)",
  color: "var(--ds-text, #111)",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 600, marginBottom: 3, color: "var(--ds-text-2, #4b5563)" };

export default function AiRenderSettingsModal({ open, onClose }: Props) {
  const tr     = useT().aiRender;
  const locale = useLocale();
  const KIND_LABEL: Record<BackendKind, string> = {
    "comfyui-local": tr.kindLocal,
    "comfyui-http": tr.kindHttp,
    runninghub: tr.kindCloud,
  };
  const [config, setConfig] = useState<AiRenderConfig>(() => getAiRenderConfig());
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"workflows" | "backends" | "presets">("workflows");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setConfig(getAiRenderConfig()); setSaved(false); }
  }, [open]);

  if (!open) return null;

  // ── backend ops ──
  const addBackend = () => setConfig((c) => ({
    ...c,
    backends: [...c.backends, { id: newId("be"), name: tr.newBackend, kind: "comfyui-http", baseUrl: "" }],
  }));
  const updateBackend = (id: string, patch: Partial<RenderBackend>) => setConfig((c) => ({
    ...c, backends: c.backends.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  }));
  const removeBackend = (id: string) => setConfig((c) => ({ ...c, backends: c.backends.filter((b) => b.id !== id) }));

  // ── workflow ops ──
  const addWorkflow = () => setConfig((c) => ({
    ...c,
    workflows: [...c.workflows, {
      id: newId("wf"), name: tr.newWorkflow, backendId: c.backends[0]?.id ?? "", needsImage: true,
      mapping: { promptNodeId: "18", promptField: "text", imageNodeId: "3", imageField: "image" },
      workflowId: "", workflowJson: "",
    }],
  }));
  const updateWorkflow = (id: string, patch: Partial<RenderWorkflow>) => setConfig((c) => ({
    ...c, workflows: c.workflows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  }));
  const updateMapping = (id: string, patch: Partial<RenderWorkflow["mapping"]>) => setConfig((c) => ({
    ...c, workflows: c.workflows.map((w) => (w.id === id ? { ...w, mapping: { ...w.mapping, ...patch } } : w)),
  }));
  const removeWorkflow = (id: string) => setConfig((c) => ({ ...c, workflows: c.workflows.filter((w) => w.id !== id) }));

  // ── 素材包预设导入 ──（cloud→RunningHub 后端；local→ComfyUI 后端，逻辑见 aiRenderConfig）
  const importedPaths = new Set(config.workflows.map((w) => w.presetPath).filter(Boolean));

  const importPreset = (p: WorkflowPreset) =>
    setConfig((c) => ({ ...c, workflows: [...c.workflows, buildWorkflowFromPreset(c, p)] }));

  const importMany = (list: WorkflowPreset[]) =>
    setConfig((c) => {
      const have = new Set(c.workflows.map((w) => w.presetPath).filter(Boolean));
      const adds = list.filter((p) => !have.has(p.jsonPath)).map((p) => buildWorkflowFromPreset(c, p));
      return { ...c, workflows: [...c.workflows, ...adds] };
    });

  // 下载工作流 JSON 原文件（同源静态资源，anchor download 即可，无需 fetch）。
  const downloadPresetJson = (p: WorkflowPreset) => {
    const a = document.createElement("a");
    a.href = p.jsonPath;
    a.download = `${presetName(p, locale)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const copyPresetJson = async (p: WorkflowPreset) => {
    try {
      const r = await fetch(p.jsonPath);
      const txt = await r.text();
      await navigator.clipboard.writeText(txt);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* best-effort */ }
  };

  const handleSave = () => {
    saveAiRenderConfig(config);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[560px] max-h-[88vh] overflow-y-auto rounded-2xl p-5"
        style={{ background: "var(--ds-surface, #fff)", boxShadow: "0 12px 48px rgba(0,0,0,0.3)" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold" style={{ color: "var(--ds-text, #111)" }}>{tr.title}</h2>
          <button onClick={onClose} className="text-lg leading-none opacity-50 hover:opacity-100" style={{ color: "var(--ds-text, #111)" }}>×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: "var(--ds-border-soft, #f3f4f6)" }}>
          {(["workflows", "presets", "backends"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={tab === t ? { background: "var(--ds-surface, #fff)", color: "var(--ds-text, #111)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" } : { color: "var(--ds-text-3, #9ca3af)" }}>
              {t === "workflows" ? tr.tabWorkflows : t === "presets" ? tr.tabPresets : tr.tabBackends}
            </button>
          ))}
        </div>

        {/* ───────── 素材包 tab ───────── */}
        {tab === "presets" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px]" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                {tr.presetSummary(WORKFLOW_PRESETS.length, WORKFLOW_PRESETS.filter((p) => p.cloud).length, WORKFLOW_PRESETS.filter((p) => !p.cloud).length)}
                <br />{tr.presetHint}
              </p>
              <button onClick={() => importMany(WORKFLOW_PRESETS)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #0ea5e9, #6366f1)" }}>{tr.importAll}</button>
            </div>
            {PRESET_CATEGORIES.map((cat) => {
              const list = WORKFLOW_PRESETS.filter((p) => p.category === cat);
              return (
                <div key={cat} className="rounded-xl p-2.5" style={{ border: "1px solid var(--ds-border, #e5e7eb)" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold" style={{ color: "var(--ds-text, #111)" }}>{presetCategoryLabel(cat, locale)}</span>
                    <button onClick={() => importMany(list)} className="text-[10px] text-indigo-600 hover:underline font-semibold">{tr.importCategory(list.length)}</button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {list.map((p) => {
                      const done = importedPaths.has(p.jsonPath);
                      return (
                        <div key={p.id} className="flex items-center gap-2 text-[11px]">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0"
                            style={p.cloud ? { background: "#eef2ff", color: "#4338ca" } : { background: "#ecfdf5", color: "#047857" }}>
                            {p.cloud ? tr.tagCloud : tr.tagLocal}
                          </span>
                          <span className="flex-1 min-w-0 truncate" style={{ color: "var(--ds-text-2, #4b5563)" }} title={presetName(p, locale)}>{presetName(p, locale)}</span>
                          {p.cloud && (
                            <button onClick={() => copyPresetJson(p)} className="shrink-0 text-[10px] text-indigo-600 hover:underline">
                              {copiedId === p.id ? tr.copied : tr.copyJson}
                            </button>
                          )}
                          <button onClick={() => downloadPresetJson(p)}
                            className="shrink-0 text-[10px] text-indigo-600 hover:underline">
                            {tr.downloadJson}
                          </button>
                          <button onClick={() => importPreset(p)} disabled={done}
                            className="shrink-0 text-[10px] font-semibold disabled:opacity-40"
                            style={{ color: done ? "var(--ds-text-3, #9ca3af)" : "#0ea5e9" }}>
                            {done ? tr.imported : tr.importOne}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ───────── 后端 tab ───────── */}
        {tab === "backends" && (
          <div className="flex flex-col gap-3">
            {config.backends.map((b) => (
              <div key={b.id} className="p-3 rounded-xl" style={{ border: "1px solid var(--ds-border, #e5e7eb)" }}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label style={labelStyle}>{tr.fieldName}</label>
                    <input value={localizeBackendName(b, locale)} onChange={(e) => updateBackend(b.id, { name: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>{tr.fieldKind}</label>
                    <select value={b.kind} onChange={(e) => {
                      const kind = e.target.value as BackendKind;
                      updateBackend(b.id, { kind, baseUrl: defaultBaseUrl(kind) || b.baseUrl });
                    }} style={inputStyle}>
                      {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-2">
                  <label style={labelStyle}>{tr.fieldBaseUrl}</label>
                  <input value={b.baseUrl ?? ""} onChange={(e) => updateBackend(b.id, { baseUrl: e.target.value })}
                    placeholder={defaultBaseUrl(b.kind) || "http://your-comfyui:8188"} style={inputStyle} />
                </div>
                {b.kind !== "comfyui-local" && (
                  <div className="mt-2">
                    <label style={labelStyle}>{b.kind === "runninghub" ? tr.fieldApiKeyReq : tr.fieldApiKeyOpt}</label>
                    <input type="password" autoComplete="off" value={b.apiKey ?? ""} onChange={(e) => updateBackend(b.id, { apiKey: e.target.value })}
                      placeholder={tr.apiKeyPlaceholder} style={inputStyle} />
                  </div>
                )}
                <button onClick={() => removeBackend(b.id)} className="mt-2 text-[10px] text-red-500 hover:underline">{tr.removeBackend}</button>
              </div>
            ))}
            <button onClick={addBackend} className="py-2 rounded-xl text-xs font-semibold border-2 border-dashed"
              style={{ borderColor: "var(--ds-border, #e5e7eb)", color: "var(--ds-text-2, #4b5563)" }}>{tr.addBackend}</button>
          </div>
        )}

        {/* ───────── 工作流 tab ───────── */}
        {tab === "workflows" && (
          <div className="flex flex-col gap-3">
            {config.workflows.length === 0 && (
              <p className="text-[11px] text-center py-3" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                {tr.noWorkflows}
              </p>
            )}
            {config.workflows.map((w) => {
              const backend = config.backends.find((b) => b.id === w.backendId);
              const isComfy = backend?.kind === "comfyui-local" || backend?.kind === "comfyui-http";
              return (
                <div key={w.id} className="p-3 rounded-xl" style={{ border: "1px solid var(--ds-border, #e5e7eb)" }}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label style={labelStyle}>{tr.fieldWfName}</label>
                      <input value={localizeWorkflowName(w, locale)} onChange={(e) => updateWorkflow(w.id, { name: e.target.value })} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{tr.fieldBackend}</label>
                      <select value={w.backendId} onChange={(e) => updateWorkflow(w.id, { backendId: e.target.value })} style={inputStyle}>
                        {config.backends.map((b) => <option key={b.id} value={b.id}>{localizeBackendName(b, locale)}</option>)}
                      </select>
                    </div>
                  </div>

                  {isComfy ? (
                    <div className="mt-2">
                      <label style={labelStyle}>{tr.fieldWfJson}</label>
                      <textarea value={w.workflowJson ?? ""} onChange={(e) => updateWorkflow(w.id, { workflowJson: e.target.value })}
                        rows={3} placeholder='{"3":{"class_type":"KSampler","inputs":{...}}, ...}'
                        style={{ ...inputStyle, fontFamily: "monospace", fontSize: 10 }} />
                    </div>
                  ) : (
                    <div className="mt-2">
                      <label style={labelStyle}>{tr.fieldWorkflowId}</label>
                      <input value={w.workflowId ?? ""} onChange={(e) => updateWorkflow(w.id, { workflowId: e.target.value })} style={inputStyle} />
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2 mt-2">
                    <div><label style={labelStyle}>{tr.fieldPromptNode}</label><input value={w.mapping.promptNodeId ?? ""} onChange={(e) => updateMapping(w.id, { promptNodeId: e.target.value })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>{tr.fieldPromptField}</label><input value={w.mapping.promptField ?? ""} onChange={(e) => updateMapping(w.id, { promptField: e.target.value })} placeholder="text" style={inputStyle} /></div>
                    <div><label style={labelStyle}>{tr.fieldImageNode}</label><input value={w.mapping.imageNodeId ?? ""} onChange={(e) => updateMapping(w.id, { imageNodeId: e.target.value })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>{tr.fieldImageField}</label><input value={w.mapping.imageField ?? ""} onChange={(e) => updateMapping(w.id, { imageField: e.target.value })} placeholder="image" style={inputStyle} /></div>
                  </div>

                  <label className="flex items-center gap-2 mt-2 text-[11px]" style={{ color: "var(--ds-text-2, #4b5563)" }}>
                    <input type="checkbox" checked={w.needsImage} onChange={(e) => updateWorkflow(w.id, { needsImage: e.target.checked })} />
                    {tr.needsImage}
                  </label>
                  <button onClick={() => removeWorkflow(w.id)} className="mt-2 text-[10px] text-red-500 hover:underline">{tr.removeWorkflow}</button>
                </div>
              );
            })}
            <button onClick={addWorkflow} className="py-2 rounded-xl text-xs font-semibold border-2 border-dashed"
              style={{ borderColor: "var(--ds-border, #e5e7eb)", color: "var(--ds-text-2, #4b5563)" }}>{tr.addWorkflow}</button>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold" style={{ background: "var(--ds-border-soft, #f3f4f6)", color: "var(--ds-text-2, #4b5563)" }}>{tr.cancel}</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ background: saved ? "#10b981" : "linear-gradient(135deg, #0ea5e9, #6366f1)" }}>
            {saved ? tr.saved : tr.save}
          </button>
        </div>
      </div>
    </div>
  );
}
