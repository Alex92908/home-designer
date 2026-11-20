/**
 * itemSilhouette — 没有 GLB、没有程序化几何、也没有实拍图的家具，
 * 给一张干净的类别剪影缩略图（SVG data URI），颜色取自家具本身。
 *
 * 覆盖：99 件纯目录家具（123 件无 GLB 减去 24 件有 imageUrl 实拍图，
 * 那些直接用 imageUrl）。140 件程序化家具有真 3D 烤图，不走这里；
 * 自定义家具（用户新建，无 model3d）回退到通用盒子剪影。
 *
 * 风格：暖灰工作室渐变底 + 落地阴影 + 单色剪影（深色描边），与
 * GLB/程序化烤图（glbThumbnail 工作室成片）视觉统一，都是 128×128。
 * 纯函数、无依赖、可在服务端/客户端任意调用，零网络、零 WebGL。
 */

import type { FurnitureItem } from "./types";

function shade(hex: string, amt: number): string {
  const h = (hex || "#8a8a8a").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = (i: number) => {
    const v = Math.max(0, Math.min(255, parseInt(full.slice(i, i + 2), 16) + amt));
    return v.toString(16).padStart(2, "0");
  };
  return `#${n(0)}${n(2)}${n(4)}`;
}

const BG = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#faf8f3"/>
      <stop offset="0.62" stop-color="#efece5"/>
      <stop offset="1" stop-color="#e2ddd3"/>
    </linearGradient>
    <radialGradient id="sh" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="rgba(60,50,35,0.30)"/>
      <stop offset="0.6" stop-color="rgba(60,50,35,0.12)"/>
      <stop offset="1" stop-color="rgba(60,50,35,0)"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" fill="url(#bg)"/>
  <ellipse cx="64" cy="106" rx="38" ry="6" fill="url(#sh)"/>
`;

type Shape = (f: string, s: string) => string;

// ─── 通用小件 ──────────────────────────────────────────────────────────
const box: Shape = (f, s) => `
  <polygon points="64,38 100,54 100,92 64,108 28,92 28,54" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <polyline points="28,54 64,70 100,54" fill="none" stroke="${s}" stroke-width="2"/>
  <line x1="64" y1="70" x2="64" y2="108" stroke="${s}" stroke-width="2"/>`;

const vase: Shape = (f, s) => `
  <path d="M56 44 h16 v6 c8 6 10 14 6 22 c-3 7 -8 12 -8 20 c0 8 4 10 4 14 h-20 c0 -4 4 -6 4 -14 c0 -8 -5 -13 -8 -20 c-4 -8 -2 -16 6 -22 z"
    fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M64 44 c-2 -10 -8 -12 -10 -18 M64 44 c2 -10 8 -12 10 -18" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="52" cy="24" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="76" cy="24" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>`;

// ─── 室内 ────────────────────────────────────────────────────────────
const fridge: Shape = (f, s) => `
  <rect x="42" y="22" width="44" height="84" rx="6" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="42" y1="58" x2="86" y2="58" stroke="${s}" stroke-width="2"/>
  <line x1="80" y1="30" x2="80" y2="50" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="80" y1="66" x2="80" y2="98" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

const chair: Shape = (f, s) => `
  <rect x="46" y="26" width="36" height="38" rx="5" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="40" y="64" width="48" height="10" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="46" y1="74" x2="42" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="82" y1="74" x2="86" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="64" y1="74" x2="64" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

const toilet: Shape = (f, s) => `
  <rect x="44" y="34" width="40" height="26" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M48 60 h32 c4 14 2 26 -6 32 c-6 5 -18 5 -24 0 c-8 -6 -10 -18 -6 -32 z" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="64" cy="62" rx="19" ry="5" fill="none" stroke="${s}" stroke-width="2"/>
  <line x1="58" y1="96" x2="58" y2="104" stroke="${s}" stroke-width="2.5"/>
  <line x1="70" y1="96" x2="70" y2="104" stroke="${s}" stroke-width="2.5"/>`;

const vanity: Shape = (f, s) => `
  <rect x="38" y="58" width="52" height="40" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="64" cy="56" rx="26" ry="6" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M64 56 v-12 q0 -6 10 -6" fill="none" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <rect x="40" y="24" width="48" height="24" rx="3" fill="none" stroke="${s}" stroke-width="2"/>
  <line x1="48" y1="30" x2="58" y2="42" stroke="${s}" stroke-width="1.5" opacity="0.6"/>`;

const faucet: Shape = (f, s) => `
  <rect x="52" y="86" width="24" height="8" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M64 86 V52 q0 -12 16 -12 h6" fill="none" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
  <line x1="52" y1="46" x2="62" y2="46" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="88" cy="42" r="3" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="88" cy="54" r="2" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="88" cy="64" r="2" fill="${f}" stroke="${s}" stroke-width="1.5"/>`;

const showerHead: Shape = (f, s) => `
  <line x1="52" y1="24" x2="52" y2="96" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="76" cy="34" rx="16" ry="5" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M52 34 q12 4 24 0" fill="none" stroke="${s}" stroke-width="2"/>
  <circle cx="70" cy="48" r="2" fill="${f}"/><circle cx="80" cy="56" r="2" fill="${f}"/><circle cx="72" cy="64" r="2" fill="${f}"/>`;

const rug: Shape = (f, s) => `
  <rect x="16" y="58" width="96" height="40" rx="6" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="24" y="66" width="80" height="24" rx="3" fill="none" stroke="${s}" stroke-width="1.5"/>
  <circle cx="64" cy="78" r="7" fill="none" stroke="${s}" stroke-width="1.5"/>
  <path d="M16 66 h96 M16 90 h96" stroke="${s}" stroke-width="1" opacity="0.5"/>`;

const artwork: Shape = (f, s) => `
  <rect x="30" y="24" width="68" height="68" rx="2" fill="${f}" stroke="${s}" stroke-width="3"/>
  <rect x="38" y="32" width="52" height="52" fill="none" stroke="${s}" stroke-width="1.5"/>
  <circle cx="76" cy="44" r="6" fill="${s}" opacity="0.55"/>
  <path d="M38 76 L56 54 L70 70 L82 58 L90 68 V84 H38 Z" fill="${s}" opacity="0.45"/>`;

const stairs: Shape = (f, s) => `
  <path d="M28 100 h16 V84 h16 V68 h16 V52 h16 V36 h16 V20 h8 v84 H28 Z" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M36 100 V84 M52 84 V68 M68 68 V52 M84 52 V36" stroke="${s}" stroke-width="1.5" opacity="0.6"/>`;

// ─── 电气 / 水暖 ──────────────────────────────────────────────────────
const outlet: Shape = (f, s) => `
  <rect x="44" y="30" width="40" height="56" rx="6" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="64" cy="50" r="8" fill="none" stroke="${s}" stroke-width="2"/>
  <circle cx="64" cy="50" r="2.5" fill="${s}"/>
  <circle cx="64" cy="72" r="8" fill="none" stroke="${s}" stroke-width="2"/>
  <circle cx="64" cy="72" r="2.5" fill="${s}"/>`;

const switchPlate: Shape = (f, s) => `
  <rect x="46" y="28" width="36" height="60" rx="6" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="57" y="42" width="14" height="20" rx="3" fill="none" stroke="${s}" stroke-width="2"/>
  <circle cx="64" cy="74" r="2.5" fill="${s}"/>`;

const panel: Shape = (f, s) => `
  <rect x="40" y="26" width="48" height="66" rx="5" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="48" y="36" width="10" height="18" rx="2" fill="none" stroke="${s}" stroke-width="1.5"/>
  <rect x="62" y="36" width="10" height="18" rx="2" fill="none" stroke="${s}" stroke-width="1.5"/>
  <rect x="76" y="36" width="4" height="18" rx="2" fill="none" stroke="${s}" stroke-width="1.5"/>
  <line x1="48" y1="62" x2="80" y2="62" stroke="${s}" stroke-width="1.5"/>
  <line x1="48" y1="70" x2="80" y2="70" stroke="${s}" stroke-width="1.5"/>
  <line x1="48" y1="78" x2="80" y2="78" stroke="${s}" stroke-width="1.5"/>`;

const drain: Shape = (f, s) => `
  <circle cx="64" cy="66" r="26" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="64" cy="66" r="18" fill="none" stroke="${s}" stroke-width="1.5"/>
  <path d="M48 66 h32 M64 50 v32 M53 55 l22 22 M75 55 l-22 22" stroke="${s}" stroke-width="1.5"/>`;

const pipeValve: Shape = (f, s) => `
  <path d="M40 96 V52 q0 -10 10 -10 h28" fill="none" stroke="${s}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="66" r="12" fill="none" stroke="${s}" stroke-width="3"/>
  <path d="M64 54 v24 M52 66 h24" stroke="${s}" stroke-width="2.5"/>
  <circle cx="52" cy="42" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>`;

const vent: Shape = (f, s) => `
  <rect x="34" y="40" width="60" height="48" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M42 52 h44 M42 64 h44 M42 76 h44" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

// ─── 户外 ────────────────────────────────────────────────────────────
const tree: Shape = (f, s) => `
  <path d="M60 104 V70" stroke="${s}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="52" r="20" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="46" cy="64" r="13" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="82" cy="64" r="13" fill="${f}" stroke="${s}" stroke-width="2"/>`;

const pine: Shape = (f, s) => `
  <path d="M64 100 V92" stroke="${s}" stroke-width="5" stroke-linecap="round"/>
  <polygon points="64,22 88,62 40,62" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="64,38 94,78 34,78" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="64,56 98,94 30,94" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>`;

const palm: Shape = (f, s) => `
  <path d="M62 104 q2 -34 10 -52" fill="none" stroke="${s}" stroke-width="4" stroke-linecap="round"/>
  <path d="M72 52 q-16 -14 -30 -8 q14 2 22 10 M72 52 q2 -18 -8 -26 q8 8 12 22 M72 52 q16 -12 28 -6 q-12 0 -20 8 M72 52 q14 2 20 14 q-10 -8 -18 -10"
    fill="none" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="70" cy="54" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="78" cy="58" r="3.5" fill="${f}" stroke="${s}" stroke-width="1.5"/>`;

const bamboo: Shape = (f, s) => `
  <path d="M52 104 V36 M64 104 V28 M76 104 V40" stroke="${s}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M52 52 q-10 -6 -14 -14 M52 52 q10 -8 16 -10 M64 44 q-10 -6 -14 -14 M64 44 q10 -6 16 -8 M76 56 q-8 -6 -12 -12 M76 56 q10 -6 14 -8"
    fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`;

const bush: Shape = (f, s) => `
  <circle cx="44" cy="82" r="14" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="64" cy="74" r="17" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="84" cy="82" r="14" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="52" cy="70" r="3" fill="#fff" opacity="0.7"/><circle cx="70" cy="66" r="3" fill="#fff" opacity="0.7"/><circle cx="80" cy="76" r="3" fill="#fff" opacity="0.7"/>`;

const lawn: Shape = (f, s) => `
  <rect x="28" y="82" width="72" height="20" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M40 82 q2 -10 4 0 M52 82 q2 -12 4 0 M64 82 q2 -10 4 0 M76 82 q2 -12 4 0 M88 82 q2 -10 4 0" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`;

const fence: Shape = (f, s) => `
  <path d="M34 104 V46 l6 -8 6 8 v58 M56 104 V46 l6 -8 6 8 v58 M78 104 V46 l6 -8 6 8 v58 M100 104 V46 l6 -8 6 8 v58" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <line x1="28" y1="62" x2="112" y2="62" stroke="${s}" stroke-width="3"/>
  <line x1="28" y1="86" x2="112" y2="86" stroke="${s}" stroke-width="3"/>`;

const pergola: Shape = (f, s) => `
  <line x1="36" y1="44" x2="36" y2="104" stroke="${s}" stroke-width="4" stroke-linecap="round"/>
  <line x1="92" y1="44" x2="92" y2="104" stroke="${s}" stroke-width="4" stroke-linecap="round"/>
  <rect x="28" y="32" width="72" height="9" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="40" y1="41" x2="40" y2="48" stroke="${s}" stroke-width="2"/>
  <line x1="52" y1="41" x2="52" y2="48" stroke="${s}" stroke-width="2"/>
  <line x1="64" y1="41" x2="64" y2="48" stroke="${s}" stroke-width="2"/>
  <line x1="76" y1="41" x2="76" y2="48" stroke="${s}" stroke-width="2"/>
  <line x1="88" y1="41" x2="88" y2="48" stroke="${s}" stroke-width="2"/>`;

const stones: Shape = (f, s) => `
  <ellipse cx="42" cy="88" rx="16" ry="8" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="70" cy="72" rx="16" ry="8" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="92" cy="52" rx="14" ry="7" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="52" cy="52" rx="12" ry="6" fill="${f}" stroke="${s}" stroke-width="2"/>`;

const pool: Shape = (f, s) => `
  <ellipse cx="64" cy="76" rx="44" ry="16" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M32 74 q8 -6 16 0 q8 6 16 0 q8 -6 16 0 q8 6 16 0" fill="none" stroke="${s}" stroke-width="1.5"/>
  <path d="M40 82 q8 -5 16 0 q8 5 16 0" fill="none" stroke="${s}" stroke-width="1.5" opacity="0.7"/>`;

const fountain: Shape = (f, s) => `
  <ellipse cx="64" cy="92" rx="40" ry="10" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="60" y="56" width="8" height="30" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="64" cy="56" rx="16" ry="5" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M64 52 q-10 -12 -4 -22 M64 52 q10 -12 4 -22 M64 52 V34" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="56" cy="28" r="2" fill="${f}"/><circle cx="72" cy="28" r="2" fill="${f}"/>`;

const solarPanel: Shape = (f, s) => `
  <polygon points="30,44 98,32 98,62 30,74" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M46 41 v28 M62 38 v28 M78 35 v28 M30 52 l68 -10 M30 62 l68 -10" stroke="${s}" stroke-width="1.5"/>
  <line x1="64" y1="68" x2="64" y2="102" stroke="${s}" stroke-width="3" stroke-linecap="round"/>`;

const parking: Shape = (f, s) => `
  <rect x="36" y="28" width="56" height="68" rx="8" fill="${f}" stroke="${s}" stroke-width="2"/>
  <text x="64" y="80" text-anchor="middle" font-size="42" font-weight="bold" font-family="sans-serif" fill="${s}">P</text>`;

const bbq: Shape = (f, s) => `
  <path d="M36 62 h56 a28 20 0 0 1 -56 0 z" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="48" y1="80" x2="42" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="80" y1="80" x2="86" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M52 52 q4 -8 0 -14 M66 52 q4 -8 0 -14 M78 54 q4 -8 0 -12" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`;

const greenhouse: Shape = (f, s) => `
  <path d="M34 102 V58 q0 -24 30 -24 q30 0 30 24 v44 z" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M34 70 h60 M49 36 v66 M64 34 v68 M79 36 v66" stroke="${s}" stroke-width="1.5" opacity="0.7"/>
  <rect x="58" y="80" width="12" height="22" fill="none" stroke="${s}" stroke-width="1.5"/>`;

const trampoline: Shape = (f, s) => `
  <ellipse cx="64" cy="58" rx="42" ry="10" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="34" y1="62" x2="28" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="94" y1="62" x2="100" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="52" y1="66" x2="50" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="76" y1="66" x2="78" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

const swing: Shape = (f, s) => `
  <path d="M40 30 L28 102 M88 30 L100 102 M40 30 h48" fill="none" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
  <line x1="56" y1="32" x2="52" y2="72" stroke="${s}" stroke-width="2"/>
  <line x1="72" y1="32" x2="76" y2="72" stroke="${s}" stroke-width="2"/>
  <rect x="46" y="72" width="36" height="7" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>`;

const shed: Shape = (f, s) => `
  <polygon points="28,58 64,32 100,58" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <rect x="36" y="58" width="56" height="44" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="56" y="72" width="16" height="30" fill="none" stroke="${s}" stroke-width="2"/>
  <line x1="68" y1="86" x2="68" y2="88" stroke="${s}" stroke-width="2"/>`;

const dogHouse: Shape = (f, s) => `
  <polygon points="30,62 64,36 98,62" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <rect x="38" y="62" width="52" height="40" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M56 102 v-18 a8 8 0 0 1 16 0 v18 z" fill="none" stroke="${s}" stroke-width="2"/>`;

const catTower: Shape = (f, s) => `
  <rect x="34" y="94" width="60" height="8" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="60" y="58" width="8" height="36" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="40" y="50" width="48" height="8" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="60" y="26" width="8" height="24" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="46" y="18" width="36" height="8" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>`;

const fishTank: Shape = (f, s) => `
  <rect x="32" y="40" width="64" height="48" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M32 54 h64" stroke="${s}" stroke-width="1.5"/>
  <ellipse cx="56" cy="70" rx="9" ry="5" fill="none" stroke="${s}" stroke-width="1.5"/>
  <polygon points="65,70 72,66 72,74" fill="${s}"/>
  <circle cx="82" cy="76" r="2" fill="${s}"/><circle cx="86" cy="66" r="2" fill="${s}"/>
  <line x1="44" y1="88" x2="40" y2="102" stroke="${s}" stroke-width="2.5"/>
  <line x1="84" y1="88" x2="88" y2="102" stroke="${s}" stroke-width="2.5"/>`;

const barn: Shape = (f, s) => `
  <path d="M32 102 V62 L44 44 Q64 30 84 44 L96 62 V102 Z" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <rect x="52" y="70" width="24" height="32" fill="none" stroke="${s}" stroke-width="2"/>
  <path d="M52 70 L76 102 M76 70 L52 102" stroke="${s}" stroke-width="1.5"/>`;

const helipad: Shape = (f, s) => `
  <circle cx="64" cy="64" r="38" fill="none" stroke="${s}" stroke-width="3"/>
  <text x="64" y="80" text-anchor="middle" font-size="38" font-weight="bold" font-family="sans-serif" fill="${s}">H</text>`;

// ─── 动物 ────────────────────────────────────────────────────────────
const dog: Shape = (f, s) => `
  <ellipse cx="58" cy="76" rx="28" ry="14" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="88" cy="60" r="13" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M80 50 q-4 -10 2 -12 q6 2 4 12" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="92" cy="58" r="1.8" fill="${s}"/>
  <path d="M32 70 q-12 -6 -10 -16 q8 2 12 10" fill="none" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="40" y1="88" x2="38" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="52" y1="89" x2="52" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="66" y1="89" x2="68" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="78" y1="88" x2="82" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

const cat: Shape = (f, s) => `
  <ellipse cx="58" cy="78" rx="26" ry="13" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="86" cy="62" r="12" fill="${f}" stroke="${s}" stroke-width="2"/>
  <polygon points="78,54 76,40 86,48" fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
  <polygon points="92,52 96,40 98,52" fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M34 74 q-10 -14 2 -24 q2 12 6 18" fill="none" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="42" y1="89" x2="40" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="72" y1="89" x2="74" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

const rabbit: Shape = (f, s) => `
  <ellipse cx="60" cy="80" rx="24" ry="14" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="86" cy="66" r="11" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="82" cy="44" rx="4" ry="13" fill="${f}" stroke="${s}" stroke-width="1.5" transform="rotate(-12 82 44)"/>
  <ellipse cx="92" cy="44" rx="4" ry="13" fill="${f}" stroke="${s}" stroke-width="1.5" transform="rotate(10 92 44)"/>
  <circle cx="38" cy="82" r="5" fill="${f}" stroke="${s}" stroke-width="1.5"/>`;

const cow: Shape = (f, s) => `
  <rect x="28" y="58" width="56" height="26" rx="12" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="80" y="52" width="20" height="22" rx="6" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M82 54 q-2 -8 -8 -10 M96 54 q2 -8 8 -10" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <ellipse cx="90" cy="68" rx="6" ry="4" fill="none" stroke="${s}" stroke-width="1.5"/>
  <line x1="38" y1="84" x2="36" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="52" y1="84" x2="52" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="66" y1="84" x2="68" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="78" y1="84" x2="80" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M28 64 q-8 4 -6 14" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`;

const pig: Shape = (f, s) => `
  <ellipse cx="60" cy="74" rx="30" ry="16" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="90" cy="68" r="11" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="99" cy="70" rx="4" ry="3" fill="none" stroke="${s}" stroke-width="1.5"/>
  <polygon points="82,58 80,48 88,56" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <path d="M32 72 q-8 2 -8 10" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <line x1="42" y1="88" x2="40" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="76" y1="88" x2="78" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

const horse: Shape = (f, s) => `
  <ellipse cx="56" cy="72" rx="28" ry="14" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M78 64 q4 -18 12 -22 l8 4 q-4 10 -6 20" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="96" cy="42" r="7" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <path d="M30 68 q-10 2 -10 12" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <line x1="38" y1="84" x2="34" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="52" y1="85" x2="52" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="66" y1="85" x2="68" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="78" y1="84" x2="84" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

const bird: Shape = (f, s) => `
  <ellipse cx="60" cy="72" rx="20" ry="13" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="80" cy="56" r="10" fill="${f}" stroke="${s}" stroke-width="2"/>
  <polygon points="89,54 100,58 89,62" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="83" cy="54" r="1.8" fill="${s}"/>
  <path d="M44 80 q-8 8 -4 18" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <line x1="54" y1="84" x2="52" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="66" y1="84" x2="68" y2="102" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M52 62 q-6 -8 -14 -8 M56 58 q-4 -10 -12 -12" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`;

const turtle: Shape = (f, s) => `
  <path d="M36 84 a28 22 0 0 1 56 0 z" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M50 66 v10 M64 62 v14 M78 66 v10" stroke="${s}" stroke-width="1.5"/>
  <circle cx="96" cy="78" r="7" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="34" cy="82" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <line x1="46" y1="84" x2="44" y2="94" stroke="${s}" stroke-width="2.5"/>
  <line x1="80" y1="84" x2="82" y2="94" stroke="${s}" stroke-width="2.5"/>`;

const hamster: Shape = (f, s) => `
  <circle cx="62" cy="74" r="22" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="46" cy="56" r="5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="78" cy="56" r="5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <circle cx="54" cy="70" r="1.8" fill="${s}"/><circle cx="70" cy="70" r="1.8" fill="${s}"/>
  <path d="M82 82 q10 2 10 10" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`;

const parrot: Shape = (f, s) => `
  <ellipse cx="60" cy="68" rx="16" ry="18" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="66" cy="44" r="9" fill="${f}" stroke="${s}" stroke-width="2"/>
  <polygon points="74,42 84,46 74,50" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <path d="M52 84 q-4 12 -10 16" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <line x1="58" y1="86" x2="58" y2="96" stroke="${s}" stroke-width="2.5"/>
  <line x1="66" y1="86" x2="66" y2="96" stroke="${s}" stroke-width="2.5"/>
  <line x1="48" y1="98" x2="78" y2="98" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`;

// ─── 外墙装饰 ────────────────────────────────────────────────────────
const wallLamp: Shape = (f, s) => `
  <polygon points="52,44 76,44 84,66 44,66" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <line x1="64" y1="44" x2="64" y2="28" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="64" cy="28" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <path d="M48 76 l-6 12 M64 76 v12 M80 76 l6 12" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`;

const lightStrip: Shape = (f, s) => `
  <rect x="24" y="56" width="80" height="12" rx="6" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M32 52 v-8 M48 52 v-8 M64 52 v-8 M80 52 v-8 M96 52 v-8" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="32" cy="40" r="2.5" fill="${f}"/><circle cx="48" cy="40" r="2.5" fill="${f}"/><circle cx="64" cy="40" r="2.5" fill="${f}"/><circle cx="80" cy="40" r="2.5" fill="${f}"/><circle cx="96" cy="40" r="2.5" fill="${f}"/>`;

const mural: Shape = (f, s) => `
  <rect x="28" y="30" width="72" height="56" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
  <path d="M28 62 q12 -10 24 0 q12 10 24 0 q12 -8 24 -2" fill="none" stroke="${s}" stroke-width="2"/>
  <path d="M28 74 q12 -8 24 0 q12 8 24 0 q12 -6 24 0" fill="none" stroke="${s}" stroke-width="1.5" opacity="0.7"/>
  <circle cx="82" cy="44" r="5" fill="${s}" opacity="0.6"/>`;

const couplet: Shape = (f, s) => `
  <rect x="36" y="22" width="18" height="80" rx="2" fill="${f}" stroke="${s}" stroke-width="2"/>
  <rect x="74" y="22" width="18" height="80" rx="2" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="45" cy="34" r="3" fill="${s}"/><circle cx="45" cy="50" r="3" fill="${s}"/><circle cx="45" cy="66" r="3" fill="${s}"/>
  <circle cx="83" cy="34" r="3" fill="${s}"/><circle cx="83" cy="50" r="3" fill="${s}"/><circle cx="83" cy="66" r="3" fill="${s}"/>
  <rect x="54" y="30" width="20" height="14" rx="2" fill="none" stroke="${s}" stroke-width="1.5"/>`;

const signBoard: Shape = (f, s) => `
  <rect x="26" y="42" width="76" height="36" rx="5" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="36" y1="54" x2="92" y2="54" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <line x1="36" y1="66" x2="74" y2="66" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
  <line x1="36" y1="42" x2="36" y2="30" stroke="${s}" stroke-width="2"/>
  <line x1="92" y1="42" x2="92" y2="30" stroke="${s}" stroke-width="2"/>`;

const mailbox: Shape = (f, s) => `
  <path d="M44 52 a20 16 0 0 1 40 0 v22 H44 z" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="84" y1="52" x2="84" y2="34" stroke="${s}" stroke-width="2.5"/>
  <circle cx="84" cy="32" r="3" fill="${f}" stroke="${s}" stroke-width="1.5"/>
  <line x1="64" y1="74" x2="64" y2="102" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
  <line x1="48" y1="60" x2="76" y2="60" stroke="${s}" stroke-width="1.5"/>`;

const vine: Shape = (f, s) => `
  <path d="M64 102 q-14 -18 0 -34 q14 -16 0 -32 q-12 -12 0 -22" fill="none" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
  <ellipse cx="52" cy="66" rx="7" ry="4" fill="${f}" stroke="${s}" stroke-width="1.5" transform="rotate(-30 52 66)"/>
  <ellipse cx="78" cy="48" rx="7" ry="4" fill="${f}" stroke="${s}" stroke-width="1.5" transform="rotate(30 78 48)"/>
  <ellipse cx="54" cy="30" rx="6" ry="3.5" fill="${f}" stroke="${s}" stroke-width="1.5" transform="rotate(-30 54 30)"/>`;

const acUnit: Shape = (f, s) => `
  <rect x="32" y="48" width="64" height="40" rx="5" fill="${f}" stroke="${s}" stroke-width="2"/>
  <circle cx="64" cy="68" r="13" fill="none" stroke="${s}" stroke-width="2"/>
  <path d="M64 55 v26 M51 68 h26 M55 59 l18 18 M73 59 l-18 18" stroke="${s}" stroke-width="1.5"/>
  <line x1="44" y1="88" x2="42" y2="96" stroke="${s}" stroke-width="2.5"/>
  <line x1="84" y1="88" x2="86" y2="96" stroke="${s}" stroke-width="2.5"/>`;

const roofVent: Shape = (f, s) => `
  <rect x="52" y="56" width="24" height="44" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="64" cy="52" rx="20" ry="7" fill="${f}" stroke="${s}" stroke-width="2"/>
  <ellipse cx="64" cy="40" rx="13" ry="5" fill="${f}" stroke="${s}" stroke-width="2"/>
  <line x1="64" y1="40" x2="64" y2="30" stroke="${s}" stroke-width="2.5"/>`;

const skylight: Shape = (f, s) => `
  <polygon points="32,66 96,50 96,72 32,88" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
  <line x1="64" y1="58" x2="64" y2="80" stroke="${s}" stroke-width="1.5"/>
  <line x1="48" y1="62" x2="48" y2="84" stroke="${s}" stroke-width="1.5"/>
  <line x1="80" y1="54" x2="80" y2="76" stroke="${s}" stroke-width="1.5"/>`;

// ─── 类别 → 剪影 ─────────────────────────────────────────────────────
const BY_CATEGORY: Record<string, Shape> = {
  rug: rug,
  artwork: artwork,
  refrigerator: fridge,
  office_chair: chair,
  outdoor_plant: tree,
  outdoor_hardscape: stones,
  outdoor_water: pool,
  outdoor_structure: shed,
  stair: stairs,
  pet: dog,
  livestock: cow,
  toilet: toilet,
  bathroom_vanity: vanity,
  bath_accessory: faucet,
  plumbing: pipeValve,
  electrical: outlet,
  exterior_wall_decor: mural,
  decor: vase,
  sofa: (f, s) => `
    <rect x="24" y="46" width="80" height="26" rx="6" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="20" y="68" width="88" height="16" rx="5" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="20" y="62" width="12" height="22" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="96" y="62" width="12" height="22" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
    <line x1="30" y1="84" x2="28" y2="100" stroke="${s}" stroke-width="2.5"/>
    <line x1="98" y1="84" x2="100" y2="100" stroke="${s}" stroke-width="2.5"/>`,
  bed: (f, s) => `
    <rect x="22" y="36" width="10" height="56" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="32" y="66" width="74" height="20" rx="5" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="36" y="58" width="22" height="10" rx="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>
    <line x1="38" y1="86" x2="36" y2="100" stroke="${s}" stroke-width="2.5"/>
    <line x1="100" y1="86" x2="102" y2="100" stroke="${s}" stroke-width="2.5"/>`,
  storage: box,
  lamp: (f, s) => `
    <polygon points="52,30 76,30 84,52 44,52" fill="${f}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>
    <line x1="64" y1="52" x2="64" y2="96" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="64" cy="100" rx="14" ry="4" fill="${f}" stroke="${s}" stroke-width="2"/>`,
};

// ─── id 特例（类别剪影不够传神的）───────────────────────────────────
const BY_ID: Record<string, Shape> = {
  "tree-pine": pine,
  "tree-palm": palm,
  bamboo: bamboo,
  "bush-flower": bush,
  "rose-bush": bush,
  "flower-bed": bush,
  "cherry-tree": tree,
  "lawn-patch": lawn,
  fence: fence,
  pergola: pergola,
  deck: (f, s) => `
    <rect x="24" y="70" width="80" height="26" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
    <path d="M24 79 h80 M24 88 h80 M44 70 v26 M64 70 v26 M84 70 v26" stroke="${s}" stroke-width="1.5"/>`,
  "bbq-grill": bbq,
  "parking-spot": parking,
  "solar-panel-array": solarPanel,
  "solar-thermal-collector": solarPanel,
  "roof-vent": roofVent,
  "hvac-condenser": acUnit,
  "ac-condenser": acUnit,
  "roof-skylight": skylight,
  "green-roof-patch": lawn,
  "lightning-rod": (f, s) => `
    <line x1="64" y1="100" x2="64" y2="26" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
    <polygon points="64,14 70,28 58,28" fill="${f}" stroke="${s}" stroke-width="1.5"/>
    <path d="M64 40 q-10 4 -12 12 M64 52 q10 4 12 12" fill="none" stroke="${s}" stroke-width="1.5"/>`,
  "antenna-mast": (f, s) => `
    <line x1="64" y1="102" x2="64" y2="24" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
    <path d="M48 36 h32 M52 52 h24 M56 68 h16" stroke="${s}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="78" cy="30" r="6" fill="none" stroke="${s}" stroke-width="2"/>`,
  "weather-station": (f, s) => `
    <line x1="64" y1="102" x2="64" y2="30" stroke="${s}" stroke-width="3" stroke-linecap="round"/>
    <rect x="50" y="52" width="28" height="18" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
    <path d="M64 30 v-8 M56 24 l16 0 M64 22 l6 -6 M64 22 l-6 -6" fill="none" stroke="${s}" stroke-width="2" stroke-linecap="round"/>`,
  "roof-scupper": (f, s) => `
    <rect x="30" y="58" width="52" height="14" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
    <path d="M82 58 h14 v10 h-14" fill="none" stroke="${s}" stroke-width="2"/>
    <circle cx="92" cy="82" r="2.5" fill="${f}"/><circle cx="98" cy="90" r="2.5" fill="${f}"/>`,
  "helipad-marking": helipad,
  fountain: fountain,
  "hot-tub": pool,
  "hot-tub-yard": pool,
  "cold-plunge-pool": pool,
  "reflecting-pool": pool,
  pond: pool,
  "sky-bar": (f, s) => `
    <rect x="28" y="62" width="72" height="30" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="36" y="40" width="8" height="22" fill="${f}" stroke="${s}" stroke-width="1.5"/>
    <rect x="52" y="34" width="8" height="28" fill="${f}" stroke="${s}" stroke-width="1.5"/>
    <rect x="68" y="40" width="8" height="22" fill="${f}" stroke="${s}" stroke-width="1.5"/>
    <circle cx="40" cy="34" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>
    <circle cx="56" cy="28" r="4" fill="${f}" stroke="${s}" stroke-width="1.5"/>`,
  greenhouse: greenhouse,
  shed: shed,
  trampoline: trampoline,
  swing: swing,
  sandbox: (f, s) => `
    <rect x="30" y="72" width="68" height="24" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
    <circle cx="48" cy="80" r="5" fill="none" stroke="${s}" stroke-width="1.5"/>
    <circle cx="66" cy="86" r="5" fill="none" stroke="${s}" stroke-width="1.5"/>
    <path d="M76 72 V52 h12 l-4 20" fill="${f}" stroke="${s}" stroke-width="1.5"/>`,
  "gym-outdoor": (f, s) => `
    <rect x="30" y="60" width="14" height="26" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="84" y="60" width="14" height="26" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
    <rect x="44" y="69" width="40" height="8" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>`,
  "staircase-spiral": (f, s) => `
    <ellipse cx="64" cy="66" rx="34" ry="26" fill="none" stroke="${s}" stroke-width="2"/>
    <ellipse cx="64" cy="66" rx="20" ry="14" fill="none" stroke="${s}" stroke-width="2"/>
    <ellipse cx="64" cy="66" rx="8" ry="5" fill="${f}" stroke="${s}" stroke-width="2"/>
    <line x1="64" y1="40" x2="64" y2="102" stroke="${s}" stroke-width="2"/>`,
  "dog-large": dog,
  "dog-small": dog,
  "cat-tower": catTower,
  "dog-house": dogHouse,
  rabbit: rabbit,
  "fish-tank": fishTank,
  parrot: parrot,
  turtle: turtle,
  hamster: hamster,
  chicken: bird,
  rooster: bird,
  duck: bird,
  goose: bird,
  pig: pig,
  cow: cow,
  goat: cow,
  sheep: cow,
  horse: horse,
  "chicken-coop": barn,
  barn: barn,
  "toilet-squat": (f, s) => `
    <ellipse cx="64" cy="76" rx="30" ry="16" fill="${f}" stroke="${s}" stroke-width="2"/>
    <ellipse cx="64" cy="74" rx="14" ry="7" fill="none" stroke="${s}" stroke-width="2"/>
    <rect x="52" y="48" width="24" height="12" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>`,
  "mirror-cabinet": vanity,
  "shower-head": showerHead,
  "faucet-basin": faucet,
  "floor-drain": drain,
  "water-supply-cold": pipeValve,
  "water-supply-hot": pipeValve,
  "drain-point": drain,
  "exhaust-vent": vent,
  "outlet-2pin": outlet,
  "outlet-usb": outlet,
  "switch-single": switchPlate,
  "switch-double": switchPlate,
  "breaker-panel": panel,
  "weak-panel": panel,
  "network-jack": outlet,
  "tv-jack": outlet,
  "wall-lamp-modern": wallLamp,
  "wall-lamp-lantern": wallLamp,
  "light-strip-warm": lightStrip,
  "light-strip-rgb": lightStrip,
  "mural-great-wave": mural,
  "mural-red-fuji": mural,
  "mural-wheatfield": mural,
  "mural-inkwash": mural,
  "couplet-spring": couplet,
  "couplet-prosperity": couplet,
  "border-meander": lightStrip,
  "border-floral": lightStrip,
  "house-number": signBoard,
  "nameplate-family": signBoard,
  "sign-restroom-men": signBoard,
  "sign-restroom-women": signBoard,
  "mailbox-modern": mailbox,
  "sign-cafe-wall": signBoard,
  "climbing-vine": vine,
  "partition-stall": (f, s) => `
    <rect x="36" y="30" width="56" height="72" rx="3" fill="${f}" stroke="${s}" stroke-width="2"/>
    <line x1="64" y1="30" x2="64" y2="102" stroke="${s}" stroke-width="1.5"/>
    <circle cx="58" cy="66" r="2.5" fill="${s}"/>`,
  "stall-door": (f, s) => `
    <rect x="40" y="28" width="48" height="76" rx="4" fill="${f}" stroke="${s}" stroke-width="2"/>
    <circle cx="80" cy="66" r="3" fill="${s}"/>
    <line x1="40" y1="44" x2="88" y2="44" stroke="${s}" stroke-width="1.5"/>`,
  "sign-shop-fascia": signBoard,
  "chair-simple-fabric": chair,
  "fridge-french-door": fridge,
  "fridge-single-white": fridge,
};

/**
 * 返回一件家具的 SVG 剪影缩略图 data URI（128×128）。
 * 颜色取 item.color；描边为加深色。同步、无网络。
 */
export function itemSilhouetteDataUri(item: FurnitureItem): string {
  const fill = item.color || "#8a8a8a";
  const stroke = shade(fill, -46);
  const shape = BY_ID[item.id] ?? BY_CATEGORY[item.category] ?? box;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${BG}${shape(fill, stroke)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
