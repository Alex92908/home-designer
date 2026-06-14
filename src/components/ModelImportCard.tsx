"use client";

/**
 * ModelImportCard — 统一的 3D 模型导入卡（所有入口共用，能力完备）：
 *   - 选择文件上传（.glb/.gltf）
 *   - 本机文件路径直接放入（服务端读取，散件 .gltf 自动打包 .glb）
 *   - 压缩用户可选（默认开：Draco + 1k WebP；要保留原始精度可关）
 *
 * 落 public/models/imported/ 真实文件（只读部署自动退 IndexedDB）。
 * 去向由调用方的 onImported(url, name) 决定：家具 tab 放进当前房间、
 * 院子图放进院子、导入导出弹窗放院子并跳转。
 */
import { useRef, useState } from "react";
import { persistGlb } from "@/lib/glbStorage";
import { makeGlbThumbnail } from "@/lib/glbThumbnail";
import { useLocale } from "@/lib/i18n";

export default function ModelImportCard({ onImported }: {
  /** name 已按当前语言选好（en 给英文名、zh 给中文名）。
   *  batch=true 表示这是「批量导入」中的一件 —— 调用方据此只入库、不自动摆放/关卡。 */
  onImported: (url: string, name: string, batch?: boolean) => void;
}) {
  const en = useLocale() === "en";
  const fileRef = useRef<HTMLInputElement>(null);
  const [compress, setCompress] = useState(true);
  const [localPath, setLocalPath] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [batchProg, setBatchProg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 导入完成后的收尾：写中英文名 + 自动烤预览图（PATCH 元数据），
   *  再把按当前语言选好的显示名回调给调用方。预览图失败不阻断。 */
  const finalize = async (url: string, fallbackName: string) => {
    const zh = nameZh.trim() || fallbackName;
    const enName = nameEn.trim() || fallbackName;
    const file = url.split("/").pop() ?? "";
    if (url.startsWith("/models/imported/") && file) {
      const preview = await makeGlbThumbnail(url).catch(() => null);
      void fetch("/api/import-model", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file, nameZh: zh, nameEn: enName, ...(preview ? { preview } : {}) }),
      }).catch(() => {});
    }
    setNameZh(""); setNameEn("");
    onImported(url, en ? enName : zh);
  };

  /** 批量入库（不走名字输入框，按文件名命名，导入后到模型库里手动重命名）。 */
  const importOneToLibrary = async (file: File) => {
    const fallback = file.name.replace(/\.(glb|gltf)$/i, "") || `model_${crypto.randomUUID().slice(0, 8)}`;
    const src = await persistGlb(fallback, file, { compress });
    const fname = src.split("/").pop() ?? "";
    if (src.startsWith("/models/imported/") && fname) {
      const preview = await makeGlbThumbnail(src).catch(() => null);
      void fetch("/api/import-model", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: fname, nameZh: fallback, nameEn: fallback, ...(preview ? { preview } : {}) }),
      }).catch(() => {});
    }
    onImported(src, fallback, true);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    // 单文件：沿用名字输入框 + 自动摆放（onImported 不带 batch）
    if (files.length === 1) {
      const file = files[0];
      const fallback = file.name.replace(/\.(glb|gltf)$/i, "");
      setBusy(true); setError(null);
      void persistGlb(nameZh.trim() || fallback || `model_${crypto.randomUUID().slice(0, 8)}`, file, { compress })
        .then(async src => { await finalize(src, fallback); setBusy(false); })
        .catch((err: unknown) => { setBusy(false); setError(err instanceof Error ? err.message : String(err)); });
      return;
    }
    // 多文件：批量入库（按文件名），导入后到模型库逐个手动重命名
    setBusy(true); setError(null); setBatchProg(`0/${files.length}`);
    void (async () => {
      let done = 0, failed = 0;
      for (const file of files) {
        try { await importOneToLibrary(file); }
        catch (err) { failed++; setError(err instanceof Error ? err.message : String(err)); }
        setBatchProg(`${++done}/${files.length}`);
      }
      setBusy(false); setBatchProg(null);
      if (failed === 0) setError(null);
    })();
  };

  const handleLocalPath = () => {
    const p = localPath.trim();
    if (!p) return;
    setBusy(true); setError(null);
    void fetch("/api/import-model", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ localPath: p, compress }),
    }).then(async r => {
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || `HTTP ${r.status}`);
      const fallback = p.split("/").pop()?.replace(/\.(glb|gltf)$/i, "") ?? "";
      setLocalPath("");
      await finalize(data.url, fallback);
      setBusy(false);
    }).catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="rounded-xl p-2.5 flex flex-col gap-2"
      style={{ background: "linear-gradient(135deg,#EEF2FF,#F0FDF4)", border: "1px solid #C7D2FE" }}>
      <input ref={fileRef} type="file" multiple className="hidden"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={handleFile} />
      {/* 中英文名（可选，缺省用文件名）；预览图导入后自动生成 */}
      <div className="flex gap-1">
        <input value={nameZh} onChange={(e) => setNameZh(e.target.value)} disabled={busy}
          placeholder={en ? "Chinese name (optional)" : "中文名（可选）"}
          className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 bg-white outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60" />
        <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} disabled={busy}
          placeholder={en ? "English name (optional)" : "English name（可选）"}
          className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 bg-white outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60" />
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-gray-600 cursor-pointer select-none leading-snug">
        <input type="checkbox" checked={compress} disabled={busy}
          onChange={(e) => setCompress(e.target.checked)} className="accent-indigo-500 shrink-0" />
        {en
          ? "Compress on import (Draco + 1k textures, recommended)"
          : "导入时压缩（Draco + 1k 贴图，推荐；要保留原始精度就取消勾选）"}
      </label>
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        className="w-full py-2 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-60"
        style={{ background: "#6366F1" }}>
        {busy
          ? (batchProg
              ? (en ? `Importing ${batchProg}…` : `批量导入 ${batchProg}…`)
              : (en ? "Importing…" : compress ? "导入中（压缩中）…" : "导入中…"))
          : (en ? "Choose model file(s) (.glb/.gltf)" : "选择模型文件（.glb / .gltf，可多选）")}
      </button>
      <div className="flex gap-1">
        <input
          value={localPath}
          onChange={(e) => { setLocalPath(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleLocalPath(); }}
          disabled={busy}
          placeholder={en ? "…or paste a local path (/Users/…/model.glb)" : "或粘贴本机路径（/Users/…/model.glb）"}
          className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 bg-white outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
        />
        <button onClick={handleLocalPath} disabled={busy || !localPath.trim()}
          className="shrink-0 px-2.5 py-1.5 text-[11px] font-bold rounded-lg text-white disabled:opacity-50"
          style={{ background: "#4F46E5" }}>
          {en ? "Add" : "放入"}
        </button>
      </div>
      {error && <div className="text-[10px] text-red-600">⚠️ {error}</div>}
    </div>
  );
}
