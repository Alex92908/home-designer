import { NextRequest, NextResponse } from "next/server";
import { generateControlNetWorkflow, generateMultiViewControlNetWorkflow, generateTxt2ImgWorkflow, generateMultiControlNetWorkflow, generateIPAdapterChainWorkflow, generateHiResWorkflow } from "@/lib/comfyWorkflow";
import { generateRoomPrompt, type RoomPromptInput, type GeneratedPrompt } from "@/lib/roomPrompt";

const COMFYUI = "http://localhost:8188";

const DEFAULT_PROMPT = {
  roomType: "living room",
  roomName: "living room",
  positive:
    "RAW photo, photorealistic, ultra-detailed 8K UHD, DSLR, sharp focus, " +
    "professional interior design photography of a modern living room, " +
    "wide-angle lens 24mm, natural color grading, Architectural Digest quality, no people",
  negative:
    "people, person, human, cartoon, illustration, painting, sketch, " +
    "low quality, blurry, out of focus, distorted, 3D render, CGI, anime",
  seed: Math.floor(Math.random() * 2 ** 31),
};

/**
 * POST /api/comfyui
 * Body: { screenshot?: string (data URL), roomData?: RoomPromptInput, mode?: "controlnet" | "txt2img" }
 *
 * controlnet: uploads screenshot → depth map → ControlNet guided generation
 * txt2img:    no screenshot needed → pure text-to-image from room prompt
 */
