/**
 * Routing validation: given a room's placedItems + connections, find
 * fixtures that are missing required hookups.
 *
 * Rules:
 *  - Every electrical fixture (outlet/switch/jack/appliance using power)
 *    must reach a `breaker-panel` or `weak-panel` via a wire path.
 *  - Every faucet, shower, toilet, sink, vanity must have a cold-water
 *    connection. Faucets/showers/sinks/vanities must also have a drain.
 *  - Showers and sinks/vanities must have a hot-water connection.
 *
 * Returns a Map of instanceId → array of issue descriptions.
 */
import type { PlacedItem, RoutingConnection, RoutingKind } from "./types";
import { getFurnitureById } from "./furniture";

export interface RoutingIssue {
  instanceId: string;
  severity: "error" | "warning";
  message: string;
}

/** Categories that REQUIRE electrical wiring (must reach a panel). */
const NEEDS_POWER = new Set([
  "electrical",   // outlets/switches/jacks
  "range_hood",
  "refrigerator",
  "kitchen_sink", // dishwashers / disposals (approx)
]);

/** Specific item IDs that need power (within bath_accessory etc.). */
const POWER_ITEM_IDS = new Set<string>([
  // smart toilets
  "toilet-smart",
  "toilet-curved-modern",
]);

/** Items that need cold water supply. */
const NEEDS_COLD_WATER = new Set<string>([
  "kitchen_sink",
  "bathroom_vanity",
]);
/** Specific IDs needing cold water. */
const COLD_WATER_IDS = new Set<string>([
  "toilet-standard", "toilet-smart", "toilet-squat", "toilet-curved-modern",
  "shower-enclosed", "shower-walkin",
  "shower-head", "faucet-basin",
  "bathtub-builtin", "bathtub-freestanding",
]);

/** Items that need hot water supply. */
const HOT_WATER_IDS = new Set<string>([
  "shower-enclosed", "shower-walkin", "shower-head",
  "faucet-basin",
  "bathtub-builtin", "bathtub-freestanding",
]);
/** Categories needing hot water. */
const NEEDS_HOT_WATER = new Set<string>([
  "kitchen_sink",
  "bathroom_vanity",
]);

/** Items that need a drain. */
const NEEDS_DRAIN_CATEGORIES = new Set<string>([
  "toilet",
  "kitchen_sink",
  "bathroom_vanity",
  "bathtub",
  "shower",
]);
const NEEDS_DRAIN_IDS = new Set<string>([
  "shower-head", "faucet-basin",
]);

/** True if the item needs to be wired to power. */
function needsPower(item: { id: string; category: string }): boolean {
  return NEEDS_POWER.has(item.category) || POWER_ITEM_IDS.has(item.id);
}
function needsCold(item: { id: string; category: string }): boolean {
  return NEEDS_COLD_WATER.has(item.category) || COLD_WATER_IDS.has(item.id);
}
function needsHot(item: { id: string; category: string }): boolean {
  return NEEDS_HOT_WATER.has(item.category) || HOT_WATER_IDS.has(item.id);
}
function needsDrain(item: { id: string; category: string }): boolean {
  return NEEDS_DRAIN_CATEGORIES.has(item.category) || NEEDS_DRAIN_IDS.has(item.id);
}

/** Given an instanceId, walk along connections of `kind` and collect all
 *  reachable instance IDs (transitive closure on undirected graph). */
function reachable(
  startId: string, kind: RoutingKind,
  connections: RoutingConnection[],
): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const c of connections) {
    if (c.kind !== kind) continue;
    if (!adj.has(c.from)) adj.set(c.from, new Set());
    if (!adj.has(c.to))   adj.set(c.to,   new Set());
    adj.get(c.from)!.add(c.to);
    adj.get(c.to)!.add(c.from);
  }
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    const next = adj.get(cur);
    if (!next) continue;
    for (const n of next) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return seen;
}

/** Main entry: returns an array of issues, one or more per problematic
 *  fixture. Empty array = everything passes. */
