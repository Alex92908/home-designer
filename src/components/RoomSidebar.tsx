"use client";

import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS } from "@/lib/types";
import { useT } from "@/lib/i18n";

export default function RoomSidebar() {
  const activeRoom     = useDesignerStore((s) => s.activeRoom);
  const setActiveRoom  = useDesignerStore((s) => s.setActiveRoom);
  const viewMode       = useDesignerStore((s) => s.viewMode);
  const setViewMode    = useDesignerStore((s) => s.setViewMode);
  const rooms          = useDesignerStore((s) => s.rooms);
  const enabledRooms   = useDesignerStore((s) => s.enabledRooms);
  const customRoomMeta = useDesignerStore((s) => s.customRoomMeta);
  const t              = useT();

  return (
    <aside
      className="shrink-0 h-full flex flex-col overflow-y-auto overflow-x-hidden py-1.5 gap-0.5"
      style={{
        width: 60,
        background: "var(--ds-surface)",
        borderRight: "1px solid var(--ds-border)",
        scrollbarWidth: "none",
      }}
    >
      {enabledRooms.map((r) => {
        const def      = ROOM_DEFS[r];
        const meta     = customRoomMeta[r];
        const name     = t.roomNames[r] ?? meta?.name ?? def.name;
        const icon     = meta?.icon ?? def.icon;
        const isActive = activeRoom === r && viewMode !== "all" && viewMode !== "exterior";
        const hasContent =
          Object.keys(rooms[r].materials).length > 0 ||
          rooms[r].placedItems.length > 0;

        return (
          <button
            key={r}
            title={name}
            onClick={() => {
              setActiveRoom(r);
              if (viewMode === "all" || viewMode === "exterior") setViewMode("2d");
            }}
            className="relative mx-1.5 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150 shrink-0"
            style={{
              height: 52,
              ...(isActive
                ? { background: "#007AFF" }
                : { background: "transparent" }),
            }}
          >
            {/* Room icon */}
            <span className="text-base leading-none">{icon}</span>

            {/* Short name — truncate to fit 56px */}
            <span
              className="text-[9px] font-semibold leading-tight w-full text-center px-0.5 truncate"
              style={{ color: isActive ? "rgba(255,255,255,0.9)" : "var(--ds-text-3)" }}
            >
              {name.length > 5 ? name.slice(0, 5) : name}
            </span>

            {/* Has-content dot (only when not active) */}
            {hasContent && !isActive && (
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                style={{ background: "#007AFF" }}
              />
            )}
          </button>
        );
      })}
    </aside>
  );
}
