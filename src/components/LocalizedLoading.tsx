"use client";

/**
 * LocalizedLoading — 页面级 Suspense fallback 的双语加载占位。
 *
 * showcase / view 这些独立页是 server component，其 Suspense fallback 之前写死了
 * 「加载中…」中文；本组件按 locale 显示。zustand persist 会同步从 localStorage
 * 恢复 locale，故客户端首帧即为用户所选语言（SSR 侧无 localStorage 取默认，
 * 用 suppressHydrationWarning 抹掉首帧文案差异，加载占位一闪而过无碍）。
 */
import { useLocale } from "@/lib/i18n";

export default function LocalizedLoading() {
  const locale = useLocale();
  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="text-gray-400 text-sm" suppressHydrationWarning>
        {locale === "en" ? "Loading…" : "加载中…"}
      </div>
    </div>
  );
}
