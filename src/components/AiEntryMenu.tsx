"use client";

import { useState, useRef, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import { useAiRender } from "@/lib/useAiRender";
import { getAiRenderConfig, ensureWorkflowForPreset, type RenderWorkflow, type AiRenderConfig } from "@/lib/aiRenderConfig";
import { WORKFLOW_PRESETS, type WorkflowPreset } from "@/lib/workflowPresets";
import { buildViewPrompt, captureCanvas } from "@/lib/aiRenderShared";
import type { ViewMode } from "@/lib/types";
import AiRenderSettingsModal from "./AiRenderSettingsModal";

// ─── 统一 AI 入口：右下角单按钮 + 分层弹出菜单 ─────────────────────────────
// 把原先分散的三个入口收成一个：
//   ⚡ 一键出图       —— 按当前视图自动选默认推荐工作流（原 QuickRenderButton）
//   🎨 选预设出图     —— 列出已配置的全部工作流，手动挑一条跑（原 CloudRenderButton）
//   ✨ 生成式精修     —— 打开 AiRenderModal（截图→ControlNet/链式/IP-Adapter，富 UX）
//   📷 导入参考图     —— 从参考图片导入设计风格
// ⚡/🎨 共用 useAiRender + aiRenderShared；✨/📷 复用已有 window 事件（与 TopBar 一致）。

interface ViewTarget { presetName: string; label: string }

// 六站全覆盖：每一站默认推荐一个工作流（云端 + 需输入图），配合截图一键直出。
const VIEW_TARGET: Partial<Record<ViewMode, ViewTarget>> = {
  all:      { presetName: "平面图出彩屏方案", label: "一键全屋彩平图" },
  "2d":     { presetName: "平面图出效果图",   label: "一键平面图→效果图" },
  "3d":     { presetName: "香蕉白膜渲染",     label: "一键效果图渲染" },
  global3d: { presetName: "香蕉白膜渲染",     label: "一键全局3D渲染" },
  yard2d:   { presetName: "彩屏工作流",       label: "一键院子→效果图" },
  exterior: { presetName: "外立面出效果图",   label: "一键外观→效果图" },
};

// ⚡ 一键能不能直接跑？判定该预设对应的后端凭证是否齐备。
//   - cloud(RunningHub)：要有 runninghub 后端 + apiKey，且已导入的工作流填了 workflowId
//     （首次自动导入的 workflowId 是空的，所以必须先去 ⚙️ 配一次）。
//   - local(ComfyUI)：有 comfyui 后端即可（预设自带 presetPath，无需 key）。
// 返回 { ready, reason }：reason 用于在菜单副标题里给出「差哪一步」的明确提示。
function quickReadiness(config: AiRenderConfig, preset: WorkflowPreset): { ready: boolean; reason: string } {
  if (preset.cloud) {
    const backend = config.backends.find((b) => b.kind === "runninghub");
    if (!backend?.apiKey?.trim()) return { ready: false, reason: "需先在 ⚙️ 填 RunningHub Key" };
    const wf = config.workflows.find((w) => w.presetPath === preset.jsonPath);
    if (!wf?.workflowId?.trim()) return { ready: false, reason: "需在 ⚙️ 填该工作流的 workflowId" };
    return { ready: true, reason: "" };
  }
  const local = config.backends.find((b) => b.kind === "comfyui-local" || b.kind === "comfyui-http");
  if (!local) return { ready: false, reason: "需先在 ⚙️ 配本地 ComfyUI 后端" };
  if (local.kind === "comfyui-http" && !local.baseUrl?.trim()) return { ready: false, reason: "需在 ⚙️ 填 ComfyUI 地址" };
  return { ready: true, reason: "" };
}

export default function AiEntryMenu() {
  const [open, setOpen]                 = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig]             = useState<AiRenderConfig>({ backends: [], workflows: [] });
  const menuRef                         = useRef<HTMLDivElement>(null);

  const { phase, images, error, generate, reset } = useAiRender();

  const viewMode    = useDesignerStore((s) => s.viewMode);
  const exterior    = useDesignerStore((s) => s.exterior);
  const floorPlans  = useDesignerStore((s) => s.floorPlans);
  const activeFloor = useDesignerStore((s) => s.activeFloor);

  // 配置在「打开菜单」「从设置返回」时按需刷新（不放 effect，避免级联渲染）
  const toggleMenu = () => {
    setOpen((v) => {
      if (!v) setConfig(getAiRenderConfig());
      return !v;
    });
  };
  const closeSettings = () => { setSettingsOpen(false); setConfig(getAiRenderConfig()); };

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const target = VIEW_TARGET[viewMode];
  const quickPreset = target ? WORKFLOW_PRESETS.find((p) => p.name === target.presetName) : undefined;
  // ⚡ 凭证是否齐备（cloud 预设要 RunningHub Key + workflowId；local 要 ComfyUI 后端）
  const quickStatus = quickPreset ? quickReadiness(config, quickPreset) : null;

  const promptForView = () =>
    buildViewPrompt({ viewMode, exterior, yardItems: floorPlans[activeFloor].yardPlan?.items ?? [] });

  // ⚡ 一键：按当前视图推荐预设
  const runQuick = async () => {
    setOpen(false);
    if (!quickPreset) { setSettingsOpen(true); return; }
    // 凭证没配齐：别让用户点了才失败，直接领去设置补齐
    if (quickStatus && !quickStatus.ready) { setSettingsOpen(true); return; }
    reset();
    const wf = ensureWorkflowForPreset(quickPreset);
    const image = wf.needsImage ? (captureCanvas() ?? undefined) : undefined;
    await generate({ workflow: wf, prompt: promptForView(), image });
  };

  // 🎨 选预设：跑任意一条已配置工作流
  const runWorkflow = async (wf: RenderWorkflow) => {
    setOpen(false);
    reset();
    const image = wf.needsImage ? (captureCanvas() ?? undefined) : undefined;
    await generate({ workflow: wf, prompt: promptForView(), image });
  };

  const busy = phase === "uploading" || phase === "submitting" || phase === "rendering";
  const phaseLabel: Record<string, string> = {
    uploading: "上传截图中…",
    submitting: "提交任务…",
    rendering: "渲染中（约 1–3 分钟）…",
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggleMenu}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold shadow-lg transition-all active:scale-95 hover:scale-105 disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #6366f1, #818cf8)", backdropFilter: "blur(6px)" }}
        title="AI 出图 / 渲染 — 一键 · 选预设 · 生成式精修 · 导入参考图"
      >
        <span>{busy ? "⏳" : "✨"}</span>
        <span>{busy ? "渲染中…" : "AI 渲染"}</span>
        <span className="ml-0.5 opacity-70">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 rounded-2xl overflow-hidden z-50"
          style={{ background: "var(--ds-surface, #fff)", border: "1px solid var(--ds-border, #e5e7eb)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>

          {/* 头 */}
          <div className="flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--ds-text-3, #9ca3af)", borderBottom: "1px solid var(--ds-border, #e5e7eb)" }}>
            <span>AI 出图 / 渲染</span>
            <button onClick={() => { setOpen(false); setSettingsOpen(true); }} title="管理后端与工作流" className="text-sm opacity-70 hover:opacity-100">⚙️</button>
          </div>

          {/* ⚡ 一键 */}
          {target && (
            <button onClick={runQuick}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors hover:bg-indigo-50"
              style={{ borderBottom: "1px solid var(--ds-border-soft, #f3f4f6)" }}>
              <span className="text-xl w-7 text-center shrink-0">{quickStatus && !quickStatus.ready ? "⚙️" : "⚡"}</span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold leading-tight" style={{ color: "var(--ds-text, #111)" }}>{target.label}</span>
                <span className="text-[10px] mt-0.5" style={{ color: quickStatus && !quickStatus.ready ? "#d97706" : "var(--ds-text-3, #9ca3af)" }}>
                  {!quickPreset
                    ? "未找到推荐预设 · 点 ⚙️ 配置"
                    : quickStatus && !quickStatus.ready
                      ? `${quickStatus.reason}（点这里去配）`
                      : `自动用「${target.presetName}」· 当前视图截图`}
                </span>
              </div>
            </button>
          )}

          {/* 🎨 选预设 */}
          <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            选其他工作流
          </div>
          {config.workflows.length === 0 ? (
            <div className="px-3 pb-2 text-[11px] leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
              还没配置工作流。点 ⚙️ 选后端（本地 ComfyUI / RunningHub 云 / 自建），添加工作流即可。
            </div>
          ) : (
            config.workflows.map((wf) => {
              const backend = config.backends.find((b) => b.id === wf.backendId);
              return (
                <button key={wf.id} onClick={() => runWorkflow(wf)}
                  className="flex items-center gap-3 w-full px-3 py-2 text-left transition-colors hover:bg-indigo-50"
                  style={{ borderBottom: "1px solid var(--ds-border-soft, #f3f4f6)" }}>
                  <span className="text-base w-7 text-center shrink-0">{wf.needsImage ? "🖼️" : "✨"}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold leading-tight truncate" style={{ color: "var(--ds-text, #111)" }}>{wf.name}</span>
                    <span className="text-[10px] mt-0.5 truncate" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                      {backend?.name ?? "未绑定后端"}{wf.needsImage ? " · 用截图" : " · 纯文生图"}
                    </span>
                  </div>
                </button>
              );
            })
          )}

          {/* ✨ 生成式精修 + 📷 导入参考图 */}
          <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            进阶
          </div>
          <button onClick={() => { setOpen(false); window.dispatchEvent(new Event("openAiRender")); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors hover:bg-indigo-50"
            style={{ borderBottom: "1px solid var(--ds-border-soft, #f3f4f6)" }}>
            <span className="text-xl w-7 text-center shrink-0">🎛️</span>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold leading-tight" style={{ color: "var(--ds-text, #111)" }}>生成式精修</span>
              <span className="text-[10px] mt-0.5" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                截图引导 · ControlNet / 链式多角度 / 模型 / 提示词
              </span>
            </div>
          </button>
          <button onClick={() => { setOpen(false); window.dispatchEvent(new Event("openImport")); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors hover:bg-indigo-50">
            <span className="text-xl w-7 text-center shrink-0">📷</span>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold leading-tight" style={{ color: "var(--ds-text, #111)" }}>导入参考图</span>
              <span className="text-[10px] mt-0.5" style={{ color: "var(--ds-text-3, #9ca3af)" }}>从参考图片提取设计风格</span>
            </div>
          </button>
        </div>
      )}

      {/* 进度 / 错误 / 结果 —— 固定右下角浮层（与原 ⚡ 行为一致） */}
      {busy && (
        <div className="fixed bottom-4 right-4 z-40 w-72 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed"
          style={{ background: "#eff6ff", border: "1px solid #93c5fd", color: "#1e40af", boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
          ⏳ {phaseLabel[phase] ?? "处理中…"}
        </div>
      )}
      {phase === "error" && error && (
        <div className="fixed bottom-4 right-4 z-40 w-72 px-3 py-2.5 rounded-xl text-[11px] leading-relaxed"
          style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
          ⚠️ {error}
          <div className="mt-1.5 flex gap-2">
            <button onClick={() => { reset(); setSettingsOpen(true); }} className="underline font-semibold">去设置</button>
            <button onClick={reset} className="opacity-70">关闭</button>
          </div>
        </div>
      )}
      {phase === "done" && images.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 w-80 p-2 rounded-xl"
          style={{ background: "var(--ds-surface, #fff)", border: "1px solid #6ee7b7", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-emerald-700">✅ 出图完成</span>
            <button onClick={reset} className="text-sm opacity-50 hover:opacity-100">×</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[0]} alt="渲染结果" className="w-full rounded-lg" />
          <a href={images[0]} target="_blank" rel="noopener" className="block mt-1.5 text-center text-[11px] font-semibold text-indigo-600 underline">
            在新标签页打开 / 下载
          </a>
        </div>
      )}

      <AiRenderSettingsModal open={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
