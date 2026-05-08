/**
 * GET  /api/mcp   — MCP server discovery (returns server manifest)
 * POST /api/mcp   — MCP JSON-RPC 2.0 protocol handler
 *
 * Implements a simplified Model Context Protocol server so AI agents can
 * discover and control the home designer's exterior design tools.
 *
 * Supported JSON-RPC methods:
 *   initialize    → server info
 *   tools/list    → available tools
 *   tools/call    → execute a tool (returns structured params for client to apply)
 *
 * State bridge:
 *   POST /api/mcp/sync   — client pushes current design state into server memory
 */
import { NextRequest, NextResponse } from "next/server";
import { getState, patchState, DesignState } from "./state";

// ── Style presets ────────────────────────────────────────────────────────────
const STYLE_PRESETS = [
  { id: "modern",         label: "Modern",          roofStyle: "flat",    wallMaterial: "render",   wallColor: "#F4F2EE", roofColor: "#2A2A2A", accentColor: "#1A1A1A" },
  { id: "contemporary",  label: "Contemporary",    roofStyle: "gable",   wallMaterial: "render",   wallColor: "#E8E4DC", roofColor: "#3D3D3D", accentColor: "#8B7355" },
  { id: "mediterranean", label: "Mediterranean",   roofStyle: "hip",     wallMaterial: "render",   wallColor: "#F5E6C8", roofColor: "#8B4513", accentColor: "#D2691E" },
  { id: "industrial",    label: "Industrial",      roofStyle: "flat",    wallMaterial: "concrete", wallColor: "#9E9E9E", roofColor: "#424242", accentColor: "#FF6D00" },
  { id: "minimalist",    label: "Minimalist",      roofStyle: "flat",    wallMaterial: "render",   wallColor: "#FFFFFF", roofColor: "#EEEEEE", accentColor: "#BDBDBD" },
  { id: "chinese",       label: "Chinese Classic", roofStyle: "chinese", wallMaterial: "render",   wallColor: "#EDE0C4", roofColor: "#8B0000", accentColor: "#DAA520" },
  { id: "brick_cottage", label: "Brick Cottage",   roofStyle: "gable",   wallMaterial: "brick",    wallColor: "#C0392B", roofColor: "#4A235A", accentColor: "#2C3E50" },
  { id: "stone_manor",   label: "Stone Manor",     roofStyle: "mansard", wallMaterial: "stone",    wallColor: "#95A5A6", roofColor: "#2C3E50", accentColor: "#7F8C8D" },
];

// ── MCP tool definitions ─────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_design_state",
    description: "Returns a summary of the current exterior design state including preset, roof style, colors, wall material, and number of floors.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "set_exterior",
    description: "Updates one or more exterior design properties. Returns the updated state and a client-dispatch payload the browser should apply.",
    inputSchema: {
      type: "object" as const,
      properties: {
        preset:       { type: "string", description: "Style preset id (see list_style_presets)" },
        roofStyle:    { type: "string", enum: ["flat", "gable", "hip", "mansard", "chinese"] },
        wallColor:    { type: "string", description: "Hex color string e.g. #F4F2EE" },
        roofColor:    { type: "string", description: "Hex color string e.g. #2A2A2A" },
        accentColor:  { type: "string", description: "Hex color string for windows/trim/doors" },
        wallMaterial: { type: "string", enum: ["render", "brick", "stone", "wood", "concrete"] },
        floors:       { type: "number", description: "Number of floors: 1, 2, or 3" },
      },
      required: [] as string[],
    },
  },
  {
    name: "generate_variant",
    description: "Generates a randomised design variant from the current state by varying roof style, wall color, and wall material. Optionally accepts a seed for reproducibility.",
    inputSchema: {
      type: "object" as const,
      properties: {
        seed: { type: "number", description: "Optional integer seed for reproducibility" },
      },
      required: [] as string[],
    },
  },
  {
    name: "list_style_presets",
    description: "Returns the 8 available style presets with their default colors and materials.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
];

