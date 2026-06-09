"use client";

import { useState } from "react";
import {
  MODEL3D_PROVIDER_LIST,
  CREDENTIAL_META,
  getModel3dProvider,
  Model3dProviderId,
} from "@/lib/model3dProviders";
import { getModel3dKey } from "@/lib/model3dKeys";
import { useLocale } from "@/lib/i18n";

// ─── 图生 3D 的 BYOK 弹窗 ───────────────────────────────────────────────────
// 与大模型版 [[ApiKeyPromptModal]] 同款交互，但走 3D 注册表 [[model3dProviders]]：
// 顶部下拉同时是「选后端模型」+「选凭证」—— TRELLIS 1.0/2.0/Hunyuan 都用 HF token，
// 切后端时按 credential 回填同一份 key（填一次到处用）。key 存浏览器 localStorage
// （由调用方落地），随请求转发给 /api/model-3d，绝不落服务端。
//
// 由父组件「按需挂载」，每次打开都是全新实例，输入框惰性初始化、切后端只在事件里
// setState，规避 set-state-in-effect lint（与大模型版一致）。

interface Props {
  initialProvider: Model3dProviderId;
  onSave: (provider: Model3dProviderId, key: string) => void;
  onClose: () => void;
}

export default function Model3dKeyPromptModal({ initialProvider, onSave, onClose }: Props) {
  const en = useLocale() === "en";
  const [provider, setProvider] = useState<Model3dProviderId>(initialProvider);
  const meta = getModel3dProvider(provider)!;
  const cred = CREDENTIAL_META[meta.credential];
  // key 按 credential（hf/fal）存，切后端回填同一份
  const [val, setVal] = useState(() => getModel3dKey(meta.credential));

  const switchProvider = (id: Model3dProviderId) => {
    const next = getModel3dProvider(id)!;
    setProvider(id);
    setVal(getModel3dKey(next.credential)); // 事件里 setState，非 effect
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
          <div className="text-sm font-bold" style={{ color: "var(--ds-text, #111)" }}>
            {en ? "Image → 3D · bring your own key" : "图生 3D · 自带密钥"}
          </div>
          <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            {en
              ? "Keys live only in your browser and are forwarded per-request to the proxy — never stored on the server."
              : "密钥只存在你的浏览器，随请求转发给本站代理，绝不落服务端。"}
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
              {en ? "Backend model" : "选择后端模型"}
            </span>
            <select
              value={provider}
              onChange={(e) => switchProvider(e.target.value as Model3dProviderId)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ border: "1px solid var(--ds-border, #d1d5db)", background: "var(--ds-surface-2, #f9fafb)", color: "var(--ds-text, #111)" }}
            >
              {MODEL3D_PROVIDER_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {en ? p.blurb.en : p.blurb.zh}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
              {cred.label}
            </span>
            <input
              type="password"
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
              placeholder={cred.label}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ border: "1px solid var(--ds-border, #d1d5db)", background: "var(--ds-surface-2, #f9fafb)", color: "var(--ds-text, #111)" }}
            />
          </label>
          <div className="text-[11px] leading-relaxed" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
            {en ? cred.hint.en : cred.hint.zh}
            {" "}
            <a href={cred.helpUrl} target="_blank" rel="noopener" className="font-semibold text-indigo-600 underline">
              {en ? "Get one" : "去申请"}
            </a>
          </div>
        </div>

        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: "1px solid var(--ds-border, #e5e7eb)" }}>
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ color: "var(--ds-text-2, #6b7280)", background: "var(--ds-surface-2, #f3f4f6)" }}>
            {en ? "Cancel" : "取消"}
          </button>
          <button onClick={save} disabled={!val.trim()}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #8B5CF6, #EC4899)" }}>
            {en ? "Save & continue" : "保存并继续"}
          </button>
        </div>
      </div>
    </div>
  );
}
