"use client";

/**
 * catalogThumbnails — 给目录里每件「有 GLB 的家具」离屏烤一张预览缩略图，
 * 替掉侧边栏卡片上的 emoji 占位图。
 *
 * 复用 makeGlbThumbnail（自建离屏 renderer + draco 解码 + 取景 + toDataURL）。
 * 关键是「别一次性烤几十个」：
 *   • 单条串行队列（concurrency=1）——逐个烤，避免同时开几十个 WebGL 上下文；
 *   • 三层缓存：内存 Map → localStorage（跨会话）→ 失败集合（不重试坏模型）；
 *   • useCatalogThumbnail(url) 订阅，烤好即重渲染对应卡片。
 *
 * 缓存键 = GLB url，故换了模型文件路径会自动重烤；同一文件全目录共享一张图。
 */
import { useEffect, useState } from "react";
import { makeGlbThumbnail } from "./glbThumbnail";

const THUMB_SIZE = 96;
const LS_PREFIX = "glbthumb:v1:";

const mem = new Map<string, string>();        // key → dataURL
const failed = new Set<string>();             // key 烤失败，不再重试
const queued = new Set<string>();             // 已入队/在烤
const subs = new Map<string, Set<() => void>>(); // key → 重渲染回调
const queue: Array<{ key: string; url: string; recolor?: string }> = [];
let running = false;

// 缓存键 = url(+recolor)：换了模型路径或重涂色都会重烤。
const keyOf = (url: string, recolor?: string) => (recolor ? `${url}|${recolor}` : url);

function lsGet(url: string): string | null {
  try { return localStorage.getItem(LS_PREFIX + url); } catch { return null; }
}
function lsSet(url: string, data: string): void {
  try { localStorage.setItem(LS_PREFIX + url, data); } catch { /* 配额满：内存里留着就行 */ }
}
function notify(url: string): void {
  subs.get(url)?.forEach((fn) => fn());
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length) {
    const { key, url, recolor } = queue.shift()!;
    if (mem.has(key) || failed.has(key)) continue;
    const data = await makeGlbThumbnail(url, THUMB_SIZE, recolor);
    if (data) {
      mem.set(key, data);
      lsSet(key, data);
    } else {
      failed.add(key);
    }
    notify(key);
    // 让出一帧，别把主线程占死（缩略图是后台活）
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  running = false;
}

/** 取某个 GLB 的缩略图 dataURL；没有则返回 null（卡片回退到 emoji）。
 *  首次会把它排进串行队列后台烤，烤好后触发重渲染。 */
export function useCatalogThumbnail(url?: string, recolor?: string): string | null {
  const [, force] = useState(0);
  const key = url ? keyOf(url, recolor) : "";

  useEffect(() => {
    if (!url || mem.has(key) || failed.has(key)) return;
    // 先看 localStorage 有没有上次烤好的
    const cached = lsGet(key);
    if (cached) {
      mem.set(key, cached);
      force((x) => x + 1);
      return;
    }
    // 订阅 + 入队
    let set = subs.get(key);
    if (!set) { set = new Set(); subs.set(key, set); }
    const fn = () => force((x) => x + 1);
    set.add(fn);
    if (!queued.has(key)) {
      queued.add(key);
      queue.push({ key, url, recolor });
      void pump();
    }
    return () => { set!.delete(fn); };
  }, [key, url, recolor]);

  if (!url) return null;
  return mem.get(key) ?? null;
}
