"use client";

/**
 * FloorPlanMinimap — small overview of the current floor's plan,
 * shown next to the single-room editor so the user can see which
 * walls face neighbours / corridors / outside before deciding where
 * to put doors, windows, or to hide a wall.
 *
 * Read-only-ish: clicking a room sets it as the active room (faster
 * than going back to the global plan tab to switch). The currently
 * edited room is highlighted with a red outline.
 *
 * Reads from useDesignerStore directly so it can be mounted at any
 * depth in FloorPlan.tsx without prop drilling.
 */

import { useMemo } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, type RoomType } from "@/lib/types";
import { useT } from "@/lib/i18n";

const MINIMAP_PX = 200;        // square canvas size
const PAD_PX     = 6;          // inner padding so border isn't flush
const LABEL_MAX  = 4;          // truncate room name beyond this many chars

export function FloorPlanMinimap() {
  const t           = useT();
  const activeFloor = useDesignerStore(s => s.activeFloor);
  const activeRoom  = useDesignerStore(s => s.activeRoom);
  const fp          = useDesignerStore(s => s.floorPlans[s.activeFloor]);
  const setActiveRoom = useDesignerStore(s => s.setActiveRoom);

  // Build a compact { room, x, y, w, d, polygon? } list with the floor's
  // global bbox so we can fit the whole plan inside MINIMAP_PX.
  const data = useMemo(() => {
    if (!fp) return null;
    const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor);
    if (rooms.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const list: Array<{ room: RoomType; x: number; y: number; w: number; d: number; polygon?: Array<[number, number]> }> = [];
    for (const room of rooms) {
      const lay = fp.roomLayout?.[room];
      const dim = fp.roomDimensions?.[room];
      if (!lay || !dim) continue;
      minX = Math.min(minX, lay.x); minY = Math.min(minY, lay.y);
      maxX = Math.max(maxX, lay.x + dim.width);
      maxY = Math.max(maxY, lay.y + dim.depth);
      const shape = fp.roomShapes?.[room];
      list.push({
        room, x: lay.x, y: lay.y, w: dim.width, d: dim.depth,
        polygon: shape && shape.preset !== "rect" ? shape.points : undefined,
      });
    }
    if (!isFinite(minX) || list.length === 0) return null;
    const planW = maxX - minX, planD = maxY - minY;
    const usable = MINIMAP_PX - PAD_PX * 2;
    const scale = Math.min(usable / planW, usable / planD);
    return { list, minX, minY, planW, planD, scale };
  }, [fp]);

  if (!data) return null;
  const { list, minX, minY, planW, planD, scale } = data;
  // Centring offset so the plan sits in the middle of the minimap.
  const offX = (MINIMAP_PX - planW * scale) / 2;
  const offY = (MINIMAP_PX - planD * scale) / 2;

  return (
    <aside
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        width: MINIMAP_PX,
        zIndex: 30,
        background: "rgba(20, 22, 32, 0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        boxShadow: "0 6px 22px rgba(0,0,0,0.45)",
        padding: 6,
        pointerEvents: "auto",
      }}
      // Don't let outer SVG / drag handlers steal the click — Minimap
      // owns its own pointer events.
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div style={{
        fontSize: 10, color: "#9CA3AF", letterSpacing: "0.08em",
        textTransform: "uppercase", marginBottom: 4, paddingLeft: 2,
      }}>
        {`F${activeFloor + 1} · ${list.length} 房间 · 点击切换`}
      </div>
      <svg width={MINIMAP_PX} height={MINIMAP_PX} style={{ display: "block", background: "#0f1117", borderRadius: 4 }}>
        {/* Light grid (every 1m). Cheap; helps gauge scale. */}
        {(() => {
          const lines: React.ReactNode[] = [];
          const step = 100 * scale; // 1 m
          for (let x = offX % step; x < MINIMAP_PX; x += step) {
            lines.push(<line key={`vx-${x}`} x1={x} y1={0} x2={x} y2={MINIMAP_PX} stroke="#1c1f2a" strokeWidth={1} />);
          }
          for (let y = offY % step; y < MINIMAP_PX; y += step) {
            lines.push(<line key={`hy-${y}`} x1={0} y1={y} x2={MINIMAP_PX} y2={y} stroke="#1c1f2a" strokeWidth={1} />);
          }
          return lines;
        })()}
        {/* Rooms */}
        {list.map(r => {
          const def = ROOM_DEFS[r.room];
          const isActive = r.room === activeRoom;
          const fill = def?.defaultFloorColor ?? "#374151";
          const cx = offX + (r.x - minX) * scale;
          const cy = offY + (r.y - minY) * scale;
          const cw = r.w * scale;
          const cd = r.d * scale;
          // Polygon path (when room has custom shape)
          const polyPts = r.polygon?.map(([px, pz]) =>
            `${(cx + px * scale).toFixed(1)},${(cy + pz * scale).toFixed(1)}`).join(" ");
          const label = (def?.name ?? r.room).slice(0, LABEL_MAX);
          return (
            <g key={r.room} style={{ cursor: "pointer" }}
              onClick={(ev) => { ev.stopPropagation(); setActiveRoom(r.room); }}>
              {polyPts ? (
                <polygon points={polyPts}
                  fill={fill} fillOpacity={isActive ? 0.95 : 0.55}
                  stroke={isActive ? "#EF4444" : "rgba(255,255,255,0.25)"}
                  strokeWidth={isActive ? 2 : 1} />
              ) : (
                <rect x={cx} y={cy} width={cw} height={cd}
                  fill={fill} fillOpacity={isActive ? 0.95 : 0.55}
                  stroke={isActive ? "#EF4444" : "rgba(255,255,255,0.25)"}
                  strokeWidth={isActive ? 2 : 1} />
              )}
              <text x={cx + cw / 2} y={cy + cd / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={Math.max(8, Math.min(11, cw * 0.18))}
                fill={isActive ? "#fff" : "#cbd5e1"}
                fontWeight={isActive ? 700 : 500}
                style={{ pointerEvents: "none", userSelect: "none" }}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{
        fontSize: 9, color: "#6B7280", marginTop: 4, paddingLeft: 2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {`${(planW / 100).toFixed(1)} × ${(planD / 100).toFixed(1)} m · ${t.fpWallLabels?.N ?? "N"} = 顶部`}
      </div>
    </aside>
  );
}