export async function POST(req: NextRequest) {
  try {
    const { screenshot, screenshots, referenceImage, referenceImages, seed, roomData, mode = "controlnet", model } = await req.json() as {
      screenshot?: string;
      screenshots?: string[];     // multi-view: array of data URLs
      referenceImage?: string;    // ipadapter-chain: single previous render (legacy)
      referenceImages?: string[]; // ipadapter-chain: 1-5 previous renders for multi-ref blend
      seed?: number;              // explicit seed for chain consistency
      // roomData may be either raw RoomPromptInput (legacy interior path) OR a
      // pre-built GeneratedPrompt sent by AiRenderModal.getActivePrompt() for the
      // exterior view.  Detect by presence of the `positive` string field.
      roomData?: RoomPromptInput | GeneratedPrompt;
      mode?: "controlnet" | "txt2img" | "multicontrolnet" | "ipadapter-chain" | "hires4k";
      model?: string;             // SD checkpoint filename (must exist in ComfyUI/models/checkpoints/)
    };
    // Workflow opts shared across all modes — injected only when caller provides a model
    const workflowOpts = model ? { model } : {};

    // ── Generate SD prompt ────────────────────────────────────────────────
    // roomData may already be a GeneratedPrompt (from AiRenderModal.getActivePrompt()
    // for exterior views).  Detect by presence of the `positive` string field and
    // skip generateRoomPrompt in that case to avoid re-processing already-built prompts.
    const basePrompt: GeneratedPrompt = roomData
      ? (typeof (roomData as GeneratedPrompt).positive === "string"
          ? (roomData as GeneratedPrompt)
          : generateRoomPrompt(roomData as RoomPromptInput))
      : DEFAULT_PROMPT;
    // Lock seed across chain renders for visual consistency
    const prompt = typeof seed === "number" ? { ...basePrompt, seed } : basePrompt;

    // ── txt2img: skip image upload, submit directly ──────────
    if (mode === "txt2img") {
      const workflow = generateTxt2ImgWorkflow(prompt, workflowOpts);
      const submitRes = await fetch(`${COMFYUI}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: "home-designer" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!submitRes.ok) {
        const text = await submitRes.text();
        console.error("ComfyUI submit error:", text);
        return NextResponse.json({ error: "submit_failed", detail: text }, { status: 502 });
      }
      const { prompt_id } = await submitRes.json() as { prompt_id: string };
      return NextResponse.json({ promptId: prompt_id });
    }

    // ── hires4k: dual ControlNet + ESRGAN 4× + HiResFix detail pass ──────────
    if (mode === "hires4k") {
      const src = screenshot ?? screenshots?.[0];
      if (!src) return NextResponse.json({ error: "missing_screenshot" }, { status: 400 });

      const base64Data = src.replace(/^data:image\/\w+;base64,/, "");
      const buffer     = Buffer.from(base64Data, "base64");
      const formData   = new FormData();
      formData.append("image", new Blob([buffer], { type: "image/png" }), "hd_hires_src.png");
      formData.append("overwrite", "true");

      const uploadRes = await fetch(`${COMFYUI}/upload/image`, {
        method: "POST", body: formData, signal: AbortSignal.timeout(10000),
      });
      if (!uploadRes.ok) return NextResponse.json({ error: "upload_failed" }, { status: 502 });
      const { name } = await uploadRes.json() as { name: string };

      const workflow  = generateHiResWorkflow(name, prompt, workflowOpts);
      const submitRes = await fetch(`${COMFYUI}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: "home-designer" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!submitRes.ok) {
        const text = await submitRes.text();
        return NextResponse.json({ error: "submit_failed", detail: text }, { status: 502 });
      }
      const { prompt_id } = await submitRes.json() as { prompt_id: string };
      return NextResponse.json({ promptId: prompt_id, imageName: name });
    }

    // ── multicontrolnet: same upload flow, different workflow ─
    if (mode === "multicontrolnet") {
      const src = screenshot ?? screenshots?.[0];
      if (!src) return NextResponse.json({ error: "missing_screenshot" }, { status: 400 });

      const base64Data = src.replace(/^data:image\/\w+;base64,/, "");
      const buffer     = Buffer.from(base64Data, "base64");
      const formData   = new FormData();
      formData.append("image", new Blob([buffer], { type: "image/png" }), "hd_multi_ctrl.png");
      formData.append("overwrite", "true");

      const uploadRes = await fetch(`${COMFYUI}/upload/image`, {
        method: "POST", body: formData, signal: AbortSignal.timeout(10000),
      });
      if (!uploadRes.ok) return NextResponse.json({ error: "upload_failed" }, { status: 502 });
      const { name } = await uploadRes.json() as { name: string };

      const workflow = generateMultiControlNetWorkflow(name, prompt, workflowOpts);
      const submitRes = await fetch(`${COMFYUI}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: "home-designer" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!submitRes.ok) {
        const text = await submitRes.text();
        return NextResponse.json({ error: "submit_failed", detail: text }, { status: 502 });
      }
      const { prompt_id } = await submitRes.json() as { prompt_id: string };
      return NextResponse.json({ promptId: prompt_id, imageName: name });
    }

    // ── ipadapter-chain: multi-ControlNet + optional reference image ─
    if (mode === "ipadapter-chain") {
      const src = screenshot ?? screenshots?.[0];
      if (!src) return NextResponse.json({ error: "missing_screenshot" }, { status: 400 });

      // Helper: upload a data URL to ComfyUI and return its filename
      async function uploadDataUrl(dataUrl: string, label: string): Promise<string> {
        const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
        const buffer     = Buffer.from(base64Data, "base64");
        const form       = new FormData();
        form.append("image", new Blob([buffer], { type: "image/png" }), `${label}_${Date.now()}.png`);
        form.append("overwrite", "true");
        const r = await fetch(`${COMFYUI}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`upload_failed_${label}`);
        const { name } = await r.json() as { name: string };
        return name;
      }

      const shotName = await uploadDataUrl(src, "hd_ipa_shot");

      // Resolve refs: prefer array, fall back to legacy single field
      const allRefs   = referenceImages ?? (referenceImage ? [referenceImage] : []);
      const refNames: string[] = [];
      for (let i = 0; i < allRefs.length; i++) {
        refNames.push(await uploadDataUrl(allRefs[i], `hd_ipa_ref_${i}`));
      }

      const workflow = generateIPAdapterChainWorkflow(shotName, refNames, prompt, workflowOpts);
      const submitRes = await fetch(`${COMFYUI}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: "home-designer" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!submitRes.ok) {
        const text = await submitRes.text();
        return NextResponse.json({ error: "submit_failed", detail: text }, { status: 502 });
      }
      const { prompt_id } = await submitRes.json() as { prompt_id: string };
      return NextResponse.json({ promptId: prompt_id, imageName: shotName, seed: prompt.seed });
    }

    // ── controlnet: upload one or more screenshots ───────────
    const allScreenshots = screenshots ?? (screenshot ? [screenshot] : []);
    if (allScreenshots.length === 0) {
      return NextResponse.json({ error: "missing_screenshot" }, { status: 400 });
    }

    // Upload each screenshot to ComfyUI, collect filenames
    const imageNames: string[] = [];
    for (let i = 0; i < allScreenshots.length; i++) {
      const base64Data = allScreenshots[i].replace(/^data:image\/\w+;base64,/, "");
      const buffer     = Buffer.from(base64Data, "base64");
      const formData   = new FormData();
      formData.append("image", new Blob([buffer], { type: "image/png" }), `hd_view_${i}.png`);
      formData.append("overwrite", "true");

      const uploadRes = await fetch(`${COMFYUI}/upload/image`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(10000),
      });
      if (!uploadRes.ok) {
        return NextResponse.json({ error: `upload_failed_view_${i}` }, { status: 502 });
      }
      const { name } = await uploadRes.json() as { name: string };
      imageNames.push(name);
    }

    // Build single-view or multi-view ControlNet workflow
    const workflow = imageNames.length === 1
      ? generateControlNetWorkflow(imageNames[0], prompt, workflowOpts)
      : generateMultiViewControlNetWorkflow(imageNames, prompt, workflowOpts);

    const submitRes = await fetch(`${COMFYUI}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "home-designer" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!submitRes.ok) {
      const text = await submitRes.text();
      console.error("ComfyUI submit error:", text);
      return NextResponse.json({ error: "submit_failed", detail: text }, { status: 502 });
    }
    const { prompt_id } = await submitRes.json() as { prompt_id: string };
    return NextResponse.json({ promptId: prompt_id, imageNames });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ComfyUI API error:", msg);
    return NextResponse.json({ error: "internal_error", detail: msg }, { status: 500 });
  }
}
