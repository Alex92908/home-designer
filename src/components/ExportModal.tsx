"use client";

import { useEffect, useState, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, getRoomArea, RoomType } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { generatePdf } from "@/lib/exportPdf";

const CATEGORY_LABELS: Record<string, string> = {
  wall: "墙面", floor: "地板", ceiling: "天花", light: "灯具", tile: "地砖",
};

function ScoreBar({ val, color }: { val: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${val}%`, background: color }} />
      </div>
      <span className="text-xs font-bold w-6 text-right" style={{ color }}>{val}</span>
    </div>
  );
}

// ─── Per-room cost row ────────────────────────────────────────
function RoomCostRow({ room, cost }: { room: RoomType; cost: number }) {
  const def = ROOM_DEFS[room];
  const setActiveRoom = useDesignerStore(s => s.setActiveRoom);
  const setViewMode   = useDesignerStore(s => s.setViewMode);
  if (cost === 0) return null;
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
      onClick={() => { setActiveRoom(room); setViewMode("2d"); }}>
      <td className="py-1.5 text-xs font-medium text-gray-800">{def.icon} {def.name}</td>
      <td className="py-1.5 text-right text-xs font-bold text-gray-700">¥{cost.toLocaleString()}</td>
    </tr>
  );
}

export default function ExportModal() {
  const [open, setOpen]           = useState(false);
  const [tab, setTab]             = useState<"current" | "all" | "data">("current");
  const [phone, setPhone]         = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [exporting, setExporting] = useState(false);

  const activeRoom     = useDesignerStore(s => s.activeRoom);
  const rooms          = useDesignerStore(s => s.rooms);
  const enabledRooms   = useDesignerStore(s => s.enabledRooms);
  const scores         = useDesignerStore(s => s.scores);
  const exterior       = useDesignerStore(s => s.exterior);
  const budget         = useDesignerStore(s => s.budget);
  const resetAll       = useDesignerStore(s => s.resetAll);

  const roomState  = rooms[activeRoom];
  const def        = ROOM_DEFS[activeRoom];
  const area       = getRoomArea(activeRoom);
  const { materials, placedItems } = roomState;
  const materialItems = Object.values(materials).filter(Boolean) as NonNullable<typeof materials.wall>[];

  // All-rooms cost
  const roomCosts = enabledRooms.map(r => {
    const rs = rooms[r];
    const a  = getRoomArea(r);
    let c = 0;
    if (rs.materials.wall)    c += rs.materials.wall.price * a.wall;
    if (rs.materials.floor)   c += rs.materials.floor.price * a.floor;
    if (rs.materials.ceiling) c += rs.materials.ceiling.price * a.floor;
    if (rs.materials.tile)    c += rs.materials.tile.price * a.floor;
    if (rs.materials.light)   c += rs.materials.light.price * (rs.materials.light.id === "light-spot" ? 8 : 1);
    for (const p of rs.placedItems) { const f = getFurnitureById(p.furnitureId); if (f) c += f.price; }
    return { room: r, cost: c };
  });
  const totalAllCost = roomCosts.reduce((s, r) => s + r.cost, 0);
  const currentRoomCost = roomCosts.find(r => r.room === activeRoom)?.cost ?? 0;

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("openExport", handler);
    return () => window.removeEventListener("openExport", handler);
  }, []);

  if (!open) return null;

  const close = () => { setOpen(false); setSubmitted(false); setPhone(""); };

  const handleExportPdf = async () => {
    if (!phone || phone.length < 11) return;
    setExporting(true);
    await new Promise(r => setTimeout(r, 300));
    generatePdf({ room: activeRoom, items: materialItems, totalCost: currentRoomCost, scores, phone });
    setSubmitted(true);
    setExporting(false);
  };

  const handleQuickView = () => {
    generatePdf({ room: activeRoom, items: materialItems, totalCost: currentRoomCost, scores, phone: "访客" });
  };

  // ─── Save/load JSON ───────────────────────────────────────
  const handleSaveJson = () => {
    const data = {
      rooms,
      enabledRooms,
      exterior,
      budget,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `装修方案_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadJson = () => {
    const input = document.createElement("input");
    input.type  = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          // Minimal validation
          if (data.rooms && data.enabledRooms) {
            // Use the store's setExterior / resetAll approach by patching the persisted store key
            localStorage.setItem("home-designer-v1", JSON.stringify({ state: data, version: 0 }));
            window.location.reload();
          } else {
            alert("文件格式不正确");
          }
        } catch {
          alert("无法解析文件");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const hasContent = materialItems.length > 0 || placedItems.length > 0;
  const totalRooms = roomCosts.filter(r => r.cost > 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-500 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xl font-black">📄 装修方案</div>
              <div className="text-sm text-blue-100 mt-0.5">
                {totalRooms > 0 ? `已配置 ${totalRooms} 个房间` : "尚未配置"} · {new Date().toLocaleDateString("zh-CN")}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black">¥{totalAllCost.toLocaleString()}</div>
              <div className="text-xs text-blue-200">全屋合计</div>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {([["current","当前房间"],["all","全屋汇总"],["data","数据管理"]] as const).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  tab === t ? "bg-white text-blue-700" : "text-blue-100 hover:bg-white/20"
                }`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">

          {/* ── Current room tab ── */}
          {tab === "current" && (
            <>
              {!hasContent ? (
                <div className="text-center text-gray-400 py-8">当前房间尚未配置材料或家具</div>
              ) : (
                <>
                  {/* Scores */}
                  {scores.dominantStyle && (
                    <div className="bg-blue-50 rounded-xl p-3 mb-4 border border-blue-100">
                      <div className="text-xs font-bold text-blue-700 mb-2">主风格：{scores.dominantStyle}</div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label:"风格协调", val:scores.style, color:"#3B82F6" },
                          { label:"空间感",   val:scores.space,  color:"#10B981" },
                          { label:"采光",     val:scores.light,  color:"#F59E0B" },
                        ].map(({ label, val, color }) => (
                          <div key={label}>
                            <div className="text-[10px] text-gray-500 mb-1">{label}</div>
                            <ScoreBar val={val} color={color} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Materials */}
                  {materialItems.length > 0 && (
                    <table className="w-full text-sm mb-4">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">品类</th>
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">材料</th>
                          <th className="text-right pb-2 text-xs text-gray-400 font-medium">数量</th>
                          <th className="text-right pb-2 text-xs text-gray-400 font-medium">小计</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialItems.map(item => {
                          const qty = item.category === "wall" ? area.wall
                                    : item.category === "floor" ? area.floor
                                    : item.id === "light-spot" ? 8 : 1;
                          const qtyStr = ["wall","floor","tile"].includes(item.category) ? `${qty}㎡`
                                       : item.id === "light-spot" ? "×8" : "×1";
                          return (
                            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2.5 text-xs text-gray-400">{CATEGORY_LABELS[item.category] ?? item.category}</td>
                              <td className="py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded shrink-0 border border-gray-200"
                                    style={{ background: item.texture ?? item.color }} />
                                  <div className="text-xs font-medium text-gray-800">{item.name}</div>
                                </div>
                              </td>
                              <td className="py-2.5 text-right text-xs text-gray-500">{qtyStr}</td>
                              <td className="py-2.5 text-right text-xs font-bold text-gray-800">
                                ¥{(item.price * qty).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {/* Furniture */}
                  {placedItems.length > 0 && (
                    <table className="w-full text-sm mb-4">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">家具</th>
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">品牌</th>
                          <th className="text-right pb-2 text-xs text-gray-400 font-medium">×1件</th>
                        </tr>
                      </thead>
                      <tbody>
                        {placedItems.map(placed => {
                          const f = getFurnitureById(placed.furnitureId);
                          if (!f) return null;
                          return (
                            <tr key={placed.instanceId} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 text-xs font-medium text-gray-800">{f.icon} {f.name}</td>
                              <td className="py-2 text-xs text-gray-400">{f.brand}</td>
                              <td className="py-2 text-right text-xs font-bold text-gray-800">¥{f.price.toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  <div className="flex justify-between items-center py-2 border-t border-gray-200 mb-4">
                    <span className="text-sm font-bold text-gray-700">{def.name}合计</span>
                    <span className="text-xl font-black text-blue-600">¥{currentRoomCost.toLocaleString()}</span>
                  </div>

                  {/* Lead capture */}
                  {!submitted ? (
                    <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-4">
                      <div className="text-sm font-semibold text-gray-800 mb-1">📥 导出当前房间 PDF</div>
                      <div className="text-xs text-gray-500 mb-3">留下手机号免费下载含工费的完整报价单</div>
                      <div className="flex gap-2">
                        <input type="tel" value={phone}
                          onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                          placeholder="请输入手机号"
                          className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white" />
                        <button onClick={handleExportPdf}
                          disabled={phone.length < 11 || exporting}
                          className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                          {exporting ? "生成中..." : "下载 PDF"}
                        </button>
                      </div>
                      <button onClick={handleQuickView} className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline">
                        不留号码直接下载
                      </button>
                    </div>
                  ) : (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                      <div className="text-green-700 font-bold mb-1">✅ PDF 已下载！</div>
                      <div className="text-sm text-green-600">顾问将在24小时内联系 {phone}</div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── All rooms tab ── */}
          {tab === "all" && (
            <>
              <div className="mb-3 text-xs text-gray-500">点击房间行可切换至该房间编辑</div>
              {/* Budget vs cost bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">全屋预算 ¥{budget.toLocaleString()}</span>
                  <span className={totalAllCost > budget ? "text-red-500 font-bold" : "text-green-600 font-bold"}>
                    {totalAllCost > budget ? "超出预算" : "未超预算"}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${totalAllCost > budget ? "bg-red-500" : "bg-green-500"}`}
                    style={{ width: `${Math.min(100, (totalAllCost / budget) * 100)}%` }} />
                </div>
              </div>

              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left pb-2 text-xs text-gray-400 font-medium">房间</th>
                    <th className="text-right pb-2 text-xs text-gray-400 font-medium">费用</th>
                  </tr>
                </thead>
                <tbody>
                  {roomCosts.map(r => <RoomCostRow key={r.room} room={r.room} cost={r.cost} />)}
                </tbody>
              </table>

              {totalRooms === 0 && (
                <div className="text-center text-gray-400 py-6">尚未配置任何房间</div>
              )}

              <div className="flex justify-between items-center py-2 border-t border-gray-200">
                <span className="text-sm font-bold text-gray-700">全屋合计</span>
                <span className="text-xl font-black text-blue-600">¥{totalAllCost.toLocaleString()}</span>
              </div>

              {/* Exterior summary */}
              <div className="mt-3 bg-gray-50 rounded-xl px-3 py-2 flex items-center gap-3">
                <span className="text-sm">🏠</span>
                <div>
                  <div className="text-xs font-semibold text-gray-700">外观方案</div>
                  <div className="text-[10px] text-gray-400">
                    {exterior.preset === "custom" ? "自定义" : exterior.preset} · {exterior.floors}层 · {exterior.roofStyle}屋顶
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Data management tab ── */}
          {tab === "data" && (
            <div className="flex flex-col gap-3">
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <div className="text-sm font-bold text-gray-800 mb-1">💾 保存方案</div>
                <div className="text-xs text-gray-500 mb-3">将全屋配置导出为 JSON 文件，可随时重新载入</div>
                <button onClick={handleSaveJson}
                  className="w-full py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors">
                  📥 下载 JSON 方案文件
                </button>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="text-sm font-bold text-gray-800 mb-1">📂 载入方案</div>
                <div className="text-xs text-gray-500 mb-3">从之前保存的 JSON 文件恢复全屋配置（将覆盖当前方案）</div>
                <button onClick={handleLoadJson}
                  className="w-full py-2.5 bg-gray-700 text-white text-sm font-bold rounded-xl hover:bg-gray-800 transition-colors">
                  📤 选择文件载入
                </button>
              </div>

              <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
                <div className="text-sm font-bold text-gray-800 mb-1">🔄 自动保存</div>
                <div className="text-xs text-gray-500 mb-2">所有修改已自动保存到浏览器本地存储，关闭后重新打开仍可恢复</div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-green-700 font-semibold">已自动保存</span>
                </div>
              </div>

              <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                <div className="text-sm font-bold text-gray-800 mb-1">⚠️ 重置方案</div>
                <div className="text-xs text-gray-500 mb-3">清空所有房间配置，恢复到初始状态（不可撤销）</div>
                <button onClick={() => {
                  if (window.confirm("确定要清空全部配置吗？此操作不可撤销。")) {
                    resetAll();
                    close();
                  }
                }}
                  className="w-full py-2.5 bg-red-500 text-white text-sm font-bold rounded-xl hover:bg-red-600 transition-colors">
                  🗑️ 清空全部配置
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-4 border-t border-gray-100 pt-3 flex justify-end">
          <button onClick={close} className="text-sm text-gray-400 hover:text-gray-600">关闭</button>
        </div>
      </div>
    </div>
  );
}
