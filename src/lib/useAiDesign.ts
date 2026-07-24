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
import { matchProjectTemplate } from "./matchProjectTemplate";
import type { AiDesignMode } from "./aiDesignTypes";
import { useLocale } from "./i18n";

export interface UseAiDesign {
  aiInput: string;
  setAiInput: (v: string) => void;
  /** 参考房间照片（data URL）。非空时走视觉模型「按图复刻房间」。 */
  aiImage: string | null;
  setAiImage: (v: string | null) => void;
  aiLoading: boolean;
  /** 实时处理进度文案（带已用秒数），生成中显示，让用户知道没卡死 */
  aiStatus: string | null;
  aiError: string | null;
  aiSummary: string | null;
  clearMessages: () => void;
  /** 触发生成：create=重建，edit=在当前设计上增量改 */
  generate: (mode: AiDesignMode) => void;
  /** 取消进行中的生成（中止请求并复位 loading）。模板底子若已套用会保留。 */
  cancel: () => void;
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
  const [aiImage, setAiImage] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [keyPrompt, setKeyPrompt] =
    useState<{ run: (provider: AiProviderId, key: string) => void } | null>(null);
  // 计时器：生成中每秒刷新「已用 Ns」，让进度条不像卡死
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 进行中请求的中止控制器 + 中止原因（区分「用户取消」和「超时」的提示文案）。
  // 之前 fetch 无超时也不可取消：BYOK 模型卡住时弹窗 239s 干转、还关不掉（用户实拍）。
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<"user" | "timeout" | null>(null);

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
    if (!desc && !aiImage) return;
    setAiLoading(true);
    setAiError(null);
    setAiSummary(null);
    const genLabel = aiImage
      ? (en ? "AI is reading the reference photo…" : "AI 正在识别参考图并复刻房间…")
      : mode === "edit"
        ? (en ? "AI is fine-tuning the design…" : "AI 正在微调设计…")
        : (en ? "AI is generating the design…" : "AI 正在生成设计…");
    try {
      const body: Record<string, unknown> = { description: desc, provider, apiKey: key, mode };
      if (aiImage) body.image = aiImage;
      // 「模板底子 + AI 增量」：从零生成前先看描述是否命中精修模板（咖啡馆/餐厅/
      // 办公/各风格别墅）。命中 → 秒套模板当底子，再序列化成 current 转 edit 模式，
      // AI 只按描述里的具体要求调整——借鉴模板数据 + 结合用户想法，而不是从零瞎生成
      // （用户实拍：说"临街咖啡馆"给了个带泳池的别墅）。没命中才走原从零生成。
      let baseTpl: ReturnType<typeof matchProjectTemplate> = null;
      if (mode === "create" && !aiImage) {
        baseTpl = matchProjectTemplate(desc);
        if (baseTpl) {
          setAiStatus(en ? `Applying "${baseTpl.nameEn}" as the base…` : `已套用「${baseTpl.name}」模板作底子…`);
          useDesignerStore.getState().applyProjectTemplate(baseTpl.id);
          const { floorPlans, exterior, yardPlan } = useDesignerStore.getState();
          body.mode = "edit";
          body.current = serializeCurrentDesign(floorPlans, exterior, yardPlan);
        }
      }
      if (mode === "edit") {
        setAiStatus(en ? "Packing the current design…" : "正在打包当前设计…");
        const { floorPlans, exterior, yardPlan } = useDesignerStore.getState();
        body.current = serializeCurrentDesign(floorPlans, exterior, yardPlan);
      }
      // 进入「等大模型」阶段：启动秒级计时，让用户看到一直在跑
      startStatusTimer(baseTpl
        ? (en ? `Tuning the "${baseTpl.nameEn}" base to your description…` : `AI 正在「${baseTpl.name}」底子上按你的描述调整…`)
        : genLabel);
      // 可取消 + 3 分钟超时：BYOK 模型偶发挂死，请求必须能中止。
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      abortReasonRef.current = null;
      const timeoutTimer = setTimeout(() => { abortReasonRef.current = "timeout"; ctrl.abort(); }, 180_000);
      let res: Response;
      try {
        res = await fetch("/api/ai-design", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeoutTimer);
        abortRef.current = null;
      }
      const data = await res.json();
      if (!res.ok || data.error) {
        // 401 = key 缺失/失效：清掉该平台本地 key 并重新弹窗
        if (res.status === 401) {
          setAiKey(provider, "");
          setKeyPrompt({ run: (p, k) => void doGenerate(p, k, mode) });
          return;
        }
        // 模板底子已经落在画布上——AI 调整失败也不白跑，如实告知。
        setAiError(baseTpl
          ? (en ? `Applied the "${baseTpl.nameEn}" template, but the AI tweak failed — retry or edit manually.` : `已套用「${baseTpl.name}」模板，但 AI 调整失败——可重试或手动微调。`)
          : (data.error ?? (en ? "AI generation failed, please retry" : "AI 生成失败，请重试")));
        return;
      }
      setAiStatus(en ? "Applying to the canvas…" : "正在应用到画布…");
      // 模板底子路径实际发的是 edit —— 增量合并到刚套的模板上，别整套覆盖。
      applyAiDesign(data, { merge: mode === "edit" || !!baseTpl });
      setAiSummary(baseTpl
        ? (en ? `Based on the "${baseTpl.nameEn}" template: ${data.summary ?? "applied!"}` : `已基于「${baseTpl.name}」模板：${data.summary ?? "设计已应用！"}`)
        : (data.summary ?? (en ? "Design applied!" : "设计已应用！")));
      // 增量微调：留在用户当前所在的房间/视图，别跳到外观图打断他。
      // 仅「从零重建」才切到外观图总览。
      if (mode !== "edit") setViewMode("exterior");
      opts?.onApplied?.();
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (aborted) {
        const why = abortReasonRef.current === "timeout"
          ? (en ? "Timed out after 3 min — request aborted." : "生成超过 3 分钟已中止。")
          : (en ? "Cancelled." : "已取消。");
        setAiError(en
          ? `${why}${" The template base (if any) is already on the canvas — retry or edit manually."}`
          : `${why}模板底子（若已套用）仍在画布上——可重试或手动微调。`);
      } else {
        setAiError(en ? "Network error, please check your connection and retry" : "网络错误，请检查连接后重试");
      }
    } finally {
      stopStatusTimer();
      setAiLoading(false);
    }
  }

  /** 取消进行中的生成：中止 fetch（catch 里给出「已取消」提示并复位 loading）。 */
  const cancel = () => {
    if (abortRef.current) {
      abortReasonRef.current = "user";
      abortRef.current.abort();
    }
  };

  const generate = (mode: AiDesignMode) => {
    if (!aiInput.trim() && !aiImage) return;
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
    aiInput, setAiInput, aiImage, setAiImage, aiLoading, aiStatus, aiError, aiSummary,
    clearMessages, generate, cancel, keyPrompt, onKeySave, onKeyClose, onKeyRemove, configureKey,
  };
}
