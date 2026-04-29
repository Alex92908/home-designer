/**
 * POST /api/villa-decompose
 *
 * Step 1 of the "whole → parts" pipeline:
 *   Given a villa photo, use GLM-4V (or Claude) to detect each outdoor
 *   element and return its label + bounding box as fractions [x,y,w,h].
 *
 * Step 2 (client-side):
 *   The frontend crops each bbox from the original image using HTML Canvas,
 *   then calls POST /api/image-to-3d on each crop to get a GLB.
 *   No server-side image manipulation library needed.
 *
 * Returns:
 *   { elements: DetectedElement[] }
 */

import { NextRequest, NextResponse } from "next/server";

export interface DetectedElement {
  /** English label used as TripoSR prompt context */
  label: string;
  /** Chinese label shown in UI */
  chinese: string;
  /**
   * Bounding box as fractions of image dimensions: [x, y, width, height]
   * where (0,0) is top-left and (1,1) is bottom-right.
   */
  bbox: [number, number, number, number];
  /** 1 = highest priority outdoor element, higher = less important */
  priority: number;
}

const ZHIPUAI_API_KEY = process.env.ZHIPUAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const DECOMPOSE_PROMPT = `You are an expert architectural analyst.
Look at this villa/house exterior photo and identify ALL distinct outdoor elements and architectural features.

For each element return a bounding box as fractions [x, y, width, height] where (0,0) is the top-left corner.
Focus on elements that can be meaningfully reproduced as individual 3D objects.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "elements": [
    {
      "label": "infinity swimming pool",
      "chinese": "无边泳池",
      "bbox": [0.55, 0.60, 0.40, 0.35],
      "priority": 1
    }
  ]
}

Typical elements to look for (include only what's actually visible):
- Swimming pool / infinity pool (泳池)
- Main building facade (建筑外立面)
- Roof / rooftop terrace (屋顶露台)
- Pergola / shade structure (凉亭/遮阳结构)
- Outdoor kitchen / BBQ area (户外厨房)
- Garage / carport / driveway (车库/车道)
- Garden / landscaping (花园/景观)
- Entrance gate / door (入口大门)
- Fence / boundary wall (围墙)
- Balcony / terrace (阳台/露台)
- Fountain / water feature (喷泉/水景)
- Outdoor furniture (户外家具)

Limit to at most 8 elements. Bboxes may overlap.`;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json() as { imageBase64: string };
    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
    }

    // Strip data URL prefix if present
    const b64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const mediaType = imageBase64.startsWith("data:image/png") ? "image/png" : "image/jpeg";

    let rawText = "";

    // ── Try Claude (Anthropic) first ─────────────────────────────────
    if (ANTHROPIC_API_KEY) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 1024,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
              { type: "text", text: DECOMPOSE_PROMPT },
            ],
          }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> };
        rawText = data.content?.[0]?.text ?? "";
      }
    }

    // ── Fallback: GLM-4V (ZhipuAI) ──────────────────────────────────
    if (!rawText && ZHIPUAI_API_KEY) {
      const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ZHIPUAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "glm-4v",
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${b64}` } },
              { type: "text", text: DECOMPOSE_PROMPT },
            ],
          }],
          max_tokens: 1024,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        rawText = data.choices?.[0]?.message?.content ?? "";
      }
    }

    if (!rawText) {
      return NextResponse.json({ error: "vision_api_failed" }, { status: 502 });
    }

    // ── Parse JSON from model response ───────────────────────────────
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "parse_failed", raw: rawText }, { status: 422 });
    }

    let parsed: { elements: DetectedElement[] };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "json_invalid", raw: rawText }, { status: 422 });
    }

    // Validate + clamp bboxes to [0,1]
    const elements: DetectedElement[] = (parsed.elements ?? [])
      .filter((e): e is DetectedElement =>
        typeof e.label === "string" && Array.isArray(e.bbox) && e.bbox.length === 4
      )
      .map(e => ({
        ...e,
        bbox: e.bbox.map(v => Math.max(0, Math.min(1, Number(v)))) as [number, number, number, number],
        priority: Number(e.priority) || 99,
      }))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 8);

    return NextResponse.json({ elements });
  } catch (err) {
    console.error("[villa-decompose]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
