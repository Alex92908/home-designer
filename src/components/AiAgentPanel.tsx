"use client";
/**
 * AiAgentPanel —— 对话式设计 agent 面板。
 *
 * 和「文生设计」单发弹窗的区别:这里是**多轮对话**,模型可以边看边改 ——
 * 读契约 → 套模板底子 → 增量微调 → 核对结果,失败了自己修。你可以接着说
 * 「吧台移到靠窗」,它在**当前画布**上继续改,而不是从头重生成。
 *
 * 后端 /api/ai-agent 用 SSE 推送事件,这里逐条渲染成「它正在做什么」:
 *   text → 模型的话;tool → 正在调哪个工具;tool_result → 成功/失败
 *
 * 密钥复用既有的 aiKeys(localStorage,只存本机),用户不用重复配置。
 */
import { useEffect, useRef, useState } from "react";
import { getAiKey, setAiKey, getSelectedProvider, setSelectedProvider } from "@/lib/aiKeys";
import ApiKeyPromptModal from "./ApiKeyPromptModal";
import { getAiProvider, supportsAgent, agentModelOf } from "@/lib/aiProviders";
import { useLocale } from "@/lib/i18n";
import { getBridgeTabId } from "@/lib/useMcpBridge";

type Step = { kind: "tool"; name: string; args: string; ok?: boolean };
type Turn = { role: "user" | "assistant"; content: string; steps?: Step[] };

const TOOL_LABEL: Record<string, string> = {
  get_design_guide: "读取设计契约",
  list_templates: "查看可用模板",
  apply_project_template: "套用模板",
  apply_design: "应用设计改动",
  get_design_state: "核对画布现状",
  open_preview: "查看预览方式",
};

/** 挂在页面上,监听 "openAiAgent" 事件开面板(与 openAiDesign / openAiRender 同一套机制)。 */
export function AiAgentPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("openAiAgent", onOpen);
    return () => window.removeEventListener("openAiAgent", onOpen);
  }, []);
  if (!open) return null;
  return <AiAgentPanel onClose={() => setOpen(false)} />;
}

