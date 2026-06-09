/**
 * HTML-based PDF export — uses window.print() instead of jsPDF.
 * Advantages: native font support (Chinese/emoji), richer layout,
 * no font-embedding needed.
 */

import { MaterialItem, RoomType, getRoomArea, ROOM_DEFS, PlacedItem } from "./types";
import { getFurnitureById } from "./furniture";
import { getMaterialNameEn, getBrandNameEn, getFurnitureNameEn } from "@/locales/itemNames";
import { formatPrice } from "./currency";
import { getLocalizedRoomName } from "./i18n";

// ─── Helpers ──────────────────────────────────────────────────

const CAT_ZH: Record<string,string> = {
  wall:"墙面", floor:"地板", ceiling:"吊顶", light:"灯光", tile:"瓷砖",
};
const CAT_EN: Record<string,string> = {
  wall:"Wall", floor:"Floor", ceiling:"Ceiling", light:"Lighting", tile:"Tile",
};

function roomName(room: RoomType, locale: string): string {
  return getLocalizedRoomName(room, locale === "en" ? "en" : "zh");
}
function matName(item: MaterialItem, locale: string): string {
  return locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name;
}
function brandName(b: string, locale: string): string {
  return locale === "en" ? (getBrandNameEn(b) ?? b) : b;
}
function furnitureName(id: string, zhName: string, locale: string): string {
  return locale === "en" ? (getFurnitureNameEn(id) ?? zhName) : zhName;
}
function catLabel(cat: string, locale: string): string {
  return locale === "en" ? (CAT_EN[cat] ?? cat) : (CAT_ZH[cat] ?? cat);
}
function fmtPrice(v: number, locale: string): string {
  return formatPrice(v, locale);
}

// ─── Shared print window opener ───────────────────────────────
// Blob URL + Google Noto Sans SC solves Chrome's CJK print-rendering bug:
// system fonts (PingFang SC, YaHei) render fine on screen but disappear in
// Chrome's PDF renderer. A web font loaded via <link> gets properly embedded.

const FONT_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap">`;

// Auto-print fires only after all fonts (including Noto SC) are ready
const AUTO_PRINT = `<script>
  document.fonts.ready.then(function(){setTimeout(function(){window.print();},300);});
<\/script>`;

