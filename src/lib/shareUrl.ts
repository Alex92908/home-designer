/**
 * shareUrl.ts — URL-based stateless design sharing (Plan A)
 *
 * Encodes a ViewSnapshot (exterior + yard + floor dims) into a
 * compressed, base64url string suitable for ?d= query params.
 *
 * Compression: native CompressionStream (deflate-raw) → base64url.
 * Fallback for old browsers: plain JSON → base64.
 *
 * Typical uncompressed size: ~3-8 KB
 * Typical compressed size:   ~1-2 KB → ~1400-2800 base64 chars
 */

import type { ExteriorSettings, YardPlan } from "./types";

// ─── Snapshot shape ──────────────────────────────────────────────────────────
/** The minimal state needed to faithfully render the exterior 3D view. */
export interface ViewSnapshot {
  v: 1;
  exterior: ExteriorSettings;
  /** Per-floor data (floor 0 = ground). Rooms stripped of interior furniture. */
  floors: Array<{
    enabledRooms: string[];
    roomLayout: Record<string, { x: number; y: number }>;
    roomDimensions: Record<string, { width: number; depth: number }>;
    roomShapes?: Record<string, unknown>;
    yardPlan?: YardPlan;
  }>;
  /** Optional display name for the shared design */
  name?: string;
}

// ─── Compression helpers ─────────────────────────────────────────────────────
async function deflateCompress(str: string): Promise<string> {
  if (typeof CompressionStream === "undefined") {
    // Fallback: plain btoa (browsers without CompressionStream)
    return "0" + btoa(unescape(encodeURIComponent(str)));
  }
  const bytes = new TextEncoder().encode(str);
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.length; }

  // base64url (no padding, URL-safe)
  const b64 = btoa(String.fromCharCode(...buf));
  return "1" + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function deflateDecompress(encoded: string): Promise<string> {
  const flag = encoded[0];
  const data = encoded.slice(1);

  if (flag === "0") {
    // Fallback: plain base64
    return decodeURIComponent(escape(atob(data)));
  }

  // Restore base64url → base64
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  if (typeof DecompressionStream === "undefined") {
    // Shouldn't hit this if we used flag "1", but just in case
    return new TextDecoder().decode(bytes);
  }

  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(buf);
}

// ─── Public API ──────────────────────────────────────────────────────────────
export async function encodeSnapshot(snapshot: ViewSnapshot): Promise<string> {
  return deflateCompress(JSON.stringify(snapshot));
}

export async function decodeSnapshot(encoded: string): Promise<ViewSnapshot> {
  const json = await deflateDecompress(encoded);
  const data = JSON.parse(json) as ViewSnapshot;
  if (data.v !== 1) throw new Error(`Unknown share version: ${data.v}`);
  return data;
}

/** Build a full shareable URL for the given snapshot. */
export async function buildShareUrl(snapshot: ViewSnapshot): Promise<string> {
  const encoded = await encodeSnapshot(snapshot);
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/view?d=${encoded}`;
}
