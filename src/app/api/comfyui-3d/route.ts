/**
 * POST /api/comfyui-3d
 *
 * Runs a 3D generation workflow in the local ComfyUI instance.
 * Requires ComfyUI running at localhost:8188 with the relevant nodes installed.
 *
 * Two workflow modes (auto-selected based on what's available):
 *
 * ┌─ mode "tripo"  (default if TRIPO_API_KEY set)
 * │   LoadImage → TripoImageToModelNode → SaveGLB
 * │   Quality: excellent PBR, 20-60s
 * │   Cost: TripoAI credits (300 free/month, resets on 1st)
 * │
 * └─ mode "hunyuan3d"  (free, local)
 *     LoadImage → CLIPVisionEncode → Hunyuan3Dv2Conditioning
 *     → KSampler → VAEDecodeHunyuan3D → VoxelToMesh → SaveGLB
 *     Quality: good, 2-5min on M2 Pro
 *     Cost: FREE — runs entirely on your machine
 *     Requires: Hunyuan3D-2 model weights in ComfyUI/models/
 *
 * Body:    { imageBase64: string, mode?: "tripo" | "hunyuan3d" | "auto" }
 * Returns: { glbBase64: string, mode: string }
 */

import { NextRequest, NextResponse } from "next/server";

const COMFY = "http://localhost:8188";
const POLL_INTERVAL = 3_000;
const TIMEOUT_MS    = 600_000; // 10 min

// ─── Upload image to ComfyUI ──────────────────────────────────────
async function uploadImage(imageBase64: string): Promise<string> {
  const b64  = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const buf  = Buffer.from(b64, "base64");
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buf)], { type: "image/png" }), `3d_src_${Date.now()}.png`);
  form.append("overwrite", "true");

  const res = await fetch(`${COMFY}/upload/image`, {
    method: "POST", body: form, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ComfyUI upload ${res.status}`);
  const { name } = await res.json() as { name: string };
  return name;
}

// ─── Submit workflow, return prompt_id ───────────────────────────
async function submitWorkflow(workflow: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${COMFY}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: "home-designer-3d" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ComfyUI submit ${res.status}: ${txt}`);
  }
  const { prompt_id } = await res.json() as { prompt_id: string };
  return prompt_id;
}

// ─── Poll /history until done, return output files ───────────────
async function pollHistory(promptId: string): Promise<Record<string, { files?: Array<{ filename: string; subfolder: string; type: string }> }>> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const res = await fetch(`${COMFY}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) continue;
    const hist = await res.json() as Record<string, {
      status?: { completed?: boolean; status_str?: string };
      outputs?: Record<string, { files?: Array<{ filename: string; subfolder: string; type: string }>; glbs?: Array<{ filename: string; subfolder: string; type: string }> }>;
    }>;
    const entry = hist[promptId];
    if (!entry) continue;
    const status = entry.status;
    if (status?.status_str === "error") throw new Error("ComfyUI workflow error");
    if (status?.completed && entry.outputs) {
      // Return outputs keyed by node id
      const result: Record<string, { files?: Array<{ filename: string; subfolder: string; type: string }> }> = {};
      for (const [nodeId, nodeOut] of Object.entries(entry.outputs)) {
        result[nodeId] = { files: nodeOut.files ?? nodeOut.glbs ?? [] };
      }
      return result;
    }
  }
  throw new Error("ComfyUI: timeout waiting for workflow");
}

// ─── Fetch output GLB as base64 ──────────────────────────────────
async function fetchOutputGlb(filename: string, subfolder: string, type = "output"): Promise<string> {
  const url = `${COMFY}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`ComfyUI /view ${res.status} for ${filename}`);
  const buf = await res.arrayBuffer();
  return `data:model/gltf-binary;base64,${Buffer.from(buf).toString("base64")}`;
}

