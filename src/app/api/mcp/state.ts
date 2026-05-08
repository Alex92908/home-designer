/**
 * Shared in-process state bridge for the MCP server.
 * Lives in module scope so all requests within the same Node.js process
 * share the same Map.  Cleared on process restart (by design for MVP).
 */

export interface DesignState {
  preset?: string;
  roofStyle?: string;
  wallColor?: string;
  roofColor?: string;
  accentColor?: string;
  wallMaterial?: string;
  floors?: number;
  yardPreset?: string;
  showPerimeterFence?: boolean;
}

const store = new Map<string, DesignState>();
const SESSION = "default";

export function getState(): DesignState {
  return store.get(SESSION) ?? {};
}

export function patchState(patch: Record<string, unknown>): DesignState {
  const current = getState();
  // Only merge known keys to avoid polluting state with arbitrary data
  const allowed: (keyof DesignState)[] = [
    "preset", "roofStyle", "wallColor", "roofColor",
    "accentColor", "wallMaterial", "floors", "yardPreset", "showPerimeterFence",
  ];
  const safe: Partial<DesignState> = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      (safe as Record<string, unknown>)[key] = patch[key];
    }
  }
  const updated = { ...current, ...safe };
  store.set(SESSION, updated);
  return updated;
}
