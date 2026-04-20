import { NextRequest, NextResponse } from "next/server";

const COMFYUI = "http://localhost:8188";

interface ComfyImage {
  filename: string;
  subfolder: string;
  type: string;
}

interface ComfyNodeOutput {
  images?: ComfyImage[];
}

interface ComfyHistoryEntry {
  status?: { completed?: boolean; status_str?: string };
  outputs?: Record<string, ComfyNodeOutput>;
}

/**
 * GET /api/comfyui/status?id={promptId}
 * Polls ComfyUI /history/{id} for job completion.
 * Returns:
 *   { status: "running" }
 *   { status: "done", filename: string, subfolder: string }
 *   { status: "error", detail: string }
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${COMFYUI}/history/${id}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({ status: "running" });
    }

    const history = await res.json() as Record<string, ComfyHistoryEntry>;
    const entry = history[id];

    // Not in history yet → still queued / running
    if (!entry || entry.status?.completed !== true) {
      return NextResponse.json({ status: "running" });
    }

    // ComfyUI marks errored jobs as completed with status_str "error"
    if (entry.status?.status_str === "error") {
      return NextResponse.json({ status: "error", detail: "ComfyUI job failed — check model names and required plugins" });
    }

    // Find the SaveImage output (type="output"), skipping temp PreviewImage nodes.
    // Must scan ALL nodes first — falling back per-node would grab the temp image early.
    const outputs = entry.outputs ?? {};
    const allImages = Object.values(outputs).flatMap(n => n.images ?? []);
    const finalImage = allImages.find(i => i.type === "output") ?? allImages[0];

    if (finalImage) {
      const { filename, subfolder, type } = finalImage;
      return NextResponse.json({ status: "done", filename, subfolder, type });
    }

    // Completed but no images — treat as error rather than loop forever
    return NextResponse.json({ status: "error", detail: "Job completed but produced no images — check ComfyUI console for node errors" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "error", detail: msg });
  }
}
