"use client";

import { useState } from "react";
import { useDesignerStore } from "@/lib/store";
import TemplatesPanel from "./TemplatesPanel";
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
  const roomMaterials = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom].materials);
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
  const placedItems = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom].placedItems);
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
  { key: "floor", icon: "🟫", category: "floor" },
  { key: "ceiling", icon: "🔳", category: "ceiling" },
  { key: "light", icon: "💡", category: "light" },
  { key: "tile",  icon: "🔲", category: "tile",  rooms: ["kitchen", "bathroom"] },
];

/** Target for the next wall material click. Controls which field in
 *  RoomMaterials gets set when user picks a wall material: "all" writes
 *  to the default `wall`; the 4 sides write to wallBack/Front/Left/Right;
 *  "lower" writes to wallLower (wainscot). */
type WallTarget = "all" | "back" | "front" | "left" | "right" | "lower";

/** Card variant for walls: dispatches to the right store action based on
 *  the currently-selected wall target. */
function WallMatCard({ item, target }: { item: MaterialItem; target: WallTarget }) {
  const setMaterial = useDesignerStore((s) => s.setMaterial);
  const setWallSide = useDesignerStore((s) => s.setWallSide);
  const setWallLower = useDesignerStore((s) => s.setWallLower);
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom].materials);
  const locale = useLocale();
  const displayName = locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name;
  const displayBrand = locale === "en" ? getBrandNameEn(item.brand) : item.brand;

  // Check if this material is the active selection for the current target.
  const activeField = target === "all"   ? roomMaterials.wall
                    : target === "back"  ? roomMaterials.wallBack
                    : target === "front" ? roomMaterials.wallFront
                    : target === "left"  ? roomMaterials.wallLeft
                    : target === "right" ? roomMaterials.wallRight
                    :                      roomMaterials.wallLower;
  const isSelected = activeField?.id === item.id;

  const handleClick = () => {
    if (target === "all") setMaterial(item);
    else if (target === "lower") setWallLower(item);
    else setWallSide(target, item);
  };

  return (
    <button
      onClick={handleClick}
      className="relative flex flex-col gap-1 p-2 rounded-xl text-left transition-all duration-200 hover:scale-[1.02]"
      style={
        isSelected
          ? { border: "2px solid #007AFF", background: "#E8F1FF", boxShadow: "0 0 0 3px rgba(0,122,255,0.12)" }
          : { border: "2px solid transparent", background: "var(--ds-surface)", boxShadow: "var(--ds-shadow-sm)" }
      }
    >
      <div className="w-full h-9 rounded-lg" style={{ background: item.texture ?? item.color }} />
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
        <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: "#007AFF" }}>
          <span className="text-white text-[8px]">✓</span>
        </div>
      )}
    </button>
  );
}

