// crypto.randomUUID 兜底（治真机崩溃），零依赖、同步执行：
// crypto.randomUUID 只在「安全上下文」（HTTPS 或 localhost）存在。通过明文
// http + 局域网 IP（如 http://192.168.x.x:3000）访问时它是 undefined，代码里
// 十几处直接调用会抛 "crypto.randomUUID is not a function" → 整页错误边界。
// 用不安全上下文也有的 getRandomValues 补一个 RFC4122 v4 实现。放最前，早于
// 任何 useEffect/事件里的调用。（线上 HTTPS 有原生实现，guard 会跳过。）
//
// 单独成文件、不 import 任何东西：ClientBoot 必须同步静态引入它（不能等
// idle 动态 import，否则首屏交互前就有调用缺失的风险），而它本身又不能
// 拉入 three/drei 之类的大依赖进首屏包。
if (typeof window !== "undefined") {
  try {
    const c = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
    if (c && typeof c.randomUUID !== "function" && typeof c.getRandomValues === "function") {
      (c as { randomUUID: () => string }).randomUUID = function randomUUID() {
        const b = c.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h: string[] = [];
        for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, "0"));
        return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
      };
    }
  } catch { /* ignore */ }
}

export {};
