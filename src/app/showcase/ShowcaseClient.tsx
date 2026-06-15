"use client";

/**
 * ShowcaseClient — 样板间画廊 + 外形图查看器。
 *
 * 画廊：列出 SHOWCASE_TEMPLATES（现在 1 套，结构留口给以后用户投稿）。
 * 点卡片 → 把该方案临时灌进 store，全屏渲染 <HouseCanvas/> 外观图。
 *
 * 关键：查看样板会改动全局 store。为不破坏用户自己的设计，进入查看前备份
 * store 相关字段 + localStorage，返回/卸载/关页时还原。
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDesignerStore } from "@/lib/store";
import { useLocale } from "@/lib/i18n";
import { SHOWCASE_TEMPLATES, type ShowcaseTemplate } from "@/lib/showcaseTemplates";

const PERSIST_KEY = "home-designer-v2";

const HouseCanvas = dynamic(() => import("@/components/HouseCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
      渲染外形图…
    </div>
  ),
});

export default function ShowcaseClient() {
  const locale = useLocale();
  const en = locale === "en";
  const [activeId, setActiveId] = useState<string | null>(null);

  // 备份用户当前 store（首次进入查看时拍一次）。
  const backup = useRef<{
    floorPlans: unknown;
    exterior: unknown;
    viewMode: unknown;
    activeFloor: number;
    ls: string | null;
  } | null>(null);

  const ensureBackup = () => {
    if (backup.current) return;
    const s = useDesignerStore.getState();
    backup.current = {
      floorPlans: s.floorPlans,
      exterior: s.exterior,
      viewMode: s.viewMode,
      activeFloor: s.activeFloor,
      ls: typeof window !== "undefined" ? window.localStorage.getItem(PERSIST_KEY) : null,
    };
  };

  const restore = () => {
    const b = backup.current;
    if (!b) return;
    useDesignerStore.setState({
      floorPlans: b.floorPlans as never,
      exterior: b.exterior as never,
      viewMode: b.viewMode as never,
      activeFloor: b.activeFloor,
    });
    try {
      if (b.ls != null) window.localStorage.setItem(PERSIST_KEY, b.ls);
    } catch {
      /* ignore */
    }
    backup.current = null;
  };

  // 卸载（路由切走）时还原；关页（beforeunload）时至少把 localStorage 写回，
  // 避免用户设计被样板覆盖丢失。
  useEffect(() => {
    const onUnload = () => {
      const b = backup.current;
      if (b?.ls != null) {
        try {
          window.localStorage.setItem(PERSIST_KEY, b.ls);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      restore();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTemplate = (t: ShowcaseTemplate) => {
    ensureBackup();
    const { floorPlans, exterior } = t.load();
    useDesignerStore.setState((s) => ({
      floorPlans,
      exterior: { ...s.exterior, ...exterior },
      viewMode: "exterior" as never,
      activeFloor: 0,
    }));
    setActiveId(t.id);
  };

  const backToGallery = () => {
    restore();
    setActiveId(null);
  };

  // ── 外形图查看器 ──
  if (activeId) {
    const t = SHOWCASE_TEMPLATES.find((x) => x.id === activeId);
    return (
      <div className="relative h-screen w-screen bg-gray-900 overflow-hidden">
        <HouseCanvas />
        <button
          onClick={backToGallery}
          className="absolute top-4 left-4 z-50 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-lg"
          style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          ← {en ? "Back to gallery" : "返回样板间"}
        </button>
        {t && (
          <div
            className="absolute top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm text-white shadow-lg"
            style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
          >
            <div className="font-semibold">{en ? t.nameEn : t.nameZh}</div>
            <div className="text-xs text-gray-300">{en ? t.descEn : t.descZh}</div>
          </div>
        )}
      </div>
    );
  }

  // ── 画廊 ──
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <div>
          <h1 className="text-xl font-bold">{en ? "Showroom" : "样板间"}</h1>
          <p className="text-sm text-gray-400">
            {en ? "Browse the 3D exterior of curated home designs" : "浏览精选住宅设计的 3D 外观"}
          </p>
        </div>
        <a
          href="/"
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "#007AFF" }}
        >
          {en ? "Open designer" : "进入设计器"}
        </a>
      </header>

      <main className="p-6 grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {SHOWCASE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => openTemplate(t)}
            className="text-left rounded-2xl overflow-hidden border border-white/10 bg-gray-800/60 hover:bg-gray-800 transition shadow-lg"
          >
            {/* 缩略占位（外形图缩略图后续可换成预渲染图） */}
            <div
              className="h-40 flex items-center justify-center text-5xl"
              style={{ background: "linear-gradient(135deg,#2b3242,#1b2230)" }}
            >
              🏝️
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold">{en ? t.nameEn : t.nameZh}</span>
                {t.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300">
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-sm text-gray-400 mb-3">{en ? t.descEn : t.descZh}</p>
              <span className="text-sm font-semibold" style={{ color: "#5AA9FF" }}>
                {en ? "View exterior →" : "查看外形 →"}
              </span>
            </div>
          </button>
        ))}
      </main>
    </div>
  );
}