/** Wall section with per-side + wainscot support. */
function WallSection() {
  const activeRoom     = useDesignerStore((s) => s.activeRoom);
  const roomMaterials  = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom].materials);
  const removeMaterial = useDesignerStore((s) => s.removeMaterial);
  const setWallSide    = useDesignerStore((s) => s.setWallSide);
  const setWallLower   = useDesignerStore((s) => s.setWallLower);
  const setWallSplitHeight = useDesignerStore((s) => s.setWallSplitHeight);
  const [target, setTarget] = useState<WallTarget>("all");
  const t = useT();

  const wallItems = MATERIALS.filter(m => m.category === "wall");
  const splitH = roomMaterials.wallSplitHeight ?? 110;

  const TARGETS: Array<{ key: WallTarget; label: string; hint: string }> = [
    { key: "all",   ...t.wallTargets.all },
    { key: "back",  ...t.wallTargets.back },
    { key: "front", ...t.wallTargets.front },
    { key: "left",  ...t.wallTargets.left },
    { key: "right", ...t.wallTargets.right },
    { key: "lower", ...t.wallTargets.lower },
  ];

  const clearForTarget = () => {
    if (target === "all") removeMaterial("wall");
    else if (target === "lower") setWallLower(undefined);
    else setWallSide(target, undefined);
  };
  const currentlySet = target === "all" ? roomMaterials.wall
                     : target === "back" ? roomMaterials.wallBack
                     : target === "front" ? roomMaterials.wallFront
                     : target === "left" ? roomMaterials.wallLeft
                     : target === "right" ? roomMaterials.wallRight
                     : roomMaterials.wallLower;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--ds-text-3)" }}>
          {t.wallTargetLabel}
        </span>
        {currentlySet && (
          <button
            onClick={clearForTarget}
            className="text-[9px] transition-colors"
            style={{ color: "var(--ds-text-3)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--ds-danger)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--ds-text-3)")}
          >
            {t.wallClear}
          </button>
        )}
      </div>

      {/* Target selector — decides where the next material click goes */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        {TARGETS.map(t => {
          const isActive = t.key === target;
          const isSet = t.key === "all" ? !!roomMaterials.wall
                      : t.key === "back" ? !!roomMaterials.wallBack
                      : t.key === "front" ? !!roomMaterials.wallFront
                      : t.key === "left" ? !!roomMaterials.wallLeft
                      : t.key === "right" ? !!roomMaterials.wallRight
                      : !!roomMaterials.wallLower;
          return (
            <button
              key={t.key}
              onClick={() => setTarget(t.key)}
              className="relative text-[10px] py-1.5 rounded-md transition-all"
              title={t.hint}
              style={
                isActive
                  ? { background: "#007AFF", color: "white", fontWeight: 600 }
                  : { background: "var(--ds-surface)", color: "var(--ds-text-2)", border: "1px solid var(--ds-border)" }
              }
            >
              {t.label}
              {isSet && !isActive && (
                <span className="absolute top-0.5 right-1 w-1.5 h-1.5 rounded-full" style={{ background: "#10B981" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Split-height slider (only visible when wainscot is active) */}
      {(target === "lower" || roomMaterials.wallLower) && (
        <div className="mb-2 px-1">
          <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: "var(--ds-text-2)" }}>
            <span>{t.wainscotHeight}</span>
            <span className="font-bold" style={{ color: "var(--ds-text)" }}>{splitH} cm</span>
          </div>
          <input
            type="range" min={60} max={180} step={5} value={splitH}
            onChange={e => setWallSplitHeight(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: "#007AFF" }}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {wallItems.map(item => (
          <WallMatCard key={item.id} item={item} target={target} />
        ))}
      </div>
    </div>
  );
}

function MaterialsTab() {
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom].materials);
  const removeMaterial = useDesignerStore((s) => s.removeMaterial);
  const t = useT();

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Wall section with per-side + wainscot support */}
      <WallSection />

      {/* Remaining sections (floor, ceiling, light, tile) */}
      {MATERIAL_SECTIONS.map(({ key, icon, category, rooms }) => {
        if (rooms && !rooms.includes(activeRoom)) return null;
        const items = MATERIALS.filter((m) => m.category === category);
        const selected = roomMaterials[category];
        // 天花板 category 没有现成的 ceiling material 条目——先复用 wall 条目作材料库
        // （用户在墙壁材料库里选纸/漆就可以用到天花板上），材料本身不必区分。
        const displayItems = category === "ceiling"
          ? MATERIALS.filter(m => m.category === "wall")
          : items;
        if (displayItems.length === 0) return null;
        return (
          <div key={category}>
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--ds-text-3)" }}>
                {icon} {t.materialSections[key] ?? key}
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
              {displayItems.map((item) => (
                <MatCard key={item.id} item={category === "ceiling" ? { ...item, category: "ceiling" } : item} />
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
  const [tab, setTab] = useState<"materials" | "furniture" | "templates">("materials");
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
        {(["materials", "furniture", "templates"] as const).map((key) => (
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
            {key === "materials" ? t.tabMaterials : key === "furniture" ? t.tabFurniture : t.tabTemplates}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "materials" && <MaterialsTab />}
        {tab === "furniture" && <FurnitureTab />}
        {tab === "templates" && <TemplatesPanel />}
      </div>

      {/* Hint — hidden on templates tab */}
      {tab !== "templates" && (
        <div
          className="px-3 py-2 text-[10px] shrink-0"
          style={{ borderTop: "1px solid var(--ds-border-soft)", color: "var(--ds-text-3)" }}
        >
          {tab === "furniture" ? t.furnitureHint : t.matHint}
        </div>
      )}
    </aside>
  );
}
