/**
 * POST /api/glb-segment
 *
 * Takes a complete villa GLB (from Trellis) and segments it into
 * independent parts by analysing the mesh geometry — no external
 * libraries, pure binary buffer manipulation.
 *
 * Segmentation strategy (layered, falls back gracefully):
 *   1. Named mesh nodes  — if Trellis produced multi-node GLB, each node
 *      is already a semantic part. Just split them out.
 *   2. Material clusters — group faces that share the same material index.
 *   3. Normal clusters   — group faces by dominant normal direction:
 *        • roof/terrace  : average normal Y >  0.65
 *        • floor/pool    : average normal Y < -0.65  OR  Y pos very low
 *        • walls/facade  : remaining (mostly vertical normals)
 *   4. Spatial bands     — split walls by Y position into ground / upper floors.
 *
 * Returns: { parts: [{ label, chinese, glbBase64 }] }
 */

import { NextRequest, NextResponse } from "next/server";

// ─── GLB / GLTF types (minimal subset we need) ──────────────────
interface GltfJson {
  asset: { version: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{ mesh?: number; name?: string; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  meshes?: Array<{ name?: string; primitives: GltfPrimitive[] }>;
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: Array<{ byteLength: number; uri?: string }>;
  materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }>;
  textures?: unknown[];
  images?: unknown[];
  samplers?: unknown[];
}
interface GltfPrimitive {
  attributes: Record<string, number>; // e.g. POSITION → accessor index
  indices?: number;
  material?: number;
  mode?: number;
}
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number; // 5126 = FLOAT, 5123 = UINT16, 5125 = UINT32
  count: number;
  type: string; // "VEC3", "SCALAR", etc.
  min?: number[];
  max?: number[];
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

// ─── GLB parser ──────────────────────────────────────────────────
function parseGlb(buf: Buffer): { json: GltfJson; bin: Buffer } {
  // 12-byte header: magic (4) + version (4) + length (4)
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546C67) throw new Error("Not a GLB file");
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Buffer = Buffer.alloc(0);
  while (offset < buf.length) {
    const chunkLen  = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const chunkData = buf.slice(offset + 8, offset + 8 + chunkLen);
    if (chunkType === 0x4E4F534A) json = JSON.parse(chunkData.toString("utf-8")); // JSON
    if (chunkType === 0x004E4942) bin  = chunkData;                                 // BIN
    offset += 8 + chunkLen;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

// ─── Accessor reader ─────────────────────────────────────────────
function readAccessor(json: GltfJson, bin: Buffer, idx: number): Float32Array | Uint16Array | Uint32Array {
  const acc = json.accessors![idx];
  const bv  = json.bufferViews![acc.bufferView!];
  const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const compSize   = acc.componentType === 5126 ? 4 : acc.componentType === 5125 ? 4 : 2;
  const numComps   = acc.type === "VEC3" ? 3 : acc.type === "VEC2" ? 2 : 1;
  const byteLen    = acc.count * numComps * compSize;
  const slice      = bin.slice(byteOffset, byteOffset + byteLen);
  if (acc.componentType === 5126) return new Float32Array(slice.buffer, slice.byteOffset, acc.count * numComps);
  if (acc.componentType === 5125) return new Uint32Array(slice.buffer, slice.byteOffset, acc.count * numComps);
  return new Uint16Array(slice.buffer, slice.byteOffset, acc.count * numComps);
}

// ─── Segment labels ──────────────────────────────────────────────
const SEGMENTS = [
  { id: "roof",    chinese: "屋顶露台",   label: "rooftop terrace" },
  { id: "upper",   chinese: "上层外墙",   label: "upper floor facade" },
  { id: "ground",  chinese: "地面庭院",   label: "ground level garden" },
  { id: "pool",    chinese: "泳池区域",   label: "pool area" },
  { id: "wall",    chinese: "建筑外立面", label: "building facade" },
] as const;
type SegId = typeof SEGMENTS[number]["id"];

// ─── Face → segment assignment ───────────────────────────────────
function classifyFace(
  avgNY: number,   // average normal Y component of the face
  avgPY: number,   // average position Y of the face
  matIdx: number,  // material index (-1 = none)
  json: GltfJson,
  yMin: number,
  yMax: number,
): SegId {
  const yRange = yMax - yMin || 1;
  const yNorm  = (avgPY - yMin) / yRange; // 0 = bottom, 1 = top

  // Horizontal surfaces
  if (avgNY > 0.65) {
    return yNorm > 0.55 ? "roof" : yNorm < 0.15 ? "pool" : "ground";
  }
  // Floor-facing (underside of slabs etc.)
  if (avgNY < -0.65) return "ground";

  // Vertical walls — split by height
  return yNorm > 0.45 ? "upper" : "wall";
}

// ─── Pack a sub-mesh back into a self-contained GLB ──────────────
function buildMiniGlb(
  positions: Float32Array,
  normals:   Float32Array | null,
  uvs:       Float32Array | null,
  indices:   Uint32Array,
  label:     string,
): Buffer {
  // Build BIN buffer: positions + normals + uvs + indices
  const posBytes  = positions.byteLength;
  const norBytes  = normals ? normals.byteLength : 0;
  const uvBytes   = uvs ? uvs.byteLength : 0;
  const idxBytes  = indices.byteLength;
  const pad = (n: number) => Math.ceil(n / 4) * 4; // align to 4 bytes

  const posPad = pad(posBytes), norPad = pad(norBytes), uvPad = pad(uvBytes), idxPad = pad(idxBytes);
  const totalBin = posPad + norPad + uvPad + idxPad;
  const bin = Buffer.alloc(totalBin);

  let off = 0;
  Buffer.from(positions.buffer, positions.byteOffset, posBytes).copy(bin, off); off += posPad;
  const norOffset = normals ? off : -1;
  if (normals) { Buffer.from(normals.buffer, normals.byteOffset, norBytes).copy(bin, off); off += norPad; }
  const uvOffset = uvs ? off : -1;
  if (uvs) { Buffer.from(uvs.buffer, uvs.byteOffset, uvBytes).copy(bin, off); off += uvPad; }
  const idxOffset = off;
  Buffer.from(indices.buffer, indices.byteOffset, idxBytes).copy(bin, idxOffset);

  const numVerts = positions.length / 3;
  const numFaces = indices.length / 3;

  // Compute bounding box
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX=Math.min(minX,positions[i]);minY=Math.min(minY,positions[i+1]);minZ=Math.min(minZ,positions[i+2]);
    maxX=Math.max(maxX,positions[i]);maxY=Math.max(maxY,positions[i+1]);maxZ=Math.max(maxZ,positions[i+2]);
  }

  const bufViews: unknown[] = [];
  const accessors: unknown[] = [];

  // POSITION buffer view + accessor
  bufViews.push({ buffer: 0, byteOffset: 0, byteLength: posBytes });
  accessors.push({ bufferView: 0, componentType: 5126, count: numVerts, type: "VEC3", min:[minX,minY,minZ], max:[maxX,maxY,maxZ] });

  if (normals && norOffset >= 0) {
    bufViews.push({ buffer: 0, byteOffset: norOffset, byteLength: norBytes });
    accessors.push({ bufferView: bufViews.length - 1, componentType: 5126, count: numVerts, type: "VEC3" });
  }
  if (uvs && uvOffset >= 0) {
    bufViews.push({ buffer: 0, byteOffset: uvOffset, byteLength: uvBytes });
    accessors.push({ bufferView: bufViews.length - 1, componentType: 5126, count: numVerts, type: "VEC2" });
  }

  // INDEX buffer view + accessor
  bufViews.push({ buffer: 0, byteOffset: idxOffset, byteLength: idxBytes });
  const idxAccIdx = accessors.length;
  accessors.push({ bufferView: bufViews.length - 1, componentType: 5125, count: indices.length, type: "SCALAR" });

  const attributes: Record<string,number> = { POSITION: 0 };
  if (normals) attributes.NORMAL = 1;
  if (uvs)     attributes.TEXCOORD_0 = normals ? 2 : 1;

  const gltf = {
    asset: { version: "2.0", generator: "home-designer glb-segment" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: label }],
    meshes: [{ name: label, primitives: [{ attributes, indices: idxAccIdx, mode: 4 }] }],
    accessors,
    bufferViews: bufViews,
    buffers: [{ byteLength: totalBin }],
  };

