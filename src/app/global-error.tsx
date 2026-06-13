"use client";

/**
 * 根级错误兜底。当错误发生在根 layout 本身（error.tsx 替换不了它的位置）时
 * 接管整页，因此必须自带 <html>/<body>。极少触发，但缺了它根 layout 崩溃
 * 仍是白屏。文案保持最小、零依赖（不引 i18n / 组件，避免二次崩溃）。
 */
const PERSIST_KEY = "home-designer-v2";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const zh = typeof navigator !== "undefined" ? navigator.language.startsWith("zh") : true;
  const clearAndReload = () => {
    try { localStorage.removeItem(PERSIST_KEY); } catch { /* ignore */ }
    location.reload();
  };
  return (
    <html lang={zh ? "zh" : "en"}>
      <body style={{ margin: 0 }}>
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
          background: "#0f1115", color: "#E8E8EC", padding: 24, textAlign: "center",
          fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
        }}>
          <div style={{ fontSize: 40 }}>🏗️</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {zh ? "应用无法加载" : "The app failed to load"}
          </div>
          <div style={{ fontSize: 13, color: "rgba(232,232,236,0.55)", maxWidth: 360, lineHeight: 1.6 }}>
            {zh
              ? "遇到了严重错误。请重试，或清除本地数据后刷新（会清空本机未导出的设计）。"
              : "A fatal error occurred. Try again, or clear local data and reload (clears un-exported local designs)."}
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
      </body>
    </html>
  );
}
