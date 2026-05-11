"use client";

import { useEffect, useState, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import type { FloorPlan } from "@/lib/types";
import { encodeShare } from "@/lib/share";
import { useT, useLocale } from "@/lib/i18n";

export default function ShareModal() {
  const [open, setOpen]         = useState(false);
  const [copied, setCopied]     = useState(false);
  const [email, setEmail]       = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const t = useT();
  const locale = useLocale();

  const floorPlans     = useDesignerStore(s => s.floorPlans);
  const rooms          = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms);
  const enabledRooms   = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const budget         = useDesignerStore(s => s.budget);
  const exterior       = useDesignerStore(s => s.exterior);
  const customRoomMeta = useDesignerStore(s => s.customRoomMeta);

  const buildShareUrl = useCallback(() => {
    // Encode all floorPlans (stripping empty rooms to keep URL small)
    const compactFloorPlans = floorPlans.map(fp => ({
      ...fp,
      rooms: Object.fromEntries(
        fp.enabledRooms
          .filter(r => fp.rooms[r] && (Object.keys(fp.rooms[r].materials).length > 0 || fp.rooms[r].placedItems.length > 0))
          .map(r => [r, fp.rooms[r]])
      ) as FloorPlan["rooms"],
    }));

    const snapshot = {
      floorPlans: compactFloorPlans,
      budget,
      exterior: exterior as unknown as Record<string, unknown>,
      customRoomMeta,
      v: 2,
    };

    const encoded = encodeShare(snapshot);
    return `${window.location.origin}?share=${encoded}`;
  }, [floorPlans, budget, exterior, customRoomMeta]);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setCopied(false);
      setSubmitted(false);
      setEmail("");
    };
    window.addEventListener("openShare", handler);
    return () => window.removeEventListener("openShare", handler);
  }, []);

  useEffect(() => {
    if (open) setShareUrl(buildShareUrl());
  }, [open, buildShareUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback for older browsers
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleSubscribe = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "";
      await fetch(`${apiBase}/api/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "share-modal" }),
      });
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 text-white" style={{ background: "linear-gradient(160deg, #007AFF 0%, #5856D6 100%)" }}>
          <div className="text-xl font-black mb-0.5">{t.shareTitle}</div>
          <div className="text-sm text-indigo-100">{t.shareSubtitle}</div>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Share link */}
          <div>
            <div className="text-xs font-bold text-gray-500 mb-2">{t.shareLinkLabel}</div>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-500 bg-gray-50 outline-none truncate"
              />
              <button
                onClick={handleCopy}
                className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap text-white"
                style={{ background: copied ? "#34C759" : "var(--ds-primary)" }}
              >
                {copied ? t.shareCopied : t.shareCopyBtn}
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-gray-400">{t.shareUrlNote}</div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100" />

          {/* Email capture */}
          {!submitted ? (
            <div className="rounded-xl p-4" style={{ background: "#E8F1FF", border: "1px solid #CCE4FF" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: "var(--ds-text)" }}>{t.shareEmailTitle}</div>
              <div className="text-xs mb-3" style={{ color: "var(--ds-text-2)" }}>{t.shareEmailDesc}</div>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t.shareEmailPlaceholder}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none bg-white"
                  style={{ border: "1px solid var(--ds-border)" }}
                  onKeyDown={e => e.key === "Enter" && handleSubscribe()}
                />
                <button
                  onClick={handleSubscribe}
                  disabled={!email || loading}
                  className="ds-btn-primary px-4 py-2.5 disabled:opacity-40 whitespace-nowrap"
                >
                  {loading ? "..." : t.shareEmailBtn}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <div className="text-2xl mb-1">🎉</div>
              <div className="text-sm font-bold text-green-700">{t.shareEmailSuccess}</div>
              <div className="text-xs text-green-600 mt-0.5">{t.shareEmailSuccessDesc}</div>
            </div>
          )}

          {/* Designer CTA */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
            <div className="flex items-start gap-3">
              <div className="text-2xl shrink-0">🏡</div>
              <div>
                <div className="text-sm font-bold text-gray-800 mb-0.5">{t.shareDesignerTitle}</div>
                <div className="text-xs text-gray-500 mb-2">{t.shareDesignerDesc}</div>
                <a
                  href={`mailto:${process.env.NEXT_PUBLIC_DESIGNER_EMAIL ?? "hello@homedesigner.app"}?subject=${encodeURIComponent(locale === "en" ? "Designer Consultation Request" : "设计师咨询")}&body=${encodeURIComponent(locale === "en" ? `Hi, I'd like a consultation. My plan: ${shareUrl}` : `你好，我想咨询装修方案。我的方案链接：${shareUrl}`)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  {t.shareDesignerBtn}
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 pb-4 flex justify-end border-t border-gray-100 pt-3">
          <button onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:text-gray-600">
            {t.closeBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
