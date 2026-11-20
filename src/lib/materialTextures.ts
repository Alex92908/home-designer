/**
 * materialTextures — 材料卡片的纹理色块（CSS background）。
 *
 * 现状：34 种材料里只有 6 种有 item.texture，其余 28 种在卡片上是
 * 一块 48px 纯色——墙漆、地砖、灯具看起来全一样。
 * 这里不改 data.ts 的数据（id/名字/价格不动），而是按名字关键词 +
 * category 推断纹理，生成程序化 CSS 图案；已有 texture 的材料原样保留。
 *
 * 图案族：木纹（竖板 + 纹线）、大理石（斜向石纹）、瓷砖（网格缝）、
 * 水泥（斑点）、织物（斜纹编织）、金属（斜向光泽）、灯具（暖光晕）、
 * 墙漆（柔和竖向光泽）。颜色始终取材料本身的 color，只做明暗变化，
 * 色块平均色与真实颜色一致。
 */
import type { MaterialItem } from "./types";

function shade(hex: string, amt: number): string {
  const h = (hex || "#888888").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = (i: number) => {
    const v = Math.max(0, Math.min(255, parseInt(full.slice(i, i + 2), 16) + amt));
    return v.toString(16).padStart(2, "0");
  };
  return `#${n(0)}${n(2)}${n(4)}`;
}

function has(name: string, ...keys: string[]): boolean {
  return keys.some((k) => name.includes(k));
}

/** 返回可直接用作 style.background 的 CSS（颜色或多层渐变）。 */
export function materialSwatchBackground(item: MaterialItem): string {
  if (item.texture) return item.texture;
  const base = item.color || "#888888";
  const light = shade(base, 26);
  const lighter = shade(base, 46);
  const dark = shade(base, -26);
  const darker = shade(base, -48);
  const name = item.name || "";

  // 灯具：暖光晕（灯本身就是光源，色块要亮）。
  if (item.category === "light") {
    return `radial-gradient(circle at 50% 42%, #fffdf4 0%, ${lighter} 34%, ${base} 62%, ${dark} 100%)`;
  }
  // 木纹：竖板 + 板缝 + 细纹线。
  if (has(name, "木", "橡木", "胡桃", "竹", "拼花", "地板", "木饰")) {
    return [
      `repeating-linear-gradient(90deg, ${base} 0 15px, ${dark} 15px 17px, ${base} 17px 32px, ${light} 32px 33px, ${base} 33px 48px)`,
      `linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0.05) 100%)`,
    ].join(", ");
  }
  // 大理石 / 石纹：斜向石纹 + 柔和色斑。
  if (has(name, "大理石", "石纹", "抛光", "石材", "玉石")) {
    return [
      `repeating-linear-gradient(115deg, transparent 0 20px, rgba(255,255,255,0.55) 20px 21px, transparent 21px 44px, rgba(0,0,0,0.07) 44px 45px, transparent 45px 68px)`,
      `radial-gradient(70px 40px at 28% 26%, rgba(255,255,255,0.35), transparent 70%)`,
      `linear-gradient(135deg, ${light} 0%, ${base} 55%, ${dark} 100%)`,
    ].join(", ");
  }
  // 瓷砖：网格缝。
  if (has(name, "砖", "瓷砖", "六角", "地铁", "通体")) {
    return [
      `repeating-linear-gradient(0deg, transparent 0 15px, rgba(0,0,0,0.14) 15px 16px)`,
      `repeating-linear-gradient(90deg, transparent 0 15px, rgba(0,0,0,0.14) 15px 16px)`,
      `linear-gradient(135deg, ${light} 0%, ${base} 60%, ${dark} 100%)`,
    ].join(", ");
  }
  // 水泥 / 混凝土：斑点。
  if (has(name, "水泥", "混凝土")) {
    return [
      `radial-gradient(circle at 22% 28%, rgba(0,0,0,0.10) 0 1.5px, transparent 2px)`,
      `radial-gradient(circle at 68% 62%, rgba(255,255,255,0.14) 0 1.5px, transparent 2px)`,
      `radial-gradient(circle at 82% 22%, rgba(0,0,0,0.08) 0 1px, transparent 1.5px)`,
      `linear-gradient(135deg, ${light} 0%, ${base} 55%, ${dark} 100%)`,
    ].join(", ");
  }
  // 织物 / 地毯 / 和纸：斜纹编织。
  if (has(name, "布", "织", "绒", "地毯", "和纸", "纸质")) {
    return [
      `repeating-linear-gradient(45deg, rgba(0,0,0,0.07) 0 2px, transparent 2px 6px)`,
      `repeating-linear-gradient(-45deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 6px)`,
      `linear-gradient(135deg, ${light} 0%, ${base} 60%, ${dark} 100%)`,
    ].join(", ");
  }
  // 金属 / 玻璃 / 水晶：斜向光泽带。
  if (has(name, "金属", "不锈钢", "轨道", "铜", "铝", "水晶", "玻璃", "磁吸")) {
    return `linear-gradient(105deg, ${lighter} 0%, ${base} 28%, ${darker} 50%, ${base} 72%, ${lighter} 100%)`;
  }
  // 墙漆 / 默认：柔和竖向光泽（保留平均色）。
  return `linear-gradient(155deg, ${light} 0%, ${base} 55%, ${dark} 100%)`;
}
