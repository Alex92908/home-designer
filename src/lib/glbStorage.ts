"use client";

/**
 * glbStorage — 导入 GLB 的二进制仓库（IndexedDB）。
 *
 * 为什么不能放 zustand persist（localStorage）：一个 GLB 动辄几 MB，
 * base64 后再乘 1.33，localStorage 整站配额才 ~5MB —— 导入即抛
 * QuotaExceededError（用户实测炸在 addYardItem → persist 写入）。
 *
 * 约定：store 里 glbSrc 只存轻量引用 "idb://<key>"；渲染层通过
 * resolveGlbSrc() 换成 object URL 再交给 useGLTF。旧数据里已有的
 * data:/path 形式 src 原样透传，完全向后兼容。
 */

const DB_NAME = "home-designer-glb";
const STORE = "glbs";
const PREFIX = "idb://";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 存一个 GLB blob，返回可写进 store 的轻量引用 "idb://<key>"。 */
export async function saveGlbBlob(key: string, blob: Blob): Promise<string> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return PREFIX + key;
}

export function isIdbGlbSrc(src: string): boolean {
  return src.startsWith(PREFIX);
}

// object URL 按 key 缓存：同一模型多个实例 / 反复重渲染共用一个 URL，
// 不重复读库也不泄漏 URL。
const urlCache = new Map<string, string>();

/** 把 glbSrc 解析成 useGLTF 能加载的 URL。
 *  - "idb://key" → 读 IndexedDB → object URL（缓存）；丢失返回 null。
 *  - 其它（/path、data:、http(s)）原样返回。 */
export async function resolveGlbSrc(src: string): Promise<string | null> {
  if (!isIdbGlbSrc(src)) return src;
  const key = src.slice(PREFIX.length);
  const cached = urlCache.get(key);
  if (cached) return cached;
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

/** 持久化一个导入/生成的 GLB，返回可写进 store 的 glbSrc。
 *  首选：POST /api/import-model 落成 public/models/imported/ 真实文件
 *  （与内置家具同一套「URL 即资产」机制——换浏览器/清缓存不丢、可提交分享）；
 *  失败（只读部署等）→ 退回 IndexedDB（"idb://key"）。 */
export async function persistGlb(key: string, blob: Blob): Promise<string> {
  try {
    const fd = new FormData();
    fd.append("file", blob, `${key}.glb`);
    const r = await fetch("/api/import-model", { method: "POST", body: fd });
    if (r.ok) {
      const { url } = await r.json();
      if (typeof url === "string" && url) return url;
    }
  } catch { /* fall through to IndexedDB */ }
  return saveGlbBlob(key, blob);
}

/** data URL → Blob（AI 生成的 GLB 返回 base64 时用，转完一样入库）。 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!m) return null;
  const mime = m[1] || "model/gltf-binary";
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
