import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// next/font/google (Geist) conflicts with Turbopack in Next.js 16 —
// resolves @vercel/turbopack-next/internal/font/google/font which doesn't
// exist in the build cache. Use system font stack instead: visually
// identical on macOS/iOS (SF Pro) and near-identical on Windows (Segoe UI).
// No network request, no build error, faster TTFB.

export const metadata: Metadata = {
  title: "装修配置器 — 像攒电脑一样装修",
  description: "沉浸式3D装修方案生成器，实时报价，一键分享",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
