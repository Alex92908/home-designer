import attribution from "@/data/attribution.json";

export const metadata = {
  title: "素材致谢 · ZHUYA",
  description: "筑雅 ZHUYA 使用的开源 3D 模型与素材来源、作者与许可。",
  alternates: { canonical: "/credits" },
};

interface Credit {
  title: string;
  author: string;
  authorUrl: string;
  source: string;
  license: string;
}

export default function CreditsPage() {
  const items = attribution as Credit[];
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <div>
          <h1 className="text-xl font-bold">素材致谢 · Credits</h1>
          <p className="text-sm text-gray-400">本产品使用的开源 3D 模型与素材来源</p>
        </div>
        <a href="/" className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "#007AFF" }}>
          返回 / Home
        </a>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-10">
        {/* CC0 — Poly Haven，无署名要求 */}
        <section>
          <h2 className="text-lg font-semibold mb-2">CC0 · 公共领域</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            部分 3D 模型与贴图来自{" "}
            <a className="underline" href="https://polyhaven.com" target="_blank" rel="noopener noreferrer">Poly Haven</a>{" "}
            与{" "}
            <a className="underline" href="https://ambientcg.com" target="_blank" rel="noopener noreferrer">ambientCG</a>，
            采用 CC0 1.0 许可，可自由使用、修改、商用，无需署名。此处一并致谢。
          </p>
        </section>

        {/* CC-BY — Sketchfab，必须署名 */}
        <section>
          <h2 className="text-lg font-semibold mb-1">CC-BY 4.0 · 署名</h2>
          <p className="text-sm text-gray-400 mb-4">
            以下 {items.length} 个 3D 模型来自{" "}
            <a className="underline" href="https://sketchfab.com" target="_blank" rel="noopener noreferrer">Sketchfab</a>，
            采用{" "}
            <a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC Attribution 4.0</a>{" "}
            许可，特此署名原作者：
          </p>
          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.source || c.title} className="text-sm border-b border-white/5 pb-2">
                <a className="font-medium underline" href={c.source} target="_blank" rel="noopener noreferrer">
                  {c.title}
                </a>
                <span className="text-gray-400"> — by </span>
                {c.authorUrl ? (
                  <a className="text-gray-300 underline" href={c.authorUrl} target="_blank" rel="noopener noreferrer">{c.author}</a>
                ) : (
                  <span className="text-gray-300">{c.author}</span>
                )}
                <span className="text-gray-500"> · CC-BY 4.0</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-xs text-gray-500 pt-4">
          其余建筑外观、家具、地毯、外墙等材质由筑雅 ZHUYA 程序化生成。
        </p>
      </main>
    </div>
  );
}
