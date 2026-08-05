"use client";
// 客户端全局初始化:crypto.randomUUID 兜底(不安全上下文)+ Draco 解码路径 + 热门
// GLB 预载。放在根 layout 渲染,保证「所有路由」都执行(之前只在 "/" 的 page.tsx
// 导入,导致 /showcase 等路由缺 crypto 兜底 → http 局域网访问时崩)。
import "@/lib/preload";

export default function ClientBoot(): null {
  return null;
}