  const jsonStr  = JSON.stringify(gltf);
  const jsonBuf  = Buffer.from(jsonStr, "utf-8");
  const jsonPad  = pad(jsonBuf.length);
  const jsonPadded = Buffer.alloc(jsonPad, 0x20); // pad with spaces
  jsonBuf.copy(jsonPadded);

  const totalLen = 12 + 8 + jsonPad + 8 + totalBin;
  const out = Buffer.alloc(totalLen);
  let o = 0;
  out.writeUInt32LE(0x46546C67, o); o += 4; // magic
  out.writeUInt32LE(2,          o); o += 4; // version
  out.writeUInt32LE(totalLen,   o); o += 4;
  // JSON chunk
  out.writeUInt32LE(jsonPad,       o); o += 4;
  out.writeUInt32LE(0x4E4F534A,    o); o += 4;
  jsonPadded.copy(out, o); o += jsonPad;
  // BIN chunk
  out.writeUInt32LE(totalBin,      o); o += 4;
  out.writeUInt32LE(0x004E4942,    o); o += 4;
  bin.copy(out, o);

  return out;
}

// ─── Main segmentation ───────────────────────────────────────────
function segmentGlb(glbBuf: Buffer): Array<{ seg: SegId; glb: Buffer; faceCount: number }> {
  const { json, bin } = parseGlb(glbBuf);

  // Collect all primitives (flatten across all meshes/nodes)
  const primitives: Array<GltfPrimitive & { meshName?: string }> = [];
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      primitives.push({ ...prim, meshName: mesh.name });
    }
  }

  if (!primitives.length) throw new Error("No mesh primitives in GLB");

  // If the GLB already has multiple named meshes → use them as-is
  const namedMeshes = (json.meshes ?? []).filter(m => m.name && m.name !== "Mesh");
  if (namedMeshes.length > 1) {
    // Each mesh → its own GLB (already semantically separated by Trellis/Blender)
    const results: Array<{ seg: SegId; glb: Buffer; faceCount: number }> = [];
    for (const mesh of namedMeshes) {
      for (const prim of mesh.primitives) {
        const posAcc  = prim.attributes.POSITION;
        const positions = readAccessor(json, bin, posAcc) as Float32Array;
        const normals   = prim.attributes.NORMAL != null ? readAccessor(json, bin, prim.attributes.NORMAL) as Float32Array : null;
        const uvs       = prim.attributes.TEXCOORD_0 != null ? readAccessor(json, bin, prim.attributes.TEXCOORD_0) as Float32Array : null;
        const indices   = prim.indices != null ? readAccessor(json, bin, prim.indices) : null;
        const idxU32    = indices ? new Uint32Array(Array.from(indices)) : new Uint32Array(Array.from({length: positions.length/3}, (_,i)=>i));
        const glb = buildMiniGlb(positions, normals, uvs, idxU32, mesh.name ?? "part");
        const seg = guessSegFromName(mesh.name ?? "");
        results.push({ seg, glb, faceCount: idxU32.length / 3 });
      }
    }
    return results;
  }

  // Single monolithic mesh → geometric clustering
  const prim = primitives[0];
  const positions = readAccessor(json, bin, prim.attributes.POSITION) as Float32Array;
  const normals   = prim.attributes.NORMAL != null ? readAccessor(json, bin, prim.attributes.NORMAL) as Float32Array : null;
  const uvs       = prim.attributes.TEXCOORD_0 != null ? readAccessor(json, bin, prim.attributes.TEXCOORD_0) as Float32Array : null;
  const rawIdx    = prim.indices != null ? readAccessor(json, bin, prim.indices) : null;
  const faceCount = rawIdx ? rawIdx.length / 3 : positions.length / 9;

  // Find Y bounds
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    yMin = Math.min(yMin, positions[i]);
    yMax = Math.max(yMax, positions[i]);
  }

  // Classify each face → segment bucket
  const buckets = new Map<SegId, number[]>(); // seg → face indices
  for (const seg of SEGMENTS) buckets.set(seg.id, []);

  for (let f = 0; f < faceCount; f++) {
    let i0: number, i1: number, i2: number;
    if (rawIdx) {
      i0 = rawIdx[f * 3]; i1 = rawIdx[f * 3 + 1]; i2 = rawIdx[f * 3 + 2];
    } else {
      i0 = f * 3; i1 = f * 3 + 1; i2 = f * 3 + 2;
    }

    const avgNY = normals
      ? (normals[i0*3+1] + normals[i1*3+1] + normals[i2*3+1]) / 3
      : 0;
    const avgPY = (positions[i0*3+1] + positions[i1*3+1] + positions[i2*3+1]) / 3;

    const seg = classifyFace(avgNY, avgPY, prim.material ?? -1, json, yMin, yMax);
    buckets.get(seg)!.push(f);
  }

  // Build a GLB for each non-empty bucket
  const results: Array<{ seg: SegId; glb: Buffer; faceCount: number }> = [];

  for (const [segId, faces] of buckets) {
    if (faces.length < 10) continue; // skip tiny fragments

    // Gather unique vertices for this bucket
    const vertexMap = new Map<number, number>(); // old → new index
    const newPos: number[] = [], newNor: number[] = [], newUv: number[] = [];
    const newIdx: number[] = [];

    for (const f of faces) {
      let i0: number, i1: number, i2: number;
      if (rawIdx) {
        i0 = rawIdx[f*3]; i1 = rawIdx[f*3+1]; i2 = rawIdx[f*3+2];
      } else {
        i0 = f*3; i1 = f*3+1; i2 = f*3+2;
      }
      for (const vi of [i0, i1, i2]) {
        if (!vertexMap.has(vi)) {
          const ni = newPos.length / 3;
          vertexMap.set(vi, ni);
          newPos.push(positions[vi*3], positions[vi*3+1], positions[vi*3+2]);
          if (normals) newNor.push(normals[vi*3], normals[vi*3+1], normals[vi*3+2]);
          if (uvs)     newUv.push(uvs[vi*2], uvs[vi*2+1]);
        }
        newIdx.push(vertexMap.get(vi)!);
      }
    }

    const seg     = SEGMENTS.find(s => s.id === segId)!;
    const posF32  = new Float32Array(newPos);
    const norF32  = normals && newNor.length ? new Float32Array(newNor) : null;
    const uvF32   = uvs && newUv.length ? new Float32Array(newUv) : null;
    const idxU32  = new Uint32Array(newIdx);
    const glb     = buildMiniGlb(posF32, norF32, uvF32, idxU32, seg.label);
    results.push({ seg: segId, glb, faceCount: faces.length });
  }

  return results;
}

