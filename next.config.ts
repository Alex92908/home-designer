import type { NextConfig } from "next";

// Set NEXT_EXPORT=1 to generate a fully static site (for self-hosting / China CDN)
const isStaticExport = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  // React 19 StrictMode double-mounts components, which @react-three/fiber
  // 9.5 doesn't handle cleanly — unmount disposes the WebGL context and
  // remount races on reading gl.getContextAttributes().alpha → runtime
  // error. Disabling until r3f fixes the lifecycle. (Affects dev only;
  // production builds don't use StrictMode.)
  reactStrictMode: false,
  // Next.js 16 默认阻止跨源访问 dev 资源（HMR、chunks…）。从网络 IP
  // 或 LAN 内手机访问 dev 服务器时 webpack-hmr websocket 会被拒，
  // React 水合停住、交互不响应。放开本机常见 LAN 段 + 具体 IP 兜底。
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.0.0/16",
    "10.0.0.0/8",
    "192.168.56.143",
  ],
  ...(isStaticExport && {
    output: "export",
    distDir: "out",
    images: { unoptimized: true },
  }),
};

export default nextConfig;
