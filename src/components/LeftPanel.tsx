"use client";

import { useState, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import ModelImportCard from "./ModelImportCard";

/** Stable fallback so selectors don't create a new object on each render */
const EMPTY_MATERIALS = {} as const;
const EMPTY_PLACED: never[] = [];
import TemplatesPanel from "./TemplatesPanel";
import { MATERIALS } from "@/lib/data";
import { FURNITURE, getFurnitureForRoom, FURNITURE_CATEGORIES, getCustomFurniture } from "@/lib/furniture";
import { MaterialItem, FurnitureItem, StyleTag } from "@/lib/types";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn, getBrandNameEn } from "@/locales/itemNames";
import { formatUnitPrice, formatPrice } from "@/lib/currency";
import { useCatalogThumbnail } from "@/lib/catalogThumbnails";

// ─── Material card ─────────────────────────────────────────
function MatCard({ item }: { item: MaterialItem }) {
  const setMaterial = useDesignerStore((s) => s.setMaterial);
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.rooms[activeRoom]?.materials ?? EMPTY_MATERIALS);
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
  const placedItems = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.rooms[activeRoom]?.placedItems ?? EMPTY_PLACED);
  const isPlaced = placedItems.some((p) => p.furnitureId === item.id);
  const locale = useLocale();
  const displayName = locale === "en" ? (getFurnitureNameEn(item.id) ?? item.name) : item.name;
  const displayBrand = locale === "en" ? getBrandNameEn(item.brand) : item.brand;
  // 只在有真实 3D 预览图时显示缩略图块；没有的（emoji 占位）不再渲染色块。
  const thumb = useCatalogThumbnail(item.model3d?.url, item.model3d?.recolor);

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
      {thumb && (
        <div
          className="w-full h-9 rounded-lg overflow-hidden"
          style={{ background: "var(--ds-surface-2)" }}
        >
          <img src={thumb} alt="" className="w-full h-full object-contain" draggable={false} />
        </div>
      )}
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
type WallTarget = "all" | "N" | "S" | "W" | "E" | "lower";

/** Card variant for walls: dispatches to the right store action based on
 *  the currently-selected wall target. */