// ══════════════════════════════════════════════════════════════════
//  Workflow A: TripoAI image-to-model with full PBR
//  Nodes: LoadImage → TripoImageToModelNode → SaveGLB
// ══════════════════════════════════════════════════════════════════
function buildTripoWorkflow(imageName: string): Record<string, unknown> {
  return {
    "1": {
      class_type: "LoadImage",
      inputs: { image: imageName, upload: "image" },
    },
    "2": {
      class_type: "TripoImageToModelNode",
      inputs: {
        image:            ["1", 0],
        model_version:    "v2.5-20250123",
        style:            "person:person2cartoon",  // leave default
        texture:          true,
        pbr:              true,
        model_seed:       42,
        orientation:      "default",
        texture_seed:     42,
        texture_quality:  "standard",
        texture_alignment: "image",
        face_limit:       10000,
        quad:             false,
        geometry_quality: "high",
      },
    },
    "3": {
      class_type: "SaveGLB",
      inputs: {
        mesh:            ["2", 2],  // output[2] = GLB
        filename_prefix: `tripo3d_pbr_${Date.now()}`,
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════════
//  Workflow B: Hunyuan3D-2 — free, fully local
//  Nodes: LoadImage → CLIPVisionEncode → Hunyuan3Dv2Conditioning
//         → EmptyLatentHunyuan3Dv2 → KSampler → VAEDecodeHunyuan3D
//         → VoxelToMesh → SaveGLB
//
//  Required models (download once):
//    ComfyUI/models/clip_vision/   ← CLIP vision encoder
//    ComfyUI/models/diffusion_models/ ← Hunyuan3D-2 diffusion
//    ComfyUI/models/vae/           ← Hunyuan3D-2 VAE
//
//  Download script: python download_hf_models.py (see below)
// ══════════════════════════════════════════════════════════════════
function buildHunyuan3dWorkflow(imageName: string): Record<string, unknown> {
  return {
    // Load input image
    "1": {
      class_type: "LoadImage",
      inputs: { image: imageName, upload: "image" },
    },
    // Load CLIP Vision model (siglip or similar used by Hunyuan3D)
    "2": {
      class_type: "CLIPVisionLoader",
      inputs: { clip_name: "sigclip_vision_patch14_384.safetensors" },
    },
    // Encode image with CLIP Vision
    "3": {
      class_type: "CLIPVisionEncode",
      inputs: { clip_vision: ["2", 0], image: ["1", 0] },
    },
    // Hunyuan3D conditioning from CLIP features
    "4": {
      class_type: "Hunyuan3Dv2Conditioning",
      inputs: { clip_vision_output: ["3", 0] },
    },
    // Load Hunyuan3D diffusion model
    "5": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "hunyuan3d-dit-v2-0.safetensors",
        weight_dtype: "default",
      },
    },
    // Load Hunyuan3D VAE
    "6": {
      class_type: "VAELoader",
      inputs: { vae_name: "hunyuan3d-vae-v2-0.safetensors" },
    },
    // Empty latent for shape generation
    "7": {
      class_type: "EmptyLatentHunyuan3Dv2",
      inputs: { resolution: 64, batch_size: 1 },
    },
    // Run diffusion sampling
    "8": {
      class_type: "KSampler",
      inputs: {
        model:       ["5", 0],
        positive:    ["4", 0],
        negative:    ["4", 1],
        latent_image: ["7", 0],
        seed:        42,
        steps:       50,
        cfg:         7.5,
        sampler_name: "euler",
        scheduler:   "simple",
        denoise:     1.0,
      },
    },
    // Decode latent → voxel field
    "9": {
      class_type: "VAEDecodeHunyuan3D",
      inputs: {
        samples:           ["8", 0],
        vae:               ["6", 0],
        num_chunks:        8000,
        octree_resolution: 256,
      },
    },
    // Convert voxel → mesh
    "10": {
      class_type: "VoxelToMesh",
      inputs: { voxel: ["9", 0], algorithm: "marching_cubes", threshold: 0.0 },
    },
    // Save as GLB
    "11": {
      class_type: "SaveGLB",
      inputs: {
        mesh:            ["10", 0],
        filename_prefix: `hunyuan3d_${Date.now()}`,
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════════
//  Route handler
// ══════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const { imageBase64, mode = "auto" } = await req.json() as {
    imageBase64: string;
    mode?: "tripo" | "hunyuan3d" | "auto";
  };

  if (!imageBase64)
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });

  // Check ComfyUI is reachable
  try {
    const ping = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(3_000) });
    if (!ping.ok) throw new Error("ComfyUI not responding");
  } catch {
    return NextResponse.json({
      error: "comfyui_offline",
      message: "ComfyUI 未运行，请启动 ComfyUI (localhost:8188)",
    }, { status: 503 });
  }

  // Choose workflow
  const hasTripo = !!process.env.TRIPO_API_KEY;
  let selectedMode: "tripo" | "hunyuan3d";
  if (mode === "auto") {
    selectedMode = hasTripo ? "tripo" : "hunyuan3d";
  } else {
    selectedMode = mode;
  }

  console.log(`[comfyui-3d] mode=${selectedMode}, uploading image…`);

  try {
    const imageName = await uploadImage(imageBase64);
    console.log(`[comfyui-3d] image uploaded as ${imageName}`);

    const workflow = selectedMode === "tripo"
      ? buildTripoWorkflow(imageName)
      : buildHunyuan3dWorkflow(imageName);

    const promptId = await submitWorkflow(workflow);
    console.log(`[comfyui-3d] submitted, prompt_id=${promptId}`);

    const outputs = await pollHistory(promptId);
    console.log(`[comfyui-3d] done, outputs:`, Object.keys(outputs));

    // Find the GLB file in outputs (SaveGLB node)
    for (const nodeOut of Object.values(outputs)) {
      const files = nodeOut.files ?? [];
      const glbFile = files.find(f => f.filename.endsWith(".glb") || f.filename.endsWith(".gltf"));
      if (glbFile) {
        console.log(`[comfyui-3d] found GLB: ${glbFile.filename}`);
        const glbBase64 = await fetchOutputGlb(glbFile.filename, glbFile.subfolder, glbFile.type);
        return NextResponse.json({ glbBase64, mode: selectedMode, filename: glbFile.filename });
      }
    }

    throw new Error(`No GLB file found in ComfyUI outputs: ${JSON.stringify(outputs)}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[comfyui-3d] failed:`, msg);

    // Detect Hunyuan3D model missing
    if (msg.includes("model not found") || msg.includes("safetensors") || msg.includes("FileNotFound")) {
      return NextResponse.json({
        error:   "model_not_downloaded",
        message: "Hunyuan3D-2 模型权重未下载",
        hint:    "Run: python scripts/download_hunyuan3d.py",
      }, { status: 422 });
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
