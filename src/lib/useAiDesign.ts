"use client";

/**
 * 文生设计共享 hook —— 把「描述 → /api/ai-design → applyAiDesign」这条链
 * 从 FloorPlanAll 里抽出来，让全局对话框（AiDesignDialog）与概览页共用同一套
 * BYOK 取 key、create/edit 两种模式、错误处理逻辑，避免分叉。
 *
 *   mode "create"：从零生成整套住宅。
 *   mode "edit"  ：增量微调——把当前设计快照（serializeCurrentDesign）交给模型，
 *                  只改用户提到的部分，其余保持不变。
 *
 * BYOK：选中平台有 key 就直接跑；没 key 就置 keyPrompt 让上层弹出 ApiKeyPromptModal，
 * 填好后跑挂起的动作。密钥只存浏览器本地、随请求转发、不落服务端、不回显。
 */
import { useRef, useState } from "react";
import { useDesignerStore } from "./store";
import { getAiKey, setAiKey, getSelectedProvider, setSelectedProvider } from "./aiKeys";
import type { AiProviderId } from "./aiProviders";
import { serializeCurrentDesign } from "./aiDesignSerialize";
import type { AiDesignMode } from "./aiDesignTypes";
import { useLocale } from "./i18n";

export interface UseAiDesign {
  aiInput: string;
  setAiInput: (v: string) => void;
  aiLoading: boolean;
  /** 实时处理进度文案（带已用秒数），生成中显示，让用户知道没卡死 */
  aiStatus: string | null;
  aiError: string | null;
  aiSummary: string | null;
  clearMessages: () => void;
  /** 触发生成：create=重建，edit=在当前设计上增量改 */
  generate: (mode: AiDesignMode) => void;
  /** 非 null 时上层应渲染 ApiKeyPromptModal */
  keyPrompt: { run: (provider: AiProviderId, key: string) => void } | null;
  onKeySave: (provider: AiProviderId, key: string) => void;
  onKeyClose: () => void;
  /** 清除某平台已存的本地密钥（弹窗「清除已存密钥」按钮用） */
  onKeyRemove: (provider: AiProviderId) => void;
  /** 主动打开 key 设置弹窗（⚙️ 设置按钮用）—— 存完不自动跑生成 */
  configureKey: () => void;
}

export function useAiDesign(opts?: { onApplied?: () => void }): UseAiDesign {
  const en = useLocale() === "en";
  const applyAiDesign = useDesignerStore((s) => s.applyAiDesign);
  const setViewMode = useDesignerStore((s) => s.setViewMode);

  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [keyPrompt, setKeyPrompt] =
    useState<{ run: (provider: AiProviderId, key: string) => void } | null>(null);
  // 计时器：生成中每秒刷新「已用 Ns」，让进度条不像卡死
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 启动一个秒级计时器，把 label + 已用秒数写进 aiStatus
  const startStatusTimer = (label: string) => {
    if (tickRef.current) clearInterval(tickRef.current);
    const t0 = Date.now();
    const render = () => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      setAiStatus(`${label}　已用 ${sec}s`);
    };
    render();
    tickRef.current = setInterval(render, 1000);
  };
  const stopStatusTimer = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setAiStatus(null);
  };

  const ensureAiKey = (run: (provider: AiProviderId, key: string) => void) => {
    const provider = getSelectedProvider();
    const key = getAiKey(provider);
    if (key) run(provider, key);
    else setKeyPrompt({ run });
  };

  async function doGenerate(provider: AiProviderId, key: string, mode: AiDesignMode) {
    const desc = aiInput.trim();
    if (!desc) return;
    setAiLoading(true);
    setAiError(null);
    setAiSummary(null);
    const genLabel = mode === "edit"
      ? (en ? "AI is fine-tuning the design…" : "AI 正在微调设计…")
      : (en ? "AI is generating the design…" : "AI 正在生成设计…");
    try {
      const body: Record<string, unknown> = { description: desc, provider, apiKey: key, mode };
      if (mode === "edit") {
        setAiStatus(en ? "Packing the current design…" : "正在打包当前设计…");
        const { floorPlans, exterior } = useDesignerStore.getState();
        body.current = serializeCurrentDesign(floorPlans, exterior);
      }
      // 进入「等大模型」阶段：启动秒级计时，让用户看到一直在跑
      startStatusTimer(genLabel);
      const res = await fetch("/api/ai-design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // 401 = key 缺失/失效：清掉该平台本地 key 并重新弹窗
        if (res.status === 401) {
          setAiKey(provider, "");
          setKeyPrompt({ run: (p, k) => void doGenerate(p, k, mode) });
          return;
        }
        setAiError(data.error ?? (en ? "AI generation failed, please retry" : "AI 生成失败，请重试"));
        return;
      }
      setAiStatus(en ? "Applying to the canvas…" : "正在应用到画布…");
      applyAiDesign(data, { merge: mode === "edit" });
      setAiSummary(data.summary ?? (en ? "Design applied!" : "设计已应用！"));
      // 增量微调：留在用户当前所在的房间/视图，别跳到外观图打断他。
      // 仅「从零重建」才切到外观图总览。
      if (mode !== "edit") setViewMode("exterior");
      opts?.onApplied?.();
    } catch {
      setAiError(en ? "Network error, please check your connection and retry" : "网络错误，请检查连接后重试");
    } finally {
      stopStatusTimer();
      setAiLoading(false);
    }
  }

  const generate = (mode: AiDesignMode) => {
    if (!aiInput.trim()) return;
    ensureAiKey((provider, key) => void doGenerate(provider, key, mode));
  };

  const onKeySave = (provider: AiProviderId, key: string) => {
    setAiKey(provider, key);
    setSelectedProvider(provider);
    const run = keyPrompt?.run;
    setKeyPrompt(null);
    run?.(provider, key);
  };
  const onKeyClose = () => setKeyPrompt(null);
  // 清除该平台本地密钥（localStorage）。弹窗仍开着，方便用户随即换填新 key。
  const onKeyRemove = (provider: AiProviderId) => setAiKey(provider, "");
  const clearMessages = () => {
    setAiError(null);
    setAiSummary(null);
  };
  // ⚙️ 设置：主动打开 key 弹窗，存完只保存、不触发生成（run 为空操作）。
  const configureKey = () => setKeyPrompt({ run: () => {} });

  return {
    aiInput, setAiInput, aiLoading, aiStatus, aiError, aiSummary,
    clearMessages, generate, keyPrompt, onKeySave, onKeyClose, onKeyRemove, configureKey,
  };
}
