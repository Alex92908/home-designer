import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// next/font/google (Geist) conflicts with Turbopack in Next.js 16 —
// resolves @vercel/turbopack-next/internal/font/google/font which doesn't
// exist in the build cache. Use system font stack instead: visually
// identical on macOS/iOS (SF Pro) and near-identical on Windows (Segoe UI).
// No network request, no build error, faster TTFB.

// 站点根 URL（用于 sitemap / robots / OG 绝对地址）。部署后可在 Vercel 环境
// 变量 NEXT_PUBLIC_SITE_URL 覆盖；默认线上域名。
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://zhuyahome.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "筑雅 ZHUYA · 惟吾德馨，筑雅而居",
  description: "筑雅 ZHUYA —— AI 文生户型 + 沉浸式 3D 装修，实时报价，一键分享",
  keywords: ["筑雅", "ZHUYA", "AI 装修", "3D 户型", "室内设计", "装修设计", "家装", "户型设计", "home design", "interior design"],
  applicationName: "筑雅 ZHUYA",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "筑雅 ZHUYA",
    title: "筑雅 ZHUYA · 惟吾德馨，筑雅而居",
    description: "AI 文生户型 + 沉浸式 3D 装修，实时报价，一键分享",
    url: SITE_URL,
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "筑雅 ZHUYA · 惟吾德馨，筑雅而居",
    description: "AI 文生户型 + 沉浸式 3D 装修，实时报价，一键分享",
  },
  // Google Search Console 验证码：在 Vercel 环境变量 GOOGLE_SITE_VERIFICATION
  // 里填 Search Console 给的字符串即可（无需改代码）。未设则不渲染该标签。
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
