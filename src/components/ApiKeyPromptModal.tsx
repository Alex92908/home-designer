"use client";

import { useState } from "react";
import { AI_PROVIDER_LIST, AiProviderId, getAiProvider } from "@/lib/aiProviders";
import { useT, useLocale } from "@/lib/i18n";

// ─── 通用 BYOK 密钥填写弹窗 ─────────────────────────────────────────────────
// 任何需要用户自带大模型密钥的功能（户型解析、外观解析、文生设计等）都复用：
// 顶部下拉选平台 → 填该平台的 key → 存浏览器 localStorage（由调用方落地）→ 重试。
// 平台清单 + 申请链接全部来自 [[aiProviders]] 注册表，加平台只改那一处。
//
// 注意：由父组件「按需挂载」（{open && <ApiKeyPromptModal/>}），每次打开都是全新
// 实例，输入框直接惰性初始化，无需 effect 同步、规避级联渲染。切平台只在事件里
// setState（不是 effect），同样规避 set-state-in-effect lint。

interface Props {
  initialProvider: AiProviderId;
  getSavedKey: (p: AiProviderId) => string;   // 切平台时回填该平台已存的 key
  onSave: (provider: AiProviderId, key: string) => void;
  onClose: () => void;
  /** 可选：清除该平台已存的本地密钥。传了才显示「清除」按钮。 */
  onRemove?: (provider: AiProviderId) => void;
}

export default function ApiKeyPromptModal({ initialProvider, getSavedKey, onSave, onClose, onRemove }: Props) {
  const t = useT();
  const en = useLocale() === "en";
  const [provider, setProvider] = useState<AiProviderId>(initialProvider);
  const [val, setVal] = useState(() => getSavedKey(initialProvider));
  const meta = getAiProvider(provider);
  // 当前平台是否有已存密钥（清掉后会随 setVal("") 重渲染，按钮自动隐藏）
  const hasSavedKey = getSavedKey(provider).trim().length > 0;

  const remove = () => {
    onRemove?.(provider);
    setVal("");   // 同步清空输入框，让用户看到已移除
  };

  const switchProvider = (id: AiProviderId) => {
    setProvider(id);
    setVal(getSavedKey(id));   // 事件里 setState，非 effect
  };

  const save = () => {
    if (!val.trim()) return;
    onSave(provider, val.trim());
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: "var(--ds-surface, #fff)", boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--ds-border, #e5e7eb)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--ds-text, #111)" }}>{t.apiKeyPrompt.title}</div>
          <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            {t.apiKeyPrompt.intro}
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--ds-text-3, #9ca3af)" }}>{t.apiKeyPrompt.selectPlatform}</span>
            <select
              value={provider}
              onChange={(e) => switchProvider(e.target.value as AiProviderId)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ border: "1px solid var(--ds-border, #d1d5db)", background: "var(--ds-surface-2, #f9fafb)", color: "var(--ds-text, #111)" }}
            >
              {AI_PROVIDER_LIST.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>

          <input
            type="password"
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
            placeholder={t.apiKeyPrompt.inputPlaceholder(meta.label.split("（")[0])}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ border: "1px solid var(--ds-border, #d1d5db)", background: "var(--ds-surface-2, #f9fafb)", color: "var(--ds-text, #111)" }}
          />
          <div className="text-[11px] leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            {meta.keyHint}
            {" "}
            <a href={meta.helpUrl} target="_blank" rel="noopener" className="font-semibold text-indigo-600 underline">{t.apiKeyPrompt.apply}</a>
          </div>
          <div className="text-[10px] leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            {t.apiKeyPrompt.privacyNote}
          </div>
        </div>

        <div className="px-5 py-3 flex items-center justify-between gap-2" style={{ borderTop: "1px solid var(--ds-border, #e5e7eb)" }}>
          <div>
            {onRemove && hasSavedKey && (
              <button onClick={remove}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fca5a5" }}>
                {en ? "Remove saved key" : "清除已存密钥"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ color: "var(--ds-text-2, #6b7280)", background: "var(--ds-surface-2, #f3f4f6)" }}>
              {t.apiKeyPrompt.cancel}
            </button>
            <button onClick={save} disabled={!val.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #8B5CF6, #EC4899)" }}>
              {t.apiKeyPrompt.saveContinue}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
