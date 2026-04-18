import type { RoomType } from "./types";
import type { RoomState, FloorPlan } from "./store";

export interface ShareSnapshot {
  // New format: floorPlans array
  floorPlans?: FloorPlan[];
  // Legacy format (floor 0 only) — kept for backward compat decode
  rooms?: Partial<Record<RoomType, RoomState>>;
  enabledRooms?: RoomType[];
  budget: number;
  exterior: Record<string, unknown>;
  customRoomMeta: Partial<Record<RoomType, { name: string; icon: string }>>;
  roomDimensions?: Partial<Record<RoomType, { width: number; depth: number }>>;
  v: number; // schema version
}

export function encodeShare(snapshot: ShareSnapshot): string {
  const json = JSON.stringify(snapshot);
  // btoa needs ASCII — encode via URI encoding first
  return btoa(encodeURIComponent(json));
}

export function decodeShare(encoded: string): ShareSnapshot | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    const parsed = JSON.parse(json);
    // Accept both new format (floorPlans) and legacy format (rooms + enabledRooms)
    if (!parsed.floorPlans && !parsed.rooms) return null;
    if (parsed.rooms && !parsed.enabledRooms) return null;
    return parsed as ShareSnapshot;
  } catch {
    return null;
  }
}