function guessSegFromName(name: string): SegId {
  const n = name.toLowerCase();
  if (n.includes("roof") || n.includes("top"))   return "roof";
  if (n.includes("pool") || n.includes("water"))  return "pool";
  if (n.includes("floor") || n.includes("ground")) return "ground";
  if (n.includes("upper") || n.includes("2") || n.includes("second")) return "upper";
  return "wall";
}

// ─── Route handler ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { glbBase64 } = await req.json() as { glbBase64: string };
    if (!glbBase64) return NextResponse.json({ error: "glbBase64 required" }, { status: 400 });

    const b64 = glbBase64.replace(/^data:[^;]+;base64,/, "");
    const glbBuf = Buffer.from(b64, "base64");

    const segmented = segmentGlb(glbBuf);
    if (!segmented.length) return NextResponse.json({ error: "No segments produced" }, { status: 422 });

    const parts = segmented
      .sort((a, b) => b.faceCount - a.faceCount) // largest first
      .map(s => {
        const meta = SEGMENTS.find(m => m.id === s.seg)!;
        return {
          label:     meta.label,
          chinese:   meta.chinese,
          seg:       s.seg,
          faceCount: s.faceCount,
          glbBase64: `data:model/gltf-binary;base64,${s.glb.toString("base64")}`,
        };
      });

    return NextResponse.json({ parts });
  } catch (err) {
    console.error("[glb-segment]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
