"use client";

import { useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { MATERIALS } from "@/lib/data";
import { FURNITURE, getFurnitureForRoom, FURNITURE_CATEGORIES, getCustomFurniture } from "@/lib/furniture";
import { MaterialItem, FurnitureItem } from "@/lib/types";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn, getBrandNameEn } from "@/locales/itemNames";
import { formatUnitPrice, formatPrice } from "@/lib/currency";

// ─── Material card ─────────────────────────────────────────
function MatCard({ item }: { item: MaterialItem }) {
  const setMaterial = useDesignerStore((s) => s.setMaterial);
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.rooms[activeRoom].materials);
  const isSelected = roomMaterials[item.category]?.id === item.id;
  const locale = useLocale();
  const displayName = locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name;
  const displayBrand = locale === "en" ? getBrandNameEn(item.brand) : item.brand;

  return (
    <button
      onClick={() => setMaterial(item)}
      className="relative flex flex-col gap-1 p-2 rounded-xl text-left transition-all duration-200 hover:scale-[1.02]"
      style={
        isSelected
          ? {
              border: "2px solid #007AFF",
              background: "#E8F1FF",
              boxShadow: "0 0 0 3px rgba(0,122,255,0.12)",
            }
          : {
              border: "2px solid transparent",
              background: "var(--ds-surface)",
              boxShadow: "var(--ds-shadow-sm)",
            }
      }
    >
      <div
        className="w-full h-9 rounded-lg"
        style={{ background: item.texture ?? item.color }}
      />
      <span className="text-[11px] font-semibold leading-tight line-clamp-1" style={{ color: "var(--ds-text)" }}>
        {displayName}
      </span>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px]" style={{ color: "var(--ds-text-3)" }}>{displayBrand}</span>
        <span className="text-[9px] font-bold" style={{ color: "#007AFF" }}>
          {formatUnitPrice(item.price, locale)}{item.unit.includes("㎡") ? "/㎡" : ""}
        </span>
      </div>
      {isSelected && (
        <div
          className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: "#007AFF" }}
        >
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
  const displayBrand = locale === "en" ? getBrandNameEn(item.brand) : item.brand;

  return (
    <button
      onClick={() => placeFurniture(item.id)}
      className="relative flex flex-col gap-1 p-2 rounded-xl text-left transition-all duration-200 hover:scale-[1.02]"
      style={
        isPlaced
          ? {
              border: "2px solid #059669",
              background: "var(--ds-success-soft)",
              boxShadow: "0 0 0 3px rgba(5,150,105,0.1)",
            }
          : {
              border: "2px solid transparent",
              background: "var(--ds-surface)",
              boxShadow: "var(--ds-shadow-sm)",
            }
      }
      title={displayName}
    >
      <div
        className="w-full h-9 rounded-lg flex items-center justify-center text-lg"
        style={{ background: item.color }}
      >
        <span style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.3))" }}>{item.icon}</span>
      </div>
      <span className="text-[11px] font-semibold leading-tight line-clamp-1" style={{ color: "var(--ds-text)" }}>
        {displayName}
      </span>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px]" style={{ color: "var(--ds-text-3)" }}>{displayBrand}</span>
        <span className="text-[9px] font-bold" style={{ color: "#007AFF" }}>
          {formatPrice(item.price, locale)}
        </span>
      </div>
      <div className="text-[9px]" style={{ color: "var(--ds-text-3)" }}>{item.width}×{item.depth}cm</div>
      {isPlaced && (
        <div
          className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: "var(--ds-success)" }}
        >
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
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--ds-text-3)" }}>
                {icon} {t.materialSections[key]}
              </span>
              {selected && (
                <button
                  onClick={() => removeMaterial(category)}
                  className="text-[9px] transition-colors"
                  style={{ color: "var(--ds-text-3)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--ds-danger)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--ds-text-3)")}
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
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{ background: "#E8F1FF", border: "1px solid #CCE4FF" }}
    >
      <div className="text-[11px] font-bold" style={{ color: "#0055B3" }}>{t.customForm.title}</div>
      <input
        value={name} onChange={e => setName(e.target.value)}
        placeholder={t.customForm.namePlaceholder}
        className="rounded-lg px-2 py-1.5 text-xs outline-none bg-white"
        style={{ border: "1px solid var(--ds-border)" }}
      />
      <div className="flex gap-2">
        {[
          { label: t.customForm.widthLabel, val: width, set: setWidth },
          { label: t.customForm.depthLabel, val: depth, set: setDepth },
          { label: t.customForm.priceLabel, val: price, set: setPrice },
        ].map(({ label, val, set }) => (
          <div key={label} className="flex flex-col gap-0.5 flex-1">
            <label className="text-[9px]" style={{ color: "var(--ds-text-3)" }}>{label}</label>
            <input type="number" min={0} max={600} value={val} onChange={e => set(+e.target.value)}
              className="rounded-lg px-2 py-1 text-xs outline-none bg-white"
              style={{ border: "1px solid var(--ds-border)" }} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[9px] shrink-0" style={{ color: "var(--ds-text-3)" }}>{t.customForm.colorLabel}</label>
        <input type="color" value={color} onChange={e => setColor(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer shrink-0"
          style={{ border: "1px solid var(--ds-border)" }} />
        <div className="flex flex-wrap gap-1">
          {QUICK_ICONS.map(ic => (
            <button key={ic} onClick={() => setIcon(ic)}
              className="text-sm rounded p-0.5 transition-colors"
              style={{ background: icon === ic ? "#DDD6FE" : "transparent" }}>
              {ic}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleAdd} className="ds-btn-primary flex-1 py-1.5 disabled:opacity-40" disabled={!name.trim()}>
          {t.customForm.addBtn}
        </button>
        <button onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-xl transition-colors"
          style={{ border: "1px solid var(--ds-border)", color: "var(--ds-text-2)" }}>
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
        <button
          onClick={() => setAllRooms(v => !v)}
          className="flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all"
          style={
            allRooms
              ? { background: "#007AFF", color: "#fff", border: "1px solid #007AFF" }
              : { background: "var(--ds-surface)", color: "var(--ds-text-2)", border: "1px solid var(--ds-border)" }
          }
        >
          {allRooms ? t.allCategories : t.thisRoom}
        </button>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all"
            style={{ border: "1px dashed var(--ds-border)", color: "var(--ds-text-3)", background: "transparent" }}
          >
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
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5 px-0.5" style={{ color: "var(--ds-text-3)" }}>
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
    <aside
      className="w-64 shrink-0 h-full flex flex-col overflow-hidden"
      style={{ background: "var(--ds-bg)", borderRight: "1px solid var(--ds-border)" }}
    >
      {/* Tab switcher */}
      <div
        className="px-3 pt-3 pb-0 flex gap-0.5 shrink-0"
        style={{ borderBottom: "1px solid var(--ds-border)" }}
      >
        {(["materials", "furniture"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex-1 py-1.5 text-xs font-bold rounded-t-lg transition-all"
            style={
              tab === key
                ? {
                    background: "var(--ds-surface)",
                    color: "#007AFF",
                    borderBottom: "2px solid #007AFF",
                    marginBottom: "-1px",
                  }
                : { color: "var(--ds-text-3)" }
            }
          >
            {key === "materials" ? t.tabMaterials : t.tabFurniture}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "materials" ? <MaterialsTab /> : <FurnitureTab />}
      </div>

      {/* Hint */}
      <div
        className="px-3 py-2 text-[10px] shrink-0"
        style={{ borderTop: "1px solid var(--ds-border-soft)", color: "var(--ds-text-3)" }}
      >
        {tab === "furniture" ? t.furnitureHint : t.matHint}
      </div>
    </aside>
  );
}
