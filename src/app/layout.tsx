import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import ClientBoot from "./ClientBoot";

// next/font/google (Geist) conflicts with Turbopack in Next.js 16 —
// resolves @vercel/turbopack-next/internal/font/google/font which doesn't
// exist in the build cache. Use system font stack instead: visually
// identical on macOS/iOS (SF Pro) and near-identical on Windows (Segoe UI).
// No network request, no build error, faster TTFB.

// 站点根 URL（用于 sitemap / robots / OG 绝对地址）。部署后可在 Vercel 环境
// 变量 NEXT_PUBLIC_SITE_URL 覆盖；默认线上域名（www——裸域名 308 跳转到 www，
// canonical 与 OG 必须直接指 www，否则 canonical 指向一个会跳转的地址）。
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "ZHUYA 筑雅 | 免费 AI 家装设计 — AI 文生户型 + 3D 装修",
  description:
    "筑雅 ZHUYA 是免费的在线 AI 家装设计工具：输入一句话或一张户型照片，AI 生成户型；在浏览器里 3D 装修、沉浸式漫游房间、设计建筑外观立面与庭院景观，装修实时报价，一键分享整套方案。无需下载，完全免费。",
  keywords: ["筑雅", "ZHUYA", "AI 装修", "3D 户型", "室内设计", "装修设计", "家装", "户型设计", "AI 文生户型", "3D 装修", "免费家装设计", "home design", "interior design", "AI interior design"],
  applicationName: "ZHUYA",
  alternates: {
    canonical: "/",
    // 注意：本站语言（中/英文界面）目前存在 localStorage / zustand（hd-locale）
    // 而非 URL 中，因此中英文没有各自独立的可索引 URL。这里的 hreflang 是
    // 最小标注：同一首页同时服务中英文，x-default 指向中文首页。
    // 若后续做 URL 级 i18n 路由（如 /en/），需把这里改成对应语言的独立 URL。
    languages: {
      "zh-CN": SITE_URL,
      en: SITE_URL,
      "x-default": SITE_URL,
    },
  },
  openGraph: {
    type: "website",
    siteName: "ZHUYA",
    title: "ZHUYA 筑雅 | 免费 AI 家装设计 — AI 文生户型 + 3D 装修",
    description:
      "免费在线 AI 家装设计：AI 文生户型、沉浸式 3D 装修与漫游、外观立面与庭院设计、实时装修报价、一键分享。",
    url: SITE_URL,
    locale: "zh_CN",
    alternateLocale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "ZHUYA 筑雅 | 免费 AI 家装设计 — AI 文生户型 + 3D 装修",
    description:
      "免费在线 AI 家装设计：AI 文生户型、沉浸式 3D 装修与漫游、外观立面与庭院设计、实时装修报价、一键分享。",
  },
  // 站长验证码（无需改代码，按需在 Vercel 环境变量里填，未设则不渲染该标签）：
  //   · Google Search Console → GOOGLE_SITE_VERIFICATION
  //   · Bing Webmaster Tools  → BING_SITE_VERIFICATION（msvalidate.01）
  //   · 百度站长平台          → BAIDU_SITE_VERIFICATION（baidu-site-verification）
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    other: {
      ...(process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : {}),
      ...(process.env.BAIDU_SITE_VERIFICATION ? { "baidu-site-verification": process.env.BAIDU_SITE_VERIFICATION } : {}),
    },
  },
};

// schema.org 结构化数据：让 Google / AI 搜索准确理解「这是一个免费的在线
// AI 家装设计 Web 应用」，提升收录与富结果展示。纯 SEO，对用户不可见。
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ZHUYA",
  alternateName: "ZHUYA 家装设计",
  applicationCategory: "DesignApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  inLanguage: "zh-CN",
  description:
    "ZHUYA 是免费的在线 AI 家装设计工具：AI 文生户型、沉浸式 3D 装修与漫游、外观立面与庭院设计、实时装修报价、一键分享方案。",
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
        <ClientBoot />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