export function validateRouting(
  placedItems: PlacedItem[],
  connections: RoutingConnection[],
): RoutingIssue[] {
  const issues: RoutingIssue[] = [];

  // Build lookup
  const items = placedItems
    .map(p => ({ placed: p, item: getFurnitureById(p.furnitureId) }))
    .filter(x => x.item) as Array<{ placed: PlacedItem; item: NonNullable<ReturnType<typeof getFurnitureById>> }>;

  // Power: any panel?
  const panels = items.filter(x =>
    x.item.id === "breaker-panel" || x.item.id === "weak-panel"
  );
  // Cold/hot/drain endpoints
  const coldSources = items.filter(x => x.item.id === "water-supply-cold");
  const hotSources  = items.filter(x => x.item.id === "water-supply-hot");
  const drainEnds   = items.filter(x =>
    x.item.id === "drain-point" || x.item.id === "floor-drain"
  );

  for (const { placed, item } of items) {
    // Skip the supply/panel endpoints themselves
    if (
      item.id === "breaker-panel" || item.id === "weak-panel" ||
      item.id === "water-supply-cold" || item.id === "water-supply-hot" ||
      item.id === "drain-point" || item.id === "floor-drain" ||
      item.id === "exhaust-vent"
    ) continue;

    if (needsPower(item)) {
      if (panels.length === 0) {
        issues.push({ instanceId: placed.instanceId, severity: "error", message: `${item.name}: 房间未放强电箱` });
      } else {
        const reach = reachable(placed.instanceId, "wire", connections);
        const ok = panels.some(p => reach.has(p.placed.instanceId));
        if (!ok) issues.push({ instanceId: placed.instanceId, severity: "error", message: `${item.name}: 未连入强电箱` });
      }
    }
    if (needsCold(item)) {
      const reach = reachable(placed.instanceId, "cold-water", connections);
      const ok = coldSources.some(s => reach.has(s.placed.instanceId));
      if (!ok) issues.push({ instanceId: placed.instanceId, severity: "error", message: `${item.name}: 缺冷水接入` });
    }
    if (needsHot(item)) {
      const reach = reachable(placed.instanceId, "hot-water", connections);
      const ok = hotSources.some(s => reach.has(s.placed.instanceId));
      if (!ok) issues.push({ instanceId: placed.instanceId, severity: "warning", message: `${item.name}: 缺热水接入` });
    }
    if (needsDrain(item)) {
      const reach = reachable(placed.instanceId, "drain", connections);
      const ok = drainEnds.some(s => reach.has(s.placed.instanceId));
      if (!ok) issues.push({ instanceId: placed.instanceId, severity: "error", message: `${item.name}: 缺下水` });
    }
  }

  return issues;
}

/** Compute total length (meters) per kind for cost calculation. */
export function routingTotals(
  placedItems: PlacedItem[],
  connections: RoutingConnection[],
): Record<RoutingKind, number> {
  const totals: Record<RoutingKind, number> = { wire: 0, "cold-water": 0, "hot-water": 0, drain: 0 };
  for (const c of connections) {
    const a = placedItems.find(p => p.instanceId === c.from);
    const b = placedItems.find(p => p.instanceId === c.to);
    if (!a || !b) continue;
    // Manhattan distance (matches the L-shape rendering)
    const m = (Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) / 100;
    totals[c.kind] += m;
  }
  return totals;
}

/** Per-meter unit price (元/m) by kind. */
export const ROUTING_PRICE_PER_M: Record<RoutingKind, number> = {
  "wire": 8,
  "cold-water": 25,
  "hot-water": 35,
  "drain": 30,
};

/** Per-elbow penalty (元) — 90° 弯头按管种定价。 */
export const ROUTING_ELBOW_PRICE: Record<RoutingKind, number> = {
  "wire": 2,
  "cold-water": 6,
  "hot-water": 6,
  "drain": 10,
};

/** Per-fixture-port termination fee (元, 每端口) — 卡箍/接头/过线盒。 */
export const ROUTING_PORT_PRICE: Record<RoutingKind, number> = {
  "wire": 3,
  "cold-water": 8,
  "hot-water": 8,
  "drain": 12,
};

export function routingCost(
  placedItems: PlacedItem[],
  connections: RoutingConnection[],
): number {
  const t = routingTotals(placedItems, connections);
  let sum =
      t.wire * ROUTING_PRICE_PER_M.wire
    + t["cold-water"] * ROUTING_PRICE_PER_M["cold-water"]
    + t["hot-water"] * ROUTING_PRICE_PER_M["hot-water"]
    + t.drain * ROUTING_PRICE_PER_M.drain;
  // Per-connection extras: 1 L-shape = 1 elbow, 2 ports (from + to)
  for (const c of connections) {
    const a = placedItems.find(p => p.instanceId === c.from);
    const b = placedItems.find(p => p.instanceId === c.to);
    if (!a || !b) continue;
    // Only count elbow if the segment actually bends (both dx & dz non-zero)
    if (Math.abs(a.x - b.x) > 1 && Math.abs(a.z - b.z) > 1) {
      sum += ROUTING_ELBOW_PRICE[c.kind];
    }
    sum += 2 * ROUTING_PORT_PRICE[c.kind];
  }
  return Math.round(sum);
}