function printHtml(html: string): void {
  const enriched = html
    .replace("<head>", `<head>${FONT_LINK}`)
    .replace("</body>", `${AUTO_PRINT}</body>`);
  const blob = new Blob([enriched], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, "_blank", "width=900,height=700");
  if (!w) { alert("Please allow pop-ups to export PDF."); return; }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

// ─── Shared base CSS ──────────────────────────────────────────

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
         color: #1d1d1f; font-size: 13px; background: #fff; }
  @media print {
    @page { margin: 12mm 14mm; size: A4; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
  .header { background: linear-gradient(135deg,#007AFF,#5856D6); color:#fff; padding:24px 28px; }
  .header h1 { font-size:22px; font-weight:800; margin-bottom:4px; }
  .header .meta { font-size:11px; opacity:.8; margin-top:2px; }
  .header .total { font-size:28px; font-weight:900; }
  .header .total-label { font-size:10px; opacity:.7; margin-top:2px; }
  .body { padding:20px 28px; }
  .section-title { font-size:10px; font-weight:700; text-transform:uppercase;
                   letter-spacing:.08em; color:#8e8e93; margin:18px 0 8px; }
  table { width:100%; border-collapse:collapse; margin-bottom:16px; }
  th { background:#007AFF; color:#fff; font-size:11px; font-weight:700;
       padding:6px 8px; text-align:left; }
  th:last-child, td:last-child { text-align:right; }
  td { padding:7px 8px; font-size:12px; border-bottom:1px solid #f0f0f5; }
  tr:nth-child(even) td { background:#fafafe; }
  .swatch { display:inline-block; width:12px; height:12px; border-radius:3px;
            border:1px solid rgba(0,0,0,.12); vertical-align:middle; margin-right:6px; }
  .total-row { display:flex; justify-content:flex-end; align-items:center;
               gap:12px; padding:10px 0; border-top:2px solid #007AFF; margin-top:4px; }
  .total-row .label { font-size:13px; font-weight:700; color:#1d1d1f; }
  .total-row .amount { font-size:20px; font-weight:900; color:#007AFF; }
  .notes { background:#f5f5f7; border-radius:8px; padding:12px 16px; margin-top:20px; }
  .notes p { font-size:10px; color:#6e6e73; line-height:1.7; }
  .footer { margin-top:24px; padding-top:10px; border-top:1px solid #e8e8ed;
            display:flex; justify-content:space-between; font-size:10px; color:#aeaeb2; }
  .room-header { background:#f0f6ff; border-left:3px solid #007AFF;
                 padding:6px 10px; margin:14px 0 6px; font-weight:700; font-size:13px; }
  .room-subtotal { text-align:right; font-size:12px; font-weight:700;
                   color:#007AFF; padding:4px 8px 10px; }
  .budget-bar-wrap { margin:12px 0 16px; }
  .budget-meta { display:flex; justify-content:space-between; font-size:11px;
                 color:#6e6e73; margin-bottom:5px; }
  .budget-meta .status { font-weight:700; }
  .budget-meta .status.ok { color:#34c759; }
  .budget-meta .status.over { color:#ff3b30; }
  .bar-bg { background:#e8e8ed; border-radius:4px; height:7px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:4px; }
  .tab-toggle { display:flex; gap:0; margin-bottom:20px; border:1px solid #007AFF; border-radius:8px; overflow:hidden; }
  .tab-toggle button { flex:1; padding:8px; font-size:12px; font-weight:600; cursor:pointer;
                       background:#fff; color:#007AFF; border:none; }
  .tab-toggle button.active { background:#007AFF; color:#fff; }
  .print-btn { display:block; margin:0 auto 16px; padding:10px 32px;
               background:#007AFF; color:#fff; border:none; border-radius:10px;
               font-size:14px; font-weight:700; cursor:pointer; }
`;

// ─── Single-room PDF ──────────────────────────────────────────

export interface ExportData {
  room: RoomType;
  items: MaterialItem[];           // material items
  placedItems: PlacedItem[];       // furniture
  totalCost: number;
  scores: { style: number; space: number; light: number; dominantStyle: string };
  phone: string;
  locale: string;
}

export function generatePdf(data: ExportData): void {
  const { room, items, placedItems, totalCost, scores, phone, locale } = data;
  const area = getRoomArea(room);
  const isEn = locale === "en";
  const date = new Date().toLocaleDateString(isEn ? "en-US" : "zh-CN");
  const title = isEn ? "Decoration Quote" : "装修报价单";
  const rName = roomName(room, locale);

  // Materials rows
  let matRows = "";
  let matTotal = 0;
  items.forEach(item => {
    const qty = item.category === "wall" ? area.wall
              : item.category === "floor" ? area.floor
              : item.id === "light-spot" ? 8 : 1;
    const qtyStr = ["wall","floor","tile"].includes(item.category)
      ? `${qty}㎡` : item.id === "light-spot" ? "×8" : "×1";
    const sub = item.price * qty;
    matTotal += sub;
    const cat = catLabel(item.category, locale);
    const name = matName(item, locale);
    const brand = brandName(item.brand, locale);
    matRows += `<tr>
      <td>${cat}</td>
      <td><span class="swatch" style="background:${item.color}"></span>${name}</td>
      <td>${brand}</td>
      <td>${fmtPrice(item.price, locale)}</td>
      <td>${qtyStr}</td>
      <td><b>${fmtPrice(sub, locale)}</b></td>
    </tr>`;
  });

  // Furniture rows
  let furRows = "";
  let furTotal = 0;
  placedItems.forEach(p => {
    const f = getFurnitureById(p.furnitureId);
    if (!f) return;
    furTotal += f.price;
    const name = furnitureName(f.id, f.name, locale);
    const brand = brandName(f.brand, locale);
    furRows += `<tr>
      <td style="font-size:16px;width:28px">${f.icon}</td>
      <td>${name}</td>
      <td>${brand}</td>
      <td colspan="2">&nbsp;</td>
      <td><b>${fmtPrice(f.price, locale)}</b></td>
    </tr>`;
  });

  const scoreSection = scores.dominantStyle ? `
    <div class="section-title">${isEn ? "Design Score" : "方案评分"}</div>
    <table>
      <tr>
        <td style="width:120px"><b>${isEn?"Style":"风格"}: ${scores.dominantStyle}</b></td>
        <td>
          ${[[isEn?"Harmony":"风格协调", scores.style, "#007AFF"],
             [isEn?"Space":"空间感", scores.space, "#34c759"],
             [isEn?"Lighting":"采光", scores.light, "#f59e0b"]]
            .map(([l,v,c])=>`
              <span style="font-size:11px;color:#6e6e73;margin-right:4px">${l}</span>
              <span style="display:inline-block;width:80px;height:6px;background:#e8e8ed;border-radius:3px;vertical-align:middle;margin-right:2px">
                <span style="display:inline-block;width:${v}%;height:100%;background:${c};border-radius:3px"></span>
              </span>
              <b style="font-size:11px;color:${c};margin-right:12px">${v}</b>
            `).join("")}
        </td>
      </tr>
    </table>` : "";

  const html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${title} - ${rName}</title>
    <style>${BASE_CSS}</style>
  </head><body>
    <button class="print-btn no-print" onclick="window.print()">
      ${isEn ? "📄 Save as PDF" : "📄 保存为 PDF"}
    </button>
    <div class="header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <h1>${title}</h1>
          <div class="meta">${isEn?"Room":"房间"}: ${rName} &nbsp;|&nbsp; ${isEn?"Date":"日期"}: ${date}</div>
          <div class="meta">${isEn?"Contact":"联系人"}: ${phone || "N/A"}</div>
        </div>
        <div style="text-align:right">
          <div class="total">${fmtPrice(totalCost, locale)}</div>
          <div class="total-label">${isEn?"Total Estimate":"合计估价"}</div>
        </div>
      </div>
    </div>
    <div class="body">
      ${scoreSection}
      ${items.length > 0 ? `
        <div class="section-title">${isEn?"Materials":"材料明细"}</div>
        <table>
          <thead><tr>
            <th>${isEn?"Category":"类别"}</th>
            <th>${isEn?"Material":"材料"}</th>
            <th>${isEn?"Brand":"品牌"}</th>
            <th>${isEn?"Unit Price":"单价"}</th>
            <th>${isEn?"Qty":"数量"}</th>
            <th>${isEn?"Subtotal":"小计"}</th>
          </tr></thead>
          <tbody>${matRows}</tbody>
        </table>` : ""}
      ${placedItems.length > 0 ? `
        <div class="section-title">${isEn?"Furniture":"家具清单"} (${placedItems.length})</div>
        <table>
          <thead><tr>
            <th></th>
            <th>${isEn?"Item":"品名"}</th>
            <th>${isEn?"Brand":"品牌"}</th>
            <th colspan="2"></th>
            <th>${isEn?"Price":"单价"}</th>
          </tr></thead>
          <tbody>${furRows}</tbody>
        </table>` : ""}
      <div class="total-row">
        <span class="label">${rName} ${isEn?"Total":"合计"}</span>
        <span class="amount">${fmtPrice(totalCost, locale)}</span>
      </div>
      <div class="notes">
        <p>* ${isEn?"This quote covers materials and furniture only. Labor costs are estimated at 30–50% of materials."
                  :"本报价仅包含材料及家具费用，人工费约为材料费的30–50%。"}</p>
        <p>* ${isEn?"Prices may vary by region and supplier. Final quote to be confirmed with contractor."
                  :"实际价格因地区和供应商不同而异，最终报价以施工方确认为准。"}</p>
      </div>
      <div class="footer">
        <span>${isEn?"Home Designer":"家居设计师"} · homedesigner.app</span>
        <span>${date}</span>
      </div>
    </div>
  </body></html>`;

  printHtml(html);
}

// ─── All-rooms PDF ────────────────────────────────────────────

export interface RoomDetail {
  room: RoomType;
  cost: number;
  materials: MaterialItem[];
  placedItems: PlacedItem[];
  floorIndex?: number;  // which floor this room belongs to
}

export interface AllRoomsExportData {
  roomDetails: RoomDetail[];
  totalCost: number;
  budget: number;
  locale: string;
  phone?: string;
}

export function generateAllRoomsPdf(data: AllRoomsExportData, groupBy: "room" | "material"): void {
  const { roomDetails, totalCost, budget, locale, phone } = data;
  const isEn = locale === "en";
  // Detect if multi-floor: any room has floorIndex > 0
  const isMultiFloor = roomDetails.some(r => (r.floorIndex ?? 0) > 0);
  const date = new Date().toLocaleDateString(isEn ? "en-US" : "zh-CN");
  const configured = roomDetails.filter(r => r.cost > 0);
  const overBudget = totalCost > budget;
  const budgetPct = Math.min(100, (totalCost / budget) * 100);

  const headerHtml = `
    <div class="header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <h1>${isEn ? "Whole House Quote" : "全屋装修报价单"}</h1>
          <div class="meta">${configured.length} ${isEn?"room(s) configured":"个房间已配置"} &nbsp;|&nbsp; ${isEn?"Date":"日期"}: ${date}</div>
          <div class="meta">${isEn?"Contact":"联系人"}: ${phone || (isEn?"N/A":"访客")}</div>
        </div>
        <div style="text-align:right">
          <div class="total">${fmtPrice(totalCost, locale)}</div>
          <div class="total-label">${isEn?"Total Estimate":"全屋合计"}</div>
        </div>
      </div>
    </div>`;

  const budgetHtml = `
    <div class="budget-bar-wrap">
      <div class="budget-meta">
        <span>${isEn?"Budget":"预算"}: ${fmtPrice(budget, locale)}</span>
        <span class="status ${overBudget?"over":"ok"}">${overBudget?(isEn?"OVER BUDGET":"超出预算"):(isEn?"WITHIN BUDGET":"未超预算")}</span>
      </div>
      <div class="bar-bg">
        <div class="bar-fill" style="width:${budgetPct}%;background:${overBudget?"#ff3b30":"#34c759"}"></div>
      </div>
    </div>`;

  // ── By-room view ──
  function renderRoomBlock({ room, cost, materials, placedItems }: RoomDetail): string {
    const area = getRoomArea(room);
    const rn = roomName(room, locale);
    const def = ROOM_DEFS[room];
    const pct = Math.round((cost / totalCost) * 100);

    let rows = "";
    materials.forEach(item => {
      const qty = item.category === "wall" ? area.wall
                : item.category === "floor" ? area.floor
                : item.id === "light-spot" ? 8 : 1;
      const qtyStr = ["wall","floor","tile"].includes(item.category) ? `${qty}㎡`
                   : item.id === "light-spot" ? "×8" : "×1";
      rows += `<tr>
        <td>${catLabel(item.category, locale)}</td>
        <td><span class="swatch" style="background:${item.color}"></span>${matName(item, locale)}</td>
        <td>${brandName(item.brand, locale)}</td>
        <td>${fmtPrice(item.price, locale)}</td>
        <td>${qtyStr}</td>
        <td><b>${fmtPrice(item.price * qty, locale)}</b></td>
      </tr>`;
    });
    placedItems.forEach(p => {
      const f = getFurnitureById(p.furnitureId);
      if (!f) return;
      rows += `<tr>
        <td style="font-size:15px">${f.icon}</td>
        <td>${furnitureName(f.id, f.name, locale)}</td>
        <td>${brandName(f.brand, locale)}</td>
        <td>${fmtPrice(f.price, locale)}</td>
        <td>×1</td>
        <td><b>${fmtPrice(f.price, locale)}</b></td>
      </tr>`;
    });

    return `
      <div class="room-header">
        ${def.icon} ${rn}
        <span style="font-size:11px;font-weight:400;color:#6e6e73;margin-left:8px">${pct}% · ${fmtPrice(cost, locale)}</span>
      </div>
      ${rows ? `<table>
        <thead><tr>
          <th>${isEn?"Cat.":"类别"}</th><th>${isEn?"Item":"材料/家具"}</th>
          <th>${isEn?"Brand":"品牌"}</th><th>${isEn?"Unit":"单价"}</th>
          <th>${isEn?"Qty":"数量"}</th><th>${isEn?"Sub":"小计"}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>` : `<p style="font-size:11px;color:#aeaeb2;padding:4px 10px">${isEn?"(no items yet)":"（暂无配置）"}</p>`}`;
  }

  let byRoomHtml = "";
  if (isMultiFloor) {
    // Group by floor, add floor section headers
    const floorGroups = new Map<number, RoomDetail[]>();
    configured.forEach(rd => {
      const fi = rd.floorIndex ?? 0;
      if (!floorGroups.has(fi)) floorGroups.set(fi, []);
      floorGroups.get(fi)!.push(rd);
    });
    [...floorGroups.entries()].sort(([a],[b]) => a - b).forEach(([fi, rooms]) => {
      const floorLabel = isEn ? `Floor ${fi + 1}` : `第 ${fi + 1} 层`;
      const floorCost = rooms.reduce((s, r) => s + r.cost, 0);
      byRoomHtml += `
        <div style="margin:24px 0 8px;padding:10px 14px;background:linear-gradient(90deg,#007AFF18,transparent);
          border-left:4px solid #007AFF;border-radius:0 8px 8px 0;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:15px;font-weight:900;color:#007AFF">${floorLabel}</span>
          <span style="font-size:12px;font-weight:700;color:#5856D6">${fmtPrice(floorCost, locale)}</span>
        </div>
        ${rooms.sort((a,b) => b.cost - a.cost).map(renderRoomBlock).join("")}`;
    });
  } else {
    byRoomHtml = configured.sort((a,b) => b.cost - a.cost).map(renderRoomBlock).join("");
  }

  // ── By-material view (采购清单) ──
  // Aggregate same material across rooms
  const matMap = new Map<string, { item: MaterialItem; rooms: Array<{name:string;qty:number;sub:number}> }>();
  const furMap = new Map<string, { f: ReturnType<typeof getFurnitureById>; count: number; rooms: string[] }>();

  configured.forEach(({ room, materials, placedItems }) => {
    const area = getRoomArea(room);
    const rn = roomName(room, locale);
    Object.values(materials).filter(Boolean).forEach(item => {
      if (!item) return;
      const qty = item.category === "wall" ? area.wall
                : item.category === "floor" ? area.floor
                : item.id === "light-spot" ? 8 : 1;
      if (!matMap.has(item.id)) matMap.set(item.id, { item, rooms: [] });
      matMap.get(item.id)!.rooms.push({ name: rn, qty, sub: item.price * qty });
    });
    placedItems.forEach(p => {
      const f = getFurnitureById(p.furnitureId);
      if (!f) return;
      if (!furMap.has(f.id)) furMap.set(f.id, { f, count: 0, rooms: [] });
      const entry = furMap.get(f.id)!;
      entry.count++;
      if (!entry.rooms.includes(rn)) entry.rooms.push(rn);
    });
  });

  let byMatHtml = "";
  // Group by category
  const catOrder = ["floor","wall","tile","ceiling","light"] as const;
  catOrder.forEach(cat => {
    const items = [...matMap.values()].filter(e => e.item.category === cat);
    if (!items.length) return;
    byMatHtml += `<div class="section-title">${catLabel(cat, locale)}</div><table>
      <thead><tr>
        <th>${isEn?"Material":"材料"}</th><th>${isEn?"Brand":"品牌"}</th>
        <th>${isEn?"Rooms":"房间"}</th><th>${isEn?"Total Qty":"合计用量"}</th>
        <th>${isEn?"Unit":"单价"}</th><th>${isEn?"Subtotal":"小计"}</th>
      </tr></thead><tbody>`;
    items.forEach(({ item, rooms }) => {
      const totalQty = rooms.reduce((s,r)=>s+r.qty,0);
      const totalSub = rooms.reduce((s,r)=>s+r.sub,0);
      const qtyStr = ["wall","floor","tile"].includes(item.category) ? `${totalQty.toFixed(1)}㎡`
                   : item.id === "light-spot" ? "×8" : "×1";
      const roomList = rooms.map(r => `${r.name}(${r.qty.toFixed(0)}㎡)`).join("、");
      byMatHtml += `<tr>
        <td><span class="swatch" style="background:${item.color}"></span>${matName(item, locale)}</td>
        <td>${brandName(item.brand, locale)}</td>
        <td style="font-size:10px;color:#6e6e73">${roomList}</td>
        <td>${qtyStr}</td>
        <td>${fmtPrice(item.price, locale)}</td>
        <td><b>${fmtPrice(totalSub, locale)}</b></td>
      </tr>`;
    });
    byMatHtml += `</tbody></table>`;
  });

  // Furniture section
  if (furMap.size > 0) {
    byMatHtml += `<div class="section-title">${isEn?"Furniture":"家具汇总"}</div><table>
      <thead><tr>
        <th></th><th>${isEn?"Item":"品名"}</th><th>${isEn?"Brand":"品牌"}</th>
        <th>${isEn?"Rooms":"房间"}</th><th>${isEn?"Qty":"数量"}</th><th>${isEn?"Total":"合计"}</th>
      </tr></thead><tbody>`;
    [...furMap.values()].forEach(({ f, count, rooms }) => {
      if (!f) return;
      byMatHtml += `<tr>
        <td style="font-size:15px">${f.icon}</td>
        <td>${furnitureName(f.id, f.name, locale)}</td>
        <td>${brandName(f.brand, locale)}</td>
        <td style="font-size:10px;color:#6e6e73">${rooms.join("、")}</td>
        <td>×${count}</td>
        <td><b>${fmtPrice(f.price * count, locale)}</b></td>
      </tr>`;
    });
    byMatHtml += `</tbody></table>`;
  }

  const html = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${isEn?"Whole House Quote":"全屋报价单"}</title>
    <style>
      ${BASE_CSS}
      .view { display:none }
      .view.active { display:block }
    </style>
  </head><body>
    <!-- Toggle & print buttons (hidden when printing) -->
    <div class="no-print" style="display:flex;gap:8px;padding:12px 28px;background:#f5f5f7;align-items:center">
      <div class="tab-toggle">
        <button id="btn-room" class="active" onclick="showView('room')">
          ${isEn?"By Room":"按房间"}
        </button>
        <button id="btn-mat" onclick="showView('mat')">
          ${isEn?"By Material (Shopping List)":"按材料（采购清单）"}
        </button>
      </div>
      <button class="print-btn" style="margin:0" onclick="window.print()">
        📄 ${isEn?"Save as PDF":"保存为 PDF"}
      </button>
    </div>

    ${headerHtml}
    <div class="body">
      ${budgetHtml}

      <!-- By-room view -->
      <div id="view-room" class="view active">
        ${byRoomHtml}
      </div>

      <!-- By-material view -->
      <div id="view-mat" class="view">
        ${byMatHtml}
      </div>

      <div class="total-row">
        <span class="label">${isEn?"Grand Total":"全屋合计"}</span>
        <span class="amount">${fmtPrice(totalCost, locale)}</span>
      </div>
      <div class="notes">
        <p>* ${isEn?"This quote covers materials and furniture only. Labor costs are estimated at 30–50% of materials."
                  :"本报价仅包含材料及家具费用，人工费约为材料费的30–50%。"}</p>
        <p>* ${isEn?"Prices may vary by region and supplier."
                  :"实际价格因地区和供应商不同而异，最终以施工方报价为准。"}</p>
      </div>
      <div class="footer">
        <span>${isEn?"Home Designer":"家居设计师"} · homedesigner.app</span>
        <span>${date}</span>
      </div>
    </div>

    <script>
      function showView(v) {
        document.getElementById('view-room').className = 'view' + (v==='room'?' active':'');
        document.getElementById('view-mat').className  = 'view' + (v==='mat' ?' active':'');
        document.getElementById('btn-room').className = v==='room'?'active':'';
        document.getElementById('btn-mat').className  = v==='mat' ?'active':'';
      }
    </script>
  </body></html>`;

  printHtml(html);
}
