import { jsPDF } from "jspdf";
import { MaterialItem } from "./types";
import { RoomType, getRoomArea, ROOM_DEFS } from "./types";

export interface ExportData {
  room: RoomType;
  items: MaterialItem[];
  totalCost: number;
  scores: { style: number; space: number; light: number; dominantStyle: string };
  phone: string;
}

export function generatePdf(data: ExportData): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const area = getRoomArea(data.room);
  const roomName = ROOM_DEFS[data.room].name;
  const date = new Date().toLocaleDateString("zh-CN");

  // 颜色常量
  const BLUE = [37, 99, 235] as const;
  const DARK = [17, 24, 39] as const;
  const GRAY = [107, 114, 128] as const;
  const LIGHT = [243, 244, 246] as const;
  const WHITE = [255, 255, 255] as const;

  const pageW = 210;
  const pageH = 297;
  const margin = 16;

  // ── 顶部色块 ──
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, pageW, 40, "F");

  // 标题
  doc.setTextColor(...WHITE);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Decoration Quote", margin, 16);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Room: ${roomName}  |  Date: ${date}`, margin, 24);
  doc.text(`Contact: ${data.phone || "N/A"}`, margin, 31);

  // 右上角总价
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  const totalStr = `CNY ${data.totalCost.toLocaleString()}`;
  doc.text(totalStr, pageW - margin, 20, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Total Estimate", pageW - margin, 28, { align: "right" });

  let y = 52;

  // ── 评分区 ──
  if (data.scores.dominantStyle) {
    doc.setFillColor(...LIGHT);
    doc.roundedRect(margin, y - 4, pageW - margin * 2, 28, 3, 3, "F");

    doc.setTextColor(...DARK);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Style: ${data.scores.dominantStyle}`, margin + 6, y + 4);

    const scores = [
      { label: "Harmony", val: data.scores.style },
      { label: "Space", val: data.scores.space },
      { label: "Lighting", val: data.scores.light },
    ];
    const barW = 40;
    const startX = margin + 55;
    scores.forEach((s, i) => {
      const bx = startX + i * 52;
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRAY);
      doc.text(s.label, bx, y + 1);
      // bar bg
      doc.setFillColor(209, 213, 219);
      doc.roundedRect(bx, y + 3, barW, 3, 1, 1, "F");
      // bar fill
      doc.setFillColor(...BLUE);
      doc.roundedRect(bx, y + 3, (barW * s.val) / 100, 3, 1, 1, "F");
      doc.setTextColor(...DARK);
      doc.setFontSize(9);
      doc.text(`${s.val}`, bx + barW + 2, y + 6);
    });
    y += 34;
  }

  // ── 材料明细表头 ──
  doc.setFillColor(...BLUE);
  doc.rect(margin, y, pageW - margin * 2, 8, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Item", margin + 3, y + 5.5);
  doc.text("Brand", margin + 70, y + 5.5);
  doc.text("Unit Price", margin + 105, y + 5.5);
  doc.text("Qty", margin + 135, y + 5.5);
  doc.text("Subtotal", pageW - margin - 3, y + 5.5, { align: "right" });
  y += 8;

  // ── 材料明细行 ──
  data.items.forEach((item, idx) => {
    const qty = item.category === "wall"
      ? area.wall
      : item.category === "floor"
      ? area.floor
      : item.id === "light-spot"
      ? 8
      : 1;
    const qtyStr = item.unit.includes("㎡") ? `${qty}㎡` : item.id === "light-spot" ? "×8" : "×1";
    const subtotal = item.price * qty;

    // 斑马条纹
    if (idx % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, y, pageW - margin * 2, 9, "F");
    }

    // 色块
    try {
      const hex = item.color.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      doc.setFillColor(r, g, b);
    } catch {
      doc.setFillColor(200, 200, 200);
    }
    doc.roundedRect(margin + 3, y + 2, 5, 5, 1, 1, "F");

    doc.setTextColor(...DARK);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(item.name, margin + 11, y + 6);
    doc.setTextColor(...GRAY);
    doc.text(item.brand, margin + 70, y + 6);
    doc.setTextColor(...DARK);
    doc.text(`¥${item.price.toLocaleString()}`, margin + 105, y + 6);
    doc.text(qtyStr, margin + 135, y + 6);
    doc.setFont("helvetica", "bold");
    doc.text(`¥${subtotal.toLocaleString()}`, pageW - margin - 3, y + 6, { align: "right" });
    y += 9;
  });

  // ── 合计行 ──
  y += 3;
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 5;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  doc.text("Total:", pageW - margin - 35, y);
  doc.setTextColor(...BLUE);
  doc.text(`¥${data.totalCost.toLocaleString()}`, pageW - margin - 3, y, { align: "right" });

  y += 14;

  // ── 备注 ──
  doc.setFillColor(...LIGHT);
  doc.roundedRect(margin, y, pageW - margin * 2, 28, 3, 3, "F");
  doc.setTextColor(...GRAY);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  const notes = [
    "* This quote covers materials only. Labor costs are estimated at 30-50% of materials.",
    "* Prices may vary by region and supplier. Final quote to be confirmed with contractor.",
    "* This document is generated by 装修配置器 for reference purposes only.",
  ];
  notes.forEach((note, i) => {
    doc.text(note, margin + 4, y + 6 + i * 7);
  });

  // ── 底部 ──
  doc.setFillColor(...BLUE);
  doc.rect(0, pageH - 14, pageW, 14, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(8);
  doc.text("装修配置器  |  Like building a PC, design your home", margin, pageH - 6);
  doc.text(date, pageW - margin, pageH - 6, { align: "right" });

  doc.save(`装修报价单_${roomName}_${date.replace(/\//g, "-")}.pdf`);
}
