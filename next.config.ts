import type { NextConfig } from "next";

// Set NEXT_EXPORT=1 to generate a fully static site (for self-hosting / China CDN)
const isStaticExport = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  // 生产构建剥离 console.log/info/debug（保留 error/warn）——诊断日志
  // （[pbr]/[PERF]/[DEBUG] 等）不该泄漏到用户控制台，也省一点体积。
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },
  // Turbopack (Next.js 16 default bundler) has a bug resolving
  // @vercel/turbopack-next/internal/font/google/font when next/font/google
  // is used. Disable Turbopack so webpack handles the build instead.
  // Remove once the upstream bug is fixed.
  // React 19 StrictMode double-mounts components, which @react-three/fiber
  // 9.5 doesn't handle cleanly — unmount disposes the WebGL context and
  // remount races on reading gl.getContextAttributes().alpha → runtime
  // error. Disabling until r3f fixes the lifecycle. (Affects dev only;
  // production builds don't use StrictMode.)
  reactStrictMode: false,
  // 别把 public/ 里的大体积静态资源打进 serverless 函数包。
  // api/import-model 用 path.join(process.cwd(),"public","models",…) 引用了
  // 该目录，Next 的输出文件追踪(nft)保守地把整个 public/models/**（300MB+ 的
  // GLB）塞进函数 → Vercel「函数 334MB 超 250MB 上限」构建失败。这些 GLB/
  // Draco 都是 CDN 直接服务的静态文件，没有任何函数需要它们进包，全局排除。
  // （import-model 本就是本地/自托管功能：serverless 只读盘写文件必 500。）
  outputFileTracingExcludes: {
    "**": ["public/models/**", "public/draco/**"],
  },
  // dev 路由指示器（那个圆形「N」徽标）默认钉在右下角，正好压住右下角的
  // 「AI 渲染」悬浮按钮。挪到左下角让开（仅 dev 生效，生产构建本就没有它）。
  devIndicators: { position: "bottom-left" },
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
  // 3D 素材走强缓存（生产环境）：GLB/GLTF/BIN/textures 都是 hash-naming
  // 友好的静态内容，给 immutable 1 年缓存能显著缩短二次访问 + 跨页切
  // 换时的加载时间（首次仍然要下）。次要收益：减少 CDN 回源。
  async headers() {
    return [
      {
        source: "/models/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/draco/:path*",   // Draco decoder wasm/js
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  ...(isStaticExport && {
    output: "export",
    distDir: "out",
    images: { unoptimized: true },
  }),
};

export default nextConfig;
