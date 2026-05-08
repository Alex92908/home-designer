/**
 * POST /api/analyze-floorplan
 * Body: { image: string (base64 or data URI), scaleHint?: string }
 *
 * Calls Anthropic claude-3-5-sonnet vision to extract structured floor-plan
 * data from the uploaded image.
 *
 * Returns { walls, rooms, approximateDimensions, confidence } on success.
 * Returns { error: string } with appropriate HTTP status on failure.
 *
 * Env: ANTHROPIC_API_KEY must be set.
 */
import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a vision assistant that extracts structured floor-plan data from an image.
Your ONLY job: return a JSON object that exactly matches this schema — no prose, no markdown fences.

{
  "walls": [{ "start": [x, z], "end": [x, z], "thickness": number? }, ...],
  "rooms": [{ "name": string, "polygon": [[x,z], ...], "approximateAreaSqM": number? }, ...],
  "approximateDimensions": { "widthM": number, "depthM": number },
  "confidence": number 0..1
}

Coordinates are in metres. Origin = floor plan's bottom-left corner.
If unclear, lower confidence but still produce your best attempt.
DO NOT wrap the JSON in markdown. DO NOT explain. Just output the raw JSON.`;

interface Wall {
  start: [number, number];
  end: [number, number];
  thickness?: number;
}

interface Room {
  name: string;
  polygon: [number, number][];
  approximateAreaSqM?: number;
}

interface FloorPlanResult {
  walls: Wall[];
  rooms: Room[];
  approximateDimensions: { widthM: number; depthM: number };
  confidence: number;
}

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 503 },
    );
  }

  let body: { image?: string; scaleHint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { image, scaleHint } = body;
  if (!image) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }

  // Detect and strip data URI prefix if present
  let mediaType: string = "image/jpeg";
  let base64Data: string = image;

  const dataUriMatch = image.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    mediaType = dataUriMatch[1];
    base64Data = dataUriMatch[2];
  } else if (!image.match(/^[A-Za-z0-9+/]+=*$/)) {
    // Not a clean base64 string either
    return NextResponse.json({ error: "invalid_image_format" }, { status: 400 });
  }

  const userContent: Array<{ type: string; [key: string]: unknown }> = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: base64Data,
      },
    },
    {
      type: "text",
      text: scaleHint
        ? `Analyse this floor plan. Scale hint: ${scaleHint}. Return only the JSON object.`
        : "Analyse this floor plan. Return only the JSON object.",
    },
  ];

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });
  } catch (e) {
    console.error("analyze-floorplan: network error", e);
    return NextResponse.json({ error: "network_error" }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("analyze-floorplan: Anthropic error", upstream.status, detail);
    return NextResponse.json(
      { error: "anthropic_error", status: upstream.status },
      { status: 502 },
    );
  }

  const apiResponse = await upstream.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = apiResponse.content?.find((c) => c.type === "text");
  if (!textBlock?.text) {
    return NextResponse.json({ error: "empty_response" }, { status: 502 });
  }

  const raw = textBlock.text.trim();

  // Strip accidental markdown fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  let parsed: Partial<FloorPlanResult>;
  try {
    parsed = JSON.parse(cleaned) as Partial<FloorPlanResult>;
  } catch (parseErr) {
    console.error("analyze-floorplan: JSON parse failed", raw.slice(0, 300), parseErr);
    return NextResponse.json({ error: "parse_failed", raw: raw.slice(0, 500) }, { status: 502 });
  }

  const result: FloorPlanResult = {
    walls: Array.isArray(parsed.walls) ? parsed.walls : [],
    rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
    approximateDimensions:
      parsed.approximateDimensions &&
      typeof parsed.approximateDimensions.widthM === "number" &&
      typeof parsed.approximateDimensions.depthM === "number"
        ? parsed.approximateDimensions
        : { widthM: 0, depthM: 0 },
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
  };

  return NextResponse.json(result);
}