function WallMatCard({ item, target }: { item: MaterialItem; target: WallTarget }) {
  const setMaterial = useDesignerStore((s) => s.setMaterial);
  const setWallSide = useDesignerStore((s) => s.setWallSide);
  const setWallLower = useDesignerStore((s) => s.setWallLower);
  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomMaterials = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.rooms[activeRoom]?.materials ?? EMPTY_MATERIALS);
  const locale = useLocale();
  const displayName = locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name;
  const displayBrand = locale === "en" ? getBrandNameEn(item.brand) : item.brand;

  // Check if this material is the active selection for the current target.
  const activeField = target === "all" ? roomMaterials.wall
                    : target === "N"   ? roomMaterials.wallBack
                    : target === "S"   ? roomMaterials.wallFront
                    : target === "W"   ? roomMaterials.wallLeft
                    : target === "E"   ? roomMaterials.wallRight
                    :                    roomMaterials.wallLower;
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
  const roomMaterials  = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.rooms[activeRoom]?.materials ?? EMPTY_MATERIALS);
  const removeMaterial = useDesignerStore((s) => s.removeMaterial);
  const setWallSide    = useDesignerStore((s) => s.setWallSide);
  const setWallLower   = useDesignerStore((s) => s.setWallLower);
  const setWallSplitHeight = useDesignerStore((s) => s.setWallSplitHeight);
  const exteriorStyle  = useDesignerStore(
    (s) => s.floorPlans[s.activeFloor].roomExteriorStyle?.[activeRoom] ?? "auto"
  );
  const setRoomExteriorStyle = useDesignerStore((s) => s.setRoomExteriorStyle);
  const [target, setTarget] = useState<WallTarget>("all");
  const t = useT();
  const locale = useLocale();

  const wallItems = MATERIALS.filter(m => m.category === "wall");
  const splitH = roomMaterials.wallSplitHeight ?? 110;

  const TARGETS: Array<{ key: WallTarget; label: string; hint: string }> = [
    { key: "all",   ...t.wallTargets.all },
    { key: "N",     ...t.wallTargets.N },
    { key: "S",     ...t.wallTargets.S },
    { key: "W",     ...t.wallTargets.W },
    { key: "E",     ...t.wallTargets.E },
    { key: "lower", ...t.wallTargets.lower },
  ];

  const clearForTarget = () => {
    if (target === "all") removeMaterial("wall");
    else if (target === "lower") setWallLower(undefined);
    else setWallSide(target, undefined);
  };
  const currentlySet = target === "all" ? roomMaterials.wall
                     : target === "N"   ? roomMaterials.wallBack
                     : target === "S"   ? roomMaterials.wallFront
                     : target === "W"   ? roomMaterials.wallLeft
                     : target === "E"   ? roomMaterials.wallRight
                     :                    roomMaterials.wallLower;

  return (
    <div>
      {/* 外墙样式（per-room exterior facade override）—— 决定本房间的外墙在
          "效果图驱动外观"里被渲染成自动判定、实墙还是玻璃幕墙。同样的
          toggle 也出现在右面板的「🏮 外墙装饰」区块。 */}
      <div className="mb-2 p-2 rounded-xl" style={{ background: "var(--ds-surface-2)", border: "1px solid var(--ds-border-soft)" }}>
        <div className="text-[9px] mb-1" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en" ? "Exterior facade style" : "外墙样式"}
        </div>
        <div className="flex gap-1">
          {([
            { id: "auto",     zh: "自动",     en: "Auto" },
            { id: "concrete", zh: "实墙",     en: "Solid" },
            { id: "glass",    zh: "玻璃幕墙", en: "Glass" },
          ] as const).map(opt => {
            const active = exteriorStyle === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setRoomExteriorStyle(activeRoom, opt.id)}
                className="flex-1 text-[10px] py-1.5 rounded-md transition-all"
                style={
                  active
                    ? { background: "#007AFF", color: "white", fontWeight: 600 }
                    : { background: "var(--ds-surface)", color: "var(--ds-text-2)", border: "1px solid var(--ds-border)" }
                }
              >
                {locale === "en" ? opt.en : opt.zh}
              </button>
            );
          })}
        </div>
      </div>

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
                      : t.key === "N"   ? !!roomMaterials.wallBack
                      : t.key === "S"   ? !!roomMaterials.wallFront
                      : t.key === "W"   ? !!roomMaterials.wallLeft
                      : t.key === "E"   ? !!roomMaterials.wallRight
                      :                   !!roomMaterials.wallLower;
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
  const roomMaterials = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.rooms[activeRoom]?.materials ?? EMPTY_MATERIALS);
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
const STYLE_TAGS: StyleTag[] = ["现代", "北欧", "中式", "日式", "工业风", "轻奢"];

