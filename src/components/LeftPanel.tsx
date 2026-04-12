"use client";

import { useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { MATERIALS } from "@/lib/data";
import { FURNITURE, getFurnitureForRoom, FURNITURE_CATEGORIES, getCustomFurniture } from "@/lib/furniture";
import { MaterialItem, FurnitureItem } from "@/lib/types";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn } from "@/locales/itemNames";

// ─── Material card ─────────────────────────────────────────
function MatCard({ item }: { item: MaterialItem }) {
  const setMaterial = useDesignerStore((s) => s.setMaterial);
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.rooms[activeRoom].materials);
  const isSelected = roomMaterials[item.category]?.id === item.id;
  const locale = useLocale();
  const displayName = locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name;

  return (
    <button
      onClick={() => setMaterial(item)}
      className={`
        relative flex flex-col gap-1 p-2 rounded-xl border-2 text-left
        transition-all duration-200 hover:scale-[1.03] hover:shadow-md
        ${isSelected
          ? "border-blue-500 bg-blue-50 shadow-blue-200 shadow-md"
          : "border-transparent bg-white/70 hover:border-gray-200"
        }
      `}
    >
      <div
        className="w-full h-9 rounded-lg"
        style={{ background: item.texture ?? item.color }}
      />
      <span className="text-[11px] font-semibold text-gray-800 leading-tight line-clamp-1">{displayName}</span>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] text-gray-400">{item.brand}</span>
        <span className="text-[9px] font-bold text-blue-600">¥{item.price.toLocaleString()}{item.unit.includes("㎡") ? "/㎡" : ""}</span>
      </div>
      {isSelected && (
        <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
          <span className="text-white text-[8px]">✓</span>
        </div>
      )}
    </button>
  );
}

// ─── Furniture card ────────────────────────────────────────
function FurnitureCard({ item }: { item: typeof FURNITURE[0] }) {
  const placeFurniture = useDesignerStore((s) => s.placeFurniture);
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const placedItems = useDesignerStore((s) => s.rooms[activeRoom].placedItems);
  const isPlaced = placedItems.some((p) => p.furnitureId === item.id);
  const locale = useLocale();
  const displayName = locale === "en" ? (getFurnitureNameEn(item.id) ?? item.name) : item.name;

  return (
    <button
      onClick={() => placeFurniture(item.id)}
      className={`
        relative flex flex-col gap-1 p-2 rounded-xl border-2 text-left
        transition-all duration-200 hover:scale-[1.03] hover:shadow-md
        ${isPlaced
          ? "border-emerald-500 bg-emerald-50 shadow-emerald-100 shadow-sm"
          : "border-transparent bg-white/70 hover:border-gray-200"
        }
      `}
      title={`${displayName}`}
    >
      {/* Color preview with icon */}
      <div
        className="w-full h-9 rounded-lg flex items-center justify-center text-lg"
        style={{ background: item.color }}
      >
        <span style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.3))" }}>{item.icon}</span>
      </div>
      <span className="text-[11px] font-semibold text-gray-800 leading-tight line-clamp-1">{displayName}</span>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] text-gray-400">{item.brand}</span>
        <span className="text-[9px] font-bold text-blue-600">¥{item.price.toLocaleString()}</span>
      </div>
      <div className="text-[9px] text-gray-400">{item.width}×{item.depth}cm</div>
      {isPlaced && (
        <div className="absolute top-1 right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
          <span className="text-white text-[8px]">✓</span>
        </div>
      )}
    </button>
  );
}

// ─── Materials tab content ─────────────────────────────────
const MATERIAL_SECTIONS: Array<{ key: string; icon: string; category: MaterialItem["category"]; rooms?: string[] }> = [
  { key: "wall",  icon: "🪟", category: "wall" },
  { key: "floor", icon: "🟫", category: "floor" },
  { key: "light", icon: "💡", category: "light" },
  { key: "tile",  icon: "🔲", category: "tile",  rooms: ["kitchen", "bathroom"] },
];

