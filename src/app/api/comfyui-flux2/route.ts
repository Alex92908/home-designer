import { NextRequest, NextResponse } from "next/server";
import { buildFlux2WhiteModelWorkflow } from "@/lib/comfyWorkflow";

const COMFYUI = "http://localhost:8188";

/**
 * POST /api/comfyui-flux2
 *
 * Accepts a white-model screenshot and a text prompt, uploads the image to
 * ComfyUI, builds a Flux-2-Klein workflow, and queues it for rendering.
 *
 * Required models in ComfyUI:
 *   diffusion_models/flux-2-klein-9b.safetensors
 *   text_encoders/qwen_3_8b.safetensors
 *   vae/flux2-vae.safetensors
 *
 * Body JSON:
 *   screenshot     string  — data URL of the white-model image (required)
 *   prompt         string  — positive text prompt (required)
 *   negativePrompt string  — optional negative prompt
 *
 * Response JSON:
 *   { promptId: string, imageName: string }
 */
export async function POST(req: NextRequest) {
  try {
    const {
      screenshot,
      prompt,
      negativePrompt,
    } = await req.json() as {
      screenshot: string;
      prompt: string;
      negativePrompt?: string;
    };

    if (!screenshot) {
      return NextResponse.json({ error: "missing_screenshot" }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ error: "missing_prompt" }, { status: 400 });
    }

    // Upload white-model image to ComfyUI
    const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, "");
    const buffer     = Buffer.from(base64Data, "base64");
    const formData   = new FormData();
    formData.append(
      "image",
      new Blob([buffer], { type: "image/png" }),
      `flux2_whitemodel_${Date.now()}.png`,
    );
    formData.append("overwrite", "true");

    const uploadRes = await fetch(`${COMFYUI}/upload/image`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15000),
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.error("ComfyUI upload error:", text);
      return NextResponse.json({ error: "upload_failed", detail: text }, { status: 502 });
    }
    const { name: imageName } = await uploadRes.json() as { name: string };

    // Build and submit Flux2-Klein workflow
    const workflow = buildFlux2WhiteModelWorkflow(imageName, prompt, negativePrompt);
    const submitRes = await fetch(`${COMFYUI}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "home-designer-flux2" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      console.error("ComfyUI submit error:", text);
      return NextResponse.json({ error: "submit_failed", detail: text }, { status: 502 });
    }
    const { prompt_id } = await submitRes.json() as { prompt_id: string };

    return NextResponse.json({ promptId: prompt_id, imageName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("comfyui-flux2 API error:", msg);
    return NextResponse.json({ error: "internal_error", detail: msg }, { status: 500 });
  }
}
