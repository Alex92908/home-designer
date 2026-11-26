"use client";
// 客户端全局初始化：
//  · crypto.randomUUID 兜底 —— 必须同步、尽早（十几处直接调用；不安全
//    上下文 http+局域网 IP 时原生缺失），故静态 import，零依赖、1KB。
//  · GLB 预载（热门模型 / 移动端解码器预热）—— 体积大（拉入 three/drei），
//    idle 后动态 import，不阻塞首屏 JS 解析与水合。Draco 解码路径改由
//    @/lib/drei 模块级设置，各画布 chunk 求值时即生效，不依赖本模块时序。
// 放在根 layout 渲染，保证「所有路由」都执行（之前只在 "/" 的 page.tsx
// 导入，导致 /showcase 等路由缺 crypto 兜底 → http 局域网访问时崩）。
import "@/lib/cryptoPolyfill";
import { useEffect } from "react";

export default function ClientBoot(): null {
  useEffect(() => {
    let cancelled = false;
    const load = () => { if (!cancelled) void import("@/lib/preload"); };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === "function") {
      const id = ric(load, { timeout: 4000 });
      return () => {
        cancelled = true;
        if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(id);
      };
    }
    const t = setTimeout(load, 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);
  return null;
}