function MaterialsTab() {
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.rooms[activeRoom].materials);
  const removeMaterial = useDesignerStore((s) => s.removeMaterial);
  const t = useT();

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {MATERIAL_SECTIONS.map(({ key, icon, category, rooms }) => {
        if (rooms && !rooms.includes(activeRoom)) return null;
        const items = MATERIALS.filter((m) => m.category === category);
        const selected = roomMaterials[category];
        return (
          <div key={category}>
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                {icon} {t.materialSections[key]}
              </span>
              {selected && (
                <button
                  onClick={() => removeMaterial(category)}
                  className="text-[9px] text-gray-400 hover:text-red-400 transition-colors"
                >
                  {t.clear}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((item) => (
                <MatCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Custom furniture form ─────────────────────────────────
const QUICK_ICONS = ["📦","🪑","🛋️","🛏️","🚿","🍳","🖥️","🌿","🖼️","🗄️","💡","🔲"];

function CustomFurnitureForm({ onClose }: { onClose: () => void }) {
  const activeRoom         = useDesignerStore(s => s.activeRoom);
  const addCustomFurniture = useDesignerStore(s => s.addCustomFurniture);
  const placeFurniture     = useDesignerStore(s => s.placeFurniture);
  const t = useT();

  const [name,  setName]  = useState("");
  const [width, setWidth] = useState(80);
  const [depth, setDepth] = useState(60);
  const [price, setPrice] = useState(500);
  const [color, setColor] = useState("#B0AFA8");
  const [icon,  setIcon]  = useState("📦");

  const handleAdd = () => {
    if (!name.trim()) return;
    const item: FurnitureItem = {
      id:           `custom_${Date.now()}`,
      name:         name.trim(),
      brand:        t.customForm.defaultBrand,
      price,
      unit:         "元/件",
      category:     "storage",
      roomTypes:    ["living","master","bedroom","kitchen","bathroom","dining","study","closet","balcony"],
      color,
      width,
      depth,
      height:       80,
      tags:         [],
      description:  t.customForm.defaultDesc,
      icon,
    };
    addCustomFurniture(item);
    placeFurniture(item.id);
    onClose();
  };

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex flex-col gap-2">
      <div className="text-[11px] font-bold text-blue-700">{t.customForm.title}</div>
      <input
        value={name} onChange={e => setName(e.target.value)}
        placeholder={t.customForm.namePlaceholder}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white"
      />
      <div className="flex gap-2">
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[9px] text-gray-400">{t.customForm.widthLabel}</label>
          <input type="number" min={10} max={600} value={width} onChange={e => setWidth(+e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400 bg-white" />
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[9px] text-gray-400">{t.customForm.depthLabel}</label>
          <input type="number" min={10} max={600} value={depth} onChange={e => setDepth(+e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400 bg-white" />
        </div>
        <div className="flex flex-col gap-0.5 flex-1">
          <label className="text-[9px] text-gray-400">{t.customForm.priceLabel}</label>
          <input type="number" min={0} value={price} onChange={e => setPrice(+e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400 bg-white" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[9px] text-gray-400 shrink-0">{t.customForm.colorLabel}</label>
        <input type="color" value={color} onChange={e => setColor(e.target.value)}
          className="w-7 h-7 rounded border border-gray-200 cursor-pointer shrink-0" />
        <div className="flex flex-wrap gap-1">
          {QUICK_ICONS.map(ic => (
            <button key={ic} onClick={() => setIcon(ic)}
              className={`text-sm rounded p-0.5 transition-colors ${icon === ic ? "bg-blue-200" : "hover:bg-gray-200"}`}>
              {ic}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleAdd}
          className="flex-1 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40"
          disabled={!name.trim()}>
          {t.customForm.addBtn}
        </button>
        <button onClick={onClose}
          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-xl">
          {t.customForm.cancelBtn}
        </button>
      </div>
    </div>
  );
}

// ─── Furniture tab content ─────────────────────────────────
function FurnitureTab() {
  const activeRoom      = useDesignerStore((s) => s.activeRoom);
  const customFurniture = useDesignerStore((s) => s.customFurniture);
  const [showForm, setShowForm] = useState(false);
  const [allRooms, setAllRooms] = useState(false);
  const t = useT();

  const roomFurniture = allRooms ? [...FURNITURE, ...getCustomFurniture()] : getFurnitureForRoom(activeRoom);
  // Include any custom furniture (all rooms)
  const allItems = allRooms ? roomFurniture : [...roomFurniture, ...customFurniture];

  // Group by category
  const groups = FURNITURE_CATEGORIES
    .map((cat) => ({
      ...cat,
      items: allItems.filter((f) => f.category === cat.id),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* All-rooms toggle + custom form */}
      <div className="flex gap-2 items-center">
        <button onClick={() => setAllRooms(v => !v)}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-xl border transition-colors ${
            allRooms ? "bg-blue-600 text-white border-blue-600" : "text-gray-500 border-gray-200 hover:border-blue-300"
          }`}>
          {allRooms ? t.allCategories : t.thisRoom}
        </button>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="flex-1 py-1.5 border border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors font-semibold">
            {t.customFurnitureBtn}
          </button>
        )}
      </div>
      {showForm && <CustomFurnitureForm onClose={() => setShowForm(false)} />}

      {groups.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-6">{t.noFurnitureForRoom}</div>
      ) : (
        groups.map(({ id, icon, items }) => (
          <div key={id}>
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 px-0.5">
              {icon} {t.furnitureCats[id] ?? id}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((item) => (
                <FurnitureCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Main LeftPanel ────────────────────────────────────────
export default function LeftPanel() {
  const [tab, setTab] = useState<"materials" | "furniture">("materials");
  const t = useT();

  return (
    <aside className="w-64 shrink-0 h-full bg-gray-50/90 border-r border-gray-200 flex flex-col overflow-hidden">
      {/* Tab switcher */}
      <div className="px-3 pt-3 pb-0 flex gap-1 border-b border-gray-200 shrink-0">
        <button
          onClick={() => setTab("materials")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-t-lg transition-colors ${
            tab === "materials"
              ? "bg-white text-blue-600 border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {t.tabMaterials}
        </button>
        <button
          onClick={() => setTab("furniture")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-t-lg transition-colors ${
            tab === "furniture"
              ? "bg-white text-blue-600 border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {t.tabFurniture}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "materials" ? <MaterialsTab /> : <FurnitureTab />}
      </div>

      {/* Hint */}
      <div className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100 shrink-0">
        {tab === "furniture" ? t.furnitureHint : t.matHint}
      </div>
    </aside>
  );
}
