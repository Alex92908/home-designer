"use client";

/**
 * 路由级错误边界（App Router）。任何渲染期未被局部 ErrorBoundary 捕获的
 * 异常都落到这里，避免整页白屏。提供两条逃生路径：
 *   - 重试：reset() 重新渲染（瞬时错误，如 GLB 偶发加载失败）
 *   - 清除本地数据并刷新：删持久化的设计快照后重载（应对 localStorage
 *     里旧版/损坏的数据结构导致的稳定崩溃——这是最常见的"重试也没用"场景）
 *
 * 文案按浏览器语言中英切换（此处拿不到 app 的 i18n context）。
 */
import { useEffect } from "react";

const PERSIST_KEY = "home-designer-v2";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const zh = typeof navigator !== "undefined" ? navigator.language.startsWith("zh") : true;
  useEffect(() => {
    // 留个痕迹（生产构建会剥离 console.log，但 error 保留——见 next.config）
    console.error("[app/error]", error);
  }, [error]);

  const clearAndReload = () => {
    try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
    location.reload();
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 16,
      background: "#0f1115", color: "#E8E8EC", padding: 24, textAlign: "center",
      fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    }}>
      <div style={{ fontSize: 40 }}>🏗️</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>
        {zh ? "出了点问题" : "Something went wrong"}
      </div>
      <div style={{ fontSize: 13, color: "rgba(232,232,236,0.55)", maxWidth: 360, lineHeight: 1.6 }}>
        {zh
          ? "页面遇到一个错误。可以先重试；如果反复出错，多半是本地保存的设计数据格式过旧或损坏，点「清除并刷新」即可恢复（会清空本机未导出的设计）。"
          : "The page hit an error. Try again first; if it keeps failing, your locally saved design data is likely outdated or corrupted — “Clear & reload” restores it (clears un-exported local designs)."}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button onClick={reset} style={{
          padding: "8px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)",
          background: "transparent", color: "#E8E8EC", fontWeight: 600, cursor: "pointer", fontSize: 13,
        }}>
          {zh ? "重试" : "Try again"}
        </button>
        <button onClick={clearAndReload} style={{
          padding: "8px 18px", borderRadius: 12, border: "none",
          background: "linear-gradient(135deg,#0d9488,#2dd4bf)", color: "#fff",
          fontWeight: 700, cursor: "pointer", fontSize: 13,
        }}>
          {zh ? "清除并刷新" : "Clear & reload"}
        </button>
      </div>
      {error?.digest && (
        <div style={{ fontSize: 10, color: "rgba(232,232,236,0.3)", marginTop: 8 }}>ref: {error.digest}</div>
      )}
    </div>
  );
}
