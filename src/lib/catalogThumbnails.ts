"use client";

/**
 * catalogThumbnails — 目录里每件家具的卡片缩略图。
 *
 * 四档来源（按优先级）：
 *   1. 有 GLB → 离屏烤真 3D 图（makeGlbThumbnail，工作室成片）；
 *   2. 程序化家具（proc-，140 件）→ 用同一 builder 离屏烤真 3D 图
 *      （makeProceduralThumbnail，与摆进房间的几何同一来源）；
 *   3. 有 imageUrl 的（装饰画/壁画/对联等 24 件）→ 直接用实拍图；
 *   4. 其余（99 件）→ 类别 SVG 剪影（itemSilhouetteDataUri，同步生成，
 *      颜色取家具本身）。
 * 目标：目录里不再有纯文字卡片。
 *
 * 复用 makeGlbThumbnail 的策略：
 *   • 单条串行队列（concurrency=1）——逐个烤，避免同时开几十个 WebGL 上下文；
 *   • 三层缓存：内存 Map → localStorage（跨会话）→ 失败集合（不重试坏模型）；
 *   • useItemThumbnail(item) 订阅，烤好即重渲染对应卡片。
 *
 * 缓存键 = 来源 + 标识；缓存前缀 v2——Batch 3 换了工作室成片，
 * 旧版 v1 的灰底小图要重烤。
 */
import { useEffect, useMemo, useState } from "react";
import type { FurnitureItem } from "./types";
import { makeGlbThumbnail } from "./glbThumbnail";
import { isProceduralFurnitureId } from "./proceduralFurnitureIds";

const THUMB_SIZE = 128;
const LS_PREFIX = "glbthumb:v2:";

const mem = new Map<string, string>();        // key → dataURL
const failed = new Set<string>();             // key 烤失败，不再重试
const queued = new Set<string>();             // 已入队/在烤
const subs = new Map<string, Set<() => void>>(); // key → 重渲染回调
const queue: Array<{ key: string; kind: "glb" | "proc"; item: FurnitureItem }> = [];
let running = false;

// 缓存键：GLB 按 url(+recolor)，程序化按 id(+color)，换了模型/颜色会重烤。
const keyOf = (item: FurnitureItem): { key: string; kind: "glb" | "proc" } | null => {
  if (item.model3d?.url) {
    return { key: `glb:${item.model3d.url}${item.model3d.recolor ? `|${item.model3d.recolor}` : ""}`, kind: "glb" };
  }
  if (isProceduralFurnitureId(item.id)) {
    return { key: `proc:${item.id}|${item.color ?? ""}|${item.secondaryColor ?? ""}`, kind: "proc" };
  }
  return null;
};

function lsGet(key: string): string | null {
  try { return localStorage.getItem(LS_PREFIX + key); } catch { return null; }
}
function lsSet(key: string, data: string): void {
  try { localStorage.setItem(LS_PREFIX + key, data); } catch { /* 配额满：内存里留着就行 */ }
}
function notify(key: string): void {
  subs.get(key)?.forEach((fn) => fn());
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length) {
    const { key, kind, item } = queue.shift()!;
    if (mem.has(key) || failed.has(key)) continue;
    const data = kind === "glb"
      ? await makeGlbThumbnail(item.model3d!.url, THUMB_SIZE, item.model3d!.recolor)
      : await (await import("./proceduralThumbnail")).makeProceduralThumbnail(item, THUMB_SIZE);
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

/**
 * 取一件家具的卡片缩略图。
 * imageUrl / SVG 剪影是同步的（立即返回）；GLB / 程序化是后台烤，
 * 首次返回 null（卡片先显示 SVG 剪影占位——见 LeftPanel），烤好后重渲染。
 * 注意：返回 null 时调用方应显示 itemSilhouetteDataUri(item) 作占位，
 * 而不是空白或 emoji。
 */
export function useItemThumbnail(item: FurnitureItem): string | null {
  const [, force] = useState(0);
  const baked = useMemo(() => keyOf(item), [item.id, item.model3d?.url, item.model3d?.recolor, item.color, item.secondaryColor]);
  const key = baked?.key ?? "";

  useEffect(() => {
    if (!baked) return;
    if (mem.has(key) || failed.has(key)) return;
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
      queue.push({ key, kind: baked.kind, item });
      void pump();
    }
    return () => { set!.delete(fn); };
  }, [key, baked]);

  // 实拍图只用于没有可烤来源的家具（装饰画/壁画/对联等）。
  // 带 GLB 的电视柜也有 imageUrl（那是电视屏幕画，不是柜子本身），
  // 必须烤 GLB，不能直接拿画当柜子缩略图。
  if (!baked) {
    if (item.imageUrl) return item.imageUrl;
    return null;
  }
  return mem.get(key) ?? null;
}
