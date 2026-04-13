import type { RoomType } from "./types";
import type { RoomState } from "./store";

export interface ShareSnapshot {
  rooms: Partial<Record<RoomType, RoomState>>;
  enabledRooms: RoomType[];
  budget: number;
  exterior: Record<string, unknown>;
  customRoomMeta: Partial<Record<RoomType, { name: string; icon: string }>>;
  roomDimensions: Partial<Record<RoomType, { width: number; depth: number }>>;
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
    if (!parsed.rooms || !parsed.enabledRooms) return null;
    return parsed as ShareSnapshot;
  } catch {
    return null;
  }
}