function FurnitureTab() {
  const activeRoom      = useDesignerStore((s) => s.activeRoom);
  const customFurniture = useDesignerStore((s) => s.customFurniture);
  const addCustomFurniture = useDesignerStore((s) => s.addCustomFurniture);
  const placeFurniture  = useDesignerStore((s) => s.placeFurniture);
  const [showForm, setShowForm] = useState(false);
  const [allRooms, setAllRooms] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [styleTag, setStyleTag] = useState<StyleTag | null>(null);
  const t = useT();
  const locale = useLocale();

  // ── 导入 3D 模型为家具（统一导入卡：压缩可选 + 本机路径）────────────
  // 与院子/导入导出共用同一条链路（落 public/models/imported/ 真实文件）；
  // 导入后注册成自定义家具（model3d.url 走 GLB 渲染）并摆进当前房间。
  // 「模型库」列出历史导入，随时再调出。
  const [showGlbImport, setShowGlbImport] = useState(false);
  const [showGlbLib, setShowGlbLib] = useState(false);
  const [glbLib, setGlbLib] = useState<Array<{ url: string; name: string; nameEn?: string; previewUrl?: string | null; bytes: number }>>([]);
  useEffect(() => {
    if (!showGlbLib) return;
    let alive = true;
    void fetch("/api/import-model")
      .then(r => r.ok ? r.json() : { models: [] })
      .then(d => { if (alive) setGlbLib(d.models ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [showGlbLib]);

  const deleteGlbModel = (m: { url: string; name: string }) => {
    const file = m.url.split("/").pop() ?? "";
    if (!window.confirm(locale === "en"
      ? `Delete "${m.name}" from the model library? Placed instances will fail to load.`
      : `从模型库删除「${m.name}」？已摆放的实例会变成加载失败。`)) return;
    void fetch(`/api/import-model?file=${encodeURIComponent(file)}`, { method: "DELETE" })
      .then(() => setGlbLib(list => list.filter(x => x.url !== m.url)))
      .catch(() => {});
  };

  // 手动重命名：按当前语言改对应名字字段（PATCH 合并，另一语言名保留）。
  const renameGlbModel = (m: { url: string; name: string; nameEn?: string }) => {
    const file = m.url.split("/").pop() ?? "";
    const cur = locale === "en" ? (m.nameEn || m.name) : m.name;
    const next = window.prompt(locale === "en" ? "Rename model:" : "重命名模型：", cur);
    if (next == null) return;
    const t = next.trim();
    if (!t || t === cur) return;
    const body = locale === "en" ? { file, nameEn: t } : { file, nameZh: t };
    void fetch("/api/import-model", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(() => setGlbLib(list => list.map(x => x.url === m.url
      ? (locale === "en" ? { ...x, nameEn: t } : { ...x, name: t }) : x)))
      .catch(() => {});
  };

  const addGlbAsFurniture = (url: string, name: string) => {
    const item: FurnitureItem = {
      id:          `custom_glb_${crypto.randomUUID().slice(0, 8)}`,
      name:        name || (locale === "en" ? "Imported model" : "导入模型"),
      brand:       locale === "en" ? "Imported" : "导入模型",
      price:       0,
      unit:        "元/件",
      category:    "storage",
      roomTypes:   ["living","master","bedroom","kitchen","bathroom","dining","study","closet","balcony"],
      color:       "#B0AFA8",
      width:       80, depth: 60, height: 80,
      tags:        [],
      description: locale === "en" ? "User-imported 3D model" : "用户导入的 3D 模型",
      icon:        "🧩",
      model3d:     { url },
    };
    addCustomFurniture(item);
    placeFurniture(item.id);
  };

  const handleImported = (url: string, name: string, batch?: boolean) => {
    // 批量导入：只入库（不自动摆放、不关卡），导入后到模型库逐个重命名/摆放。
    if (!batch) {
      addGlbAsFurniture(url, name);
      setShowGlbImport(false);
    }
    // 同步进「模型库」列表，之后可随时再调出
    if (url.startsWith("/models/imported/")) {
      setGlbLib(list => list.some(m => m.url === url) ? list : [{ url, name, bytes: 0 }, ...list]);
    }
    // 批量结束后自动展开模型库，方便立即重命名
    if (batch) setShowGlbLib(true);
  };

  const roomFurniture = allRooms ? [...FURNITURE, ...getCustomFurniture()] : getFurnitureForRoom(activeRoom);
  // Include any custom furniture (all rooms)
  const allItems = allRooms ? roomFurniture : [...roomFurniture, ...customFurniture];

  // Apply search + tag filters
  const filteredItems = allItems.filter(item => {
    const matchSearch = !searchQ || item.name.includes(searchQ) || item.brand?.includes(searchQ);
    const matchTag = !styleTag || (item.tags ?? []).includes(styleTag);
    return matchSearch && matchTag;
  });

  // Group by category
  const groups = FURNITURE_CATEGORIES
    .map((cat) => ({
      ...cat,
      items: filteredItems.filter((f) => f.category === cat.id),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Search input */}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span style={{
          position: "absolute",
          left: 8,
          fontSize: 13,
          color: "var(--ds-text-3)",
          pointerEvents: "none",
          lineHeight: 1,
        }}>🔍</span>
        <input
          type="text"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder={locale === "en" ? "Search furniture…" : "搜索家具…"}
          style={{
            width: "100%",
            height: 30,
            paddingLeft: 26,
            paddingRight: 8,
            fontSize: 12,
            borderRadius: 12,
            border: "1px solid var(--ds-border)",
            background: "var(--ds-surface)",
            color: "var(--ds-text)",
            outline: "none",
          }}
        />
      </div>

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

      {/* 导入 3D 模型为家具 + 模型库调出（统一导入卡：压缩可选/本机路径） */}
      <div className="flex gap-2 items-center -mt-2">
        <button
          onClick={() => setShowGlbImport(v => !v)}
          className="flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all"
          style={showGlbImport
            ? { background: "#6366F1", color: "#fff", border: "1px solid #6366F1" }
            : { border: "1px dashed var(--ds-border)", color: "var(--ds-text-3)", background: "transparent" }}
        >
          {locale === "en" ? "📦 Import model" : "📦 导入模型"}
        </button>
        <button
          onClick={() => setShowGlbLib(v => !v)}
          className="flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all"
          style={showGlbLib
            ? { background: "#007AFF", color: "#fff", border: "1px solid #007AFF" }
            : { border: "1px dashed var(--ds-border)", color: "var(--ds-text-3)", background: "transparent" }}
        >
          {locale === "en" ? "🧩 Model library" : "🧩 模型库"}
        </button>
      </div>
      {showGlbImport && (
        <div className="-mt-2">
          <ModelImportCard onImported={handleImported} />
        </div>
      )}
      {showGlbLib && (
        <div className="flex flex-col gap-1 -mt-2">
          {glbLib.length === 0 && (
            <div className="text-[10px] px-1" style={{ color: "var(--ds-text-3)" }}>
              {locale === "en" ? "No imported models yet — use “Import model”." : "还没有导入过模型——点「📦 导入模型」上传。"}
            </div>
          )}
          {glbLib.map(m => {
            const display = locale === "en" ? (m.nameEn || m.name) : m.name;
            return (
              <div key={m.url}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors hover:bg-blue-50"
                style={{ border: "1px solid var(--ds-border)", background: "var(--ds-surface)" }}>
                <button onClick={() => addGlbAsFurniture(m.url, display)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  title={locale === "en" ? "Place into current room" : "放进当前房间"}>
                  {m.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.previewUrl} alt="" className="w-8 h-8 rounded shrink-0 object-contain"
                      style={{ background: "var(--ds-bg)" }} />
                  ) : (
                    <span className="text-sm w-8 text-center">🧩</span>
                  )}
                  <span className="flex-1 min-w-0 truncate text-[11px] font-semibold" style={{ color: "var(--ds-text-2)" }}>{display}</span>
                  <span className="text-[9px] shrink-0" style={{ color: "var(--ds-text-3)" }}>{(m.bytes / 1024 / 1024).toFixed(1)}MB</span>
                </button>
                <button onClick={() => renameGlbModel(m)}
                  title={locale === "en" ? "Rename" : "重命名"}
                  className="shrink-0 text-xs text-gray-300 hover:text-indigo-500">✎</button>
                <button onClick={() => deleteGlbModel({ url: m.url, name: display })}
                  title={locale === "en" ? "Delete from library" : "从模型库删除"}
                  className="shrink-0 text-xs text-gray-300 hover:text-red-500">✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Style tag filter pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {STYLE_TAGS.map(tag => (
          <button
            key={tag}
            onClick={() => setStyleTag(prev => prev === tag ? null : tag)}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 999,
              border: styleTag === tag ? "none" : "1px solid var(--ds-border)",
              background: styleTag === tag ? "#007AFF" : "var(--ds-surface)",
              color: styleTag === tag ? "#fff" : "var(--ds-text-3)",
              cursor: "pointer",
              lineHeight: "18px",
            }}
          >
            {t.styleTags[tag] ?? tag}
          </button>
        ))}
      </div>

      {showForm && <CustomFurnitureForm onClose={() => setShowForm(false)} />}

      {groups.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-6">
          {searchQ || styleTag ? (locale === "en" ? "No matching furniture" : "没有匹配的家具") : t.noFurnitureForRoom}
        </div>
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
  // 加家具（含导入模型）只在 2D 编辑视图：房间平面（这里）+ 院子图（YardPlanLibrary）。
  // 效果图/全屋3D 是"看效果"的视图，隐藏家具 tab，避免在 3D 里加完找不到/误操作。
  const viewMode = useDesignerStore(s => s.viewMode);
  const canEditFurniture = viewMode === "2d";
  const tabs = canEditFurniture
    ? (["materials", "furniture", "templates"] as const)
    : (["materials", "templates"] as const);
  const effectiveTab = !canEditFurniture && tab === "furniture" ? "materials" : tab;

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
        {tabs.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex-1 py-1.5 text-xs font-bold rounded-t-lg transition-all"
            style={
              effectiveTab === key
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
        {effectiveTab === "materials" && <MaterialsTab />}
        {effectiveTab === "furniture" && <FurnitureTab />}
        {effectiveTab === "templates" && <TemplatesPanel />}
      </div>

      {/* Hint — hidden on templates tab */}
      {effectiveTab !== "templates" && (
        <div
          className="px-3 py-2 text-[10px] shrink-0"
          style={{ borderTop: "1px solid var(--ds-border-soft)", color: "var(--ds-text-3)" }}
        >
          {effectiveTab === "furniture" ? t.furnitureHint : t.matHint}
        </div>
      )}
    </aside>
  );
}
