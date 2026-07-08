import type { MetadataRoute } from "next";

// output: export（静态导出）要求元数据路由显式声明静态，否则 build 失败。
export const dynamic = "force-static";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://zhuyahome.com";

// 显式欢迎主流 AI / 搜索爬虫（默认就允许，这里列出来让意图明确、也便于审计）。
const AI_BOTS = [
  "GPTBot", "ChatGPT-User", "OAI-SearchBot",   // OpenAI
  "ClaudeBot", "anthropic-ai", "Claude-Web",   // Anthropic
  "PerplexityBot", "Perplexity-User",          // Perplexity
  "Google-Extended",                            // Google Gemini
  "Bingbot",                                    // Bing / Copilot
  "Bytespider",                                 // 字节 / 豆包
  "CCBot",                                      // Common Crawl
];

export default function robots(): MetadataRoute.Robots {
  return {
    // 允许收录全站，屏蔽后端 API 路由（无内容、不该被索引）。
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/"] },
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow: ["/api/"] })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