export default function AiAgentPanel({ onClose }: { onClose: () => void }) {
  const locale = useLocale();
  const en = locale === "en";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  // 面板可拖动:它常挡住校验报告/右侧面板,固定死在右下角很碍事(用户实拍)。
  // pos=null 时用默认锚定(桌面右下、手机贴底);一旦拖过就改用 fixed 坐标。
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // 随时叫停:agent 跑偏时(反复重试、方向错了)不该只能干等它跑完。
  const abortRef = useRef<AbortController | null>(null);
  const stop = () => { abortRef.current?.abort(); abortRef.current = null; setBusy(false); };
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const onDragStart = (e: React.PointerEvent) => {
    const r = panelRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const w = panelRef.current?.offsetWidth ?? 320;
    const h = panelRef.current?.offsetHeight ?? 200;
    // 夹在视口内,别拖出去找不回来
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - w, e.clientX - d.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy)),
    });
  };
  const onDragEnd = () => { dragRef.current = null; };
  // 改完 key/平台后强制重读(provider 来自 localStorage,不是响应式的)
  const [, setTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const provider = getAiProvider(getSelectedProvider());
  const canAgent = supportsAgent(provider);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setErr("");
    setInput("");
    const history = [...turns, { role: "user" as const, content: text }];
    setTurns([...history, { role: "assistant", content: "", steps: [] }]);
    setBusy(true);

    // 只把纯文本对话历史发给模型;工具调用记录由服务端在单次请求内自行维护。
    // 助手轮把「做过哪些工具动作」一并回传:否则模型只看到自己的总结文字,
    // 不记得套过哪个模板、改过什么,续聊时容易重复劳动或凭空乱改。
    const payload = {
      messages: history.map(t => {
        if (t.role !== "assistant" || !t.steps?.length) return { role: t.role, content: t.content };
        const done = t.steps.map(s => `${TOOL_LABEL[s.name] ?? s.name}${s.args ? `(${s.args})` : ""}`).join("、");
        return { role: t.role, content: `${t.content}\n\n[已执行工具:${done}]` };
      }),
      provider: provider.id,
      apiKey: getAiKey(provider.id),
      // 带上本标签的桥身份:让工具命令落到**用户眼前这一页**,而不是碰巧持有租约的别的标签
      tabId: getBridgeTabId(),
    };

    try {
      const ac = new AbortController();
      abortRef.current = ac;
      const res = await fetch("/api/ai-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t.slice(0, 200) || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // SSE:事件之间用空行分隔
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          setTurns(prev => {
            const next = [...prev];
            const cur = { ...next[next.length - 1] };
            const steps = [...(cur.steps ?? [])];
            if (ev.type === "text") {
              cur.content = (cur.content ? cur.content + "\n" : "") + String(ev.text ?? "");
            } else if (ev.type === "tool") {
              steps.push({ kind: "tool", name: String(ev.name ?? ""), args: String(ev.args ?? "") });
            } else if (ev.type === "tool_result") {
              for (let i = steps.length - 1; i >= 0; i--) {
                if (steps[i].name === ev.name && steps[i].ok === undefined) { steps[i] = { ...steps[i], ok: !!ev.ok }; break; }
              }
            } else if (ev.type === "error") {
              setErr(String(ev.message ?? "failed"));
            }
            cur.steps = steps;
            next[next.length - 1] = cur;
            return next;
          });
        }
      }
    } catch (e) {
      // 主动叫停不算错误
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setErr(e instanceof Error ? e.message : "请求失败");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  return (
    <div
      ref={panelRef}
      className={`fixed z-[9999] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden ${
        pos ? "sm:w-[400px]" : "inset-x-0 bottom-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[400px]"
      }`}
      style={{
        ...(pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto", width: 400 } : {}),
        maxHeight: "min(78vh, 620px)",
        background: "var(--ds-surface, #fff)",
        border: "1px solid var(--ds-border, #e5e7eb)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
      }}
    >
      {/* 标题栏 */}
      {/* 标题栏即拖动把手 */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0 cursor-move select-none"
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
        style={{ borderBottom: "1px solid var(--ds-border, #e5e7eb)", touchAction: "none" }}>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold" style={{ color: "var(--ds-text, #111)" }}>
            ✨ {en ? "Design agent" : "设计 agent"}
          </span>
          <span className="text-[10px] truncate" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            {provider.label} · {agentModelOf(provider)}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* 与「文生设计」共用同一份密钥存储(aiKeys),所以这里不做第二套设置,
              只是把同一个弹窗在 agent 面板里也能唤起 —— 改哪边都生效。 */}
          <button onClick={() => setKeyOpen(true)} title={en ? "Model & API key" : "模型与 API Key"}
            className="text-sm px-1.5 opacity-60 hover:opacity-100">⚙️</button>
          <button onClick={onClose} className="text-sm px-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      </div>

      {keyOpen && (
        <ApiKeyPromptModal
          initialProvider={getSelectedProvider()}
          getSavedKey={getAiKey}
          onSave={(p, k) => { setAiKey(p, k); setSelectedProvider(p); setKeyOpen(false); setTick(n => n + 1); }}
          onClose={() => setKeyOpen(false)}
        />
      )}

      {/* 对话区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {!turns.length && (
          <div className="text-[11px] leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            {en
              ? "Describe what you want and I'll edit the canvas step by step — pick a template, tune rooms, verify. Then keep talking to refine."
              : "说出你想要的,我会一步步改画布:挑模板打底 → 微调房间 → 核对结果。改完可以接着说「吧台移到靠窗」继续调。"}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(en
                ? ["Design a small café", "Make the living room warmer", "Add a study upstairs"]
                : ["帮我设计一间小咖啡馆", "客厅换成暖色调", "二楼加个书房"]
              ).map(s => (
                <button key={s} onClick={() => setInput(s)}
                  className="px-2 py-1 rounded-lg text-[11px]"
                  style={{ background: "var(--ds-bg-soft, #f3f4f6)", color: "var(--ds-text-2, #374151)" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
            {t.role === "user" ? (
              <div className="px-3 py-1.5 rounded-2xl text-xs max-w-[85%]"
                style={{ background: "#6366f1", color: "#fff" }}>{t.content}</div>
            ) : (
              <div className="space-y-1">
                {t.steps?.map((s, j) => (
                  <div key={j} className="flex items-center gap-1.5 text-[11px]"
                    style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                    <span>{s.ok === undefined ? "⏳" : s.ok ? "✅" : "⚠️"}</span>
                    <span>{TOOL_LABEL[s.name] ?? s.name}</span>
                    {s.args && <span className="truncate opacity-70">· {s.args}</span>}
                  </div>
                ))}
                {t.content && (
                  <div className="text-xs whitespace-pre-wrap leading-relaxed"
                    style={{ color: "var(--ds-text, #111)" }}>{t.content}</div>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && <div className="text-[11px]" style={{ color: "var(--ds-text-3, #9ca3af)" }}>思考中…</div>}
        {err && <div className="text-[11px] px-2 py-1 rounded-lg" style={{ background: "#fef2f2", color: "#b91c1c" }}>{err}</div>}
        {!canAgent && (
          <div className="text-[11px] px-2 py-1.5 rounded-lg" style={{ background: "#fffbeb", color: "#b45309" }}>
            {en
              ? `${provider.label} has no tool-calling tier configured — switch provider in AI settings.`
              : `${provider.label} 暂未配置支持工具调用的模型档位,请在 AI 助手设置里换一个平台(推荐 DeepSeek / 智谱 GLM)。`}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex items-end gap-2 p-2 shrink-0" style={{ borderTop: "1px solid var(--ds-border, #e5e7eb)" }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder={en ? "Describe the change…" : "说说你想怎么改…"}
          className="flex-1 resize-none px-3 py-2 rounded-xl text-xs outline-none"
          style={{ background: "var(--ds-bg-soft, #f3f4f6)", color: "var(--ds-text, #111)", maxHeight: 96 }}
        />
        {/* 跑起来后变成「停止」——跑偏时能立刻叫停,不必干等它跑完 */}
        <button
          onClick={busy ? stop : send}
          disabled={!busy && (!input.trim() || !canAgent)}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40 shrink-0"
          style={{ background: busy ? "#ef4444" : "linear-gradient(135deg, #6366f1, #818cf8)" }}
        >
          {busy ? (en ? "Stop" : "停止") : en ? "Send" : "发送"}
        </button>
      </div>
    </div>
  );
}
