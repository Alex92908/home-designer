"use client";

import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, RoomType } from "@/lib/types";
import { useT, useLocale } from "@/lib/i18n";
// RoomType re-exported so the enterWalkthrough event payload is typed

/**
 * Left-side room list shown in 外观 view.
 * Users click a room item to enter that room in single-room 3D mode —
 * replaces the previous "click on glass facade" interaction.
 */
export default function ExteriorRoomList() {
  const t = useT();
  const locale = useLocale();
  const floorPlans     = useDesignerStore(s => s.floorPlans);
  const exterior       = useDesignerStore(s => s.exterior);
  const customRoomMeta = useDesignerStore(s => s.customRoomMeta);
  const floorCount = Math.max(exterior.floors, 1);
  // 天台层作为普通楼层并入列表：紧跟最高楼层，编号 = floorCount（0-based）。
  const roofFi      = exterior.hasRooftop ? floorCount : -1;
  const listFloors  = roofFi >= 0 ? floorCount + 1 : floorCount;

  /** Dispatch a custom event picked up by HouseCanvas to teleport the
   *  walkthrough camera into the chosen room. */
  const enterRoom = (room: RoomType, fi: number) => {
    window.dispatchEvent(
      new CustomEvent("enterWalkthrough", { detail: { room, fi } })
    );
  };

  const localName = (r: RoomType) => {
    const meta = customRoomMeta[r];
    if (meta?.name) return meta.name;
    return t.roomNames[r] ?? ROOM_DEFS[r]?.name ?? r;
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--ds-surface)" }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--ds-border-soft)" }}>
        <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en" ? "Enter a room" : "进入房间"}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en" ? "Click to walk inside" : "点击进入该房间漫游"}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {Array.from({ length: listFloors }, (_, fi) => {
          const fp = floorPlans[fi];
          if (!fp) return null;
          const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor);
          if (rooms.length === 0) return null;
          return (
            <div key={fi} className="mb-3">
              <div className="px-2 mb-1 text-[10px] font-bold" style={{ color: "var(--ds-text-2)" }}>
                {fi === roofFi ? (locale === "en" ? "Rooftop" : "天台") : `${fi + 1}F`}
              </div>
              <div className="flex flex-col gap-1">
                {rooms.map(r => {
                  const def = ROOM_DEFS[r];
                  const dim = fp.roomDimensions?.[r];
                  const area = dim ? ((dim.width * dim.depth) / 10000).toFixed(1) : "";
                  return (
                    <button
                      key={`${fi}-${r}`}
                      onClick={() => enterRoom(r, fi)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all"
                      style={{
                        background: "var(--ds-surface)",
                        border: "1px solid var(--ds-border-soft)",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "var(--ds-primary-soft)";
                        e.currentTarget.style.borderColor = "var(--ds-primary)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "var(--ds-surface)";
                        e.currentTarget.style.borderColor = "var(--ds-border-soft)";
                      }}
                    >
                      <span className="text-base shrink-0">{def?.icon ?? "🏠"}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12px] font-semibold truncate" style={{ color: "var(--ds-text)" }}>
                          {localName(r)}
                        </span>
                        {area && (
                          <span className="block text-[9px]" style={{ color: "var(--ds-text-3)" }}>
                            {area} ㎡
                          </span>
                        )}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--ds-text-3)" }}>🚶</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