// ── Variant generation ───────────────────────────────────────────────────────
function seededRandom(seed: number) {
  // mulberry32 PRNG — simple, no external dep
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0xFFFFFFFF;
  };
}

const ROOF_STYLES = ["flat", "gable", "hip", "mansard", "chinese"] as const;
const WALL_MATERIALS = ["render", "brick", "stone", "wood", "concrete"] as const;

function randomHex(rng: () => number): string {
  const r = Math.floor(rng() * 200 + 30);
  const g = Math.floor(rng() * 200 + 30);
  const b = Math.floor(rng() * 200 + 30);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function generateVariant(seed?: number): DesignState {
  const effectiveSeed = seed ?? Math.floor(Math.random() * 0xFFFFFF);
  const rng = seededRandom(effectiveSeed);
  const current = getState();
  return {
    ...current,
    roofStyle:    ROOF_STYLES[Math.floor(rng() * ROOF_STYLES.length)],
    wallColor:    randomHex(rng),
    roofColor:    randomHex(rng),
    accentColor:  randomHex(rng),
    wallMaterial: WALL_MATERIALS[Math.floor(rng() * WALL_MATERIALS.length)],
  };
}

// ── Tool execution ───────────────────────────────────────────────────────────
function callTool(name: string, args: Record<string, unknown>): Record<string, unknown> | null {
  switch (name) {
    case "get_design_state": {
      const state = getState();
      return {
        state,
        summary: Object.keys(state).length === 0
          ? "No design state synced yet. Client should POST current Zustand state to /api/mcp/sync."
          : `preset=${state.preset ?? "?"}, roofStyle=${state.roofStyle ?? "?"}, wallMaterial=${state.wallMaterial ?? "?"}, floors=${state.floors ?? "?"}, wallColor=${state.wallColor ?? "?"}`,
      };
    }

    case "set_exterior": {
      const updated = patchState(args);
      return {
        updated,
        clientDispatch: {
          type: "SET_EXTERIOR",
          payload: updated,
          note: "The browser client should apply this payload to the Zustand design store.",
        },
      };
    }

    case "generate_variant": {
      const seed = typeof args.seed === "number" ? args.seed : undefined;
      const variant = generateVariant(seed);
      patchState(variant as Record<string, unknown>);
      return {
        variant,
        clientDispatch: {
          type: "SET_EXTERIOR",
          payload: variant,
          note: "Apply this variant to the Zustand store to update the 3D preview.",
        },
      };
    }

    case "list_style_presets": {
      return { presets: STYLE_PRESETS };
    }

    default:
      return null;
  }
}

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcOk(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcErr(id: string | number | null | undefined, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

// ── GET — discovery ──────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    name: "home-designer-mcp",
    version: "1.0.0",
    description: "MCP server for AI-driven exterior home design control",
    protocol: "mcp/1.0",
    endpoints: {
      rpc:  "/api/mcp",
      sync: "/api/mcp/sync",
    },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
}

// ── POST — JSON-RPC 2.0 ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let rpc: JsonRpcRequest;
  try {
    rpc = await req.json();
  } catch {
    return rpcErr(null, -32700, "Parse error");
  }

  if (rpc.jsonrpc !== "2.0" || !rpc.method) {
    return rpcErr(rpc.id, -32600, "Invalid request");
  }

  switch (rpc.method) {
    case "initialize":
      return rpcOk(rpc.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "home-designer-mcp", version: "1.0.0" },
      });

    case "tools/list":
      return rpcOk(rpc.id, { tools: TOOLS });

    case "tools/call": {
      const { name, arguments: args } = (rpc.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      if (!name) return rpcErr(rpc.id, -32602, "Missing tool name");
      if (!TOOLS.find((t) => t.name === name)) {
        return rpcErr(rpc.id, -32602, `Unknown tool: ${name}`);
      }
      const result = callTool(name, args ?? {});
      if (result === null) {
        return rpcErr(rpc.id, -32603, `Tool execution failed for: ${name}`);
      }
      return rpcOk(rpc.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    }

    default:
      return rpcErr(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}
