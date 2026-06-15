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

// schema.org 结构化数据：让 Google / AI 搜索准确理解「这是一个免费的在线
// AI 家装设计 Web 应用」，提升收录与富结果展示。纯 SEO，对用户不可见。
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "筑雅 ZHUYA",
  alternateName: "ZHUYA 家装设计",
  applicationCategory: "DesignApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  inLanguage: "zh-CN",
  description:
    "筑雅 ZHUYA 是免费的在线 AI 家装设计工具：AI 文生户型、沉浸式 3D 装修与漫游、外观立面与庭院设计、实时装修报价、一键分享方案。",
  offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  featureList: [
    "AI 文生户型",
    "3D 实时装修与漫游",
    "建筑外观与立面设计",
    "庭院 / 院子景观设计",
    "实时装修报价",
    "方案一键分享",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
