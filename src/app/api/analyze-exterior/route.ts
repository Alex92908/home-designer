import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

interface AnalysisResult {
  preset: "modern" | "contemporary" | "mediterranean" | "industrial" | "minimalist";
  roofStyle: "flat" | "gable" | "hip" | "mansard" | "chinese";
  roofColor: string;
  wallMaterial: "render" | "brick" | "stone" | "wood" | "concrete";
  wallColor: string;
  accentColor: string;
  floors: 1 | 2 | 3;
  yardPreset: "pool" | "garden" | "minimal" | "full";
  showPerimeterFence: boolean;
  detectedFeatures: string[];
  promptAdditions: string;
  confidence: number;
}

const FALLBACK: AnalysisResult = {
  preset: "modern",
  roofStyle: "flat",
  roofColor: "#2A2A2A",
  wallMaterial: "render",
  wallColor: "#F4F2EE",
  accentColor: "#1A1A1A",
  floors: 2,
  yardPreset: "minimal",
  showPerimeterFence: false,
  detectedFeatures: [],
  promptAdditions: "",
  confidence: 0,
};

export async function POST(req: NextRequest) {
  try {
    const { image } = await req.json() as { image: string };

    if (!image) {
      return NextResponse.json({ error: "missing_image" }, { status: 400 });
    }

    if (!ANTHROPIC_API_KEY) {
      console.warn("ANTHROPIC_API_KEY not set — returning fallback");
      return NextResponse.json({ error: "analysis_failed", fallback: true, ...FALLBACK });
    }

    // Extract base64 data from data URL
    const base64Match = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      return NextResponse.json({ error: "invalid_image_format" }, { status: 400 });
    }
    const mediaType = base64Match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    const base64Data = base64Match[2];

    const userPrompt = `Analyze this architectural/building photo and return ONLY a valid JSON object with these exact fields:

{
  "preset": one of "modern" | "contemporary" | "mediterranean" | "industrial" | "minimalist",
  "roofStyle": one of "flat" | "gable" | "hip" | "mansard" | "chinese",
  "roofColor": hex color string like "#2A2A2A",
  "wallMaterial": one of "render" | "brick" | "stone" | "wood" | "concrete",
  "wallColor": hex color string like "#F4F2EE",
  "accentColor": hex color string for windows/trim/doors,
  "floors": integer 1, 2, or 3,
  "yardPreset": one of "pool" | "garden" | "minimal" | "full",
  "showPerimeterFence": boolean true or false,
  "detectedFeatures": array of short strings describing notable architectural features (e.g. ["infinity pool", "wood soffit", "glass curtain wall"]),
  "promptAdditions": string of extra Stable Diffusion prompt keywords to describe unique details (e.g. "dark aluminum window frames, wood soffit ceiling, travertine pavers"),
  "confidence": number between 0 and 1 indicating your confidence in the analysis
}

Be precise about colors — extract the actual dominant colors you see. Output ONLY the JSON object, no markdown, no explanation.`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        system: "You are an architectural design analyzer. Extract the design parameters from this building photo as JSON. Be precise about colors (output as hex). Only output valid JSON, no markdown.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: userPrompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error:", response.status, errorText);
      return NextResponse.json({ error: "analysis_failed", fallback: true, ...FALLBACK });
    }

    const apiResponse = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const textContent = apiResponse.content.find(c => c.type === "text");
    if (!textContent) {
      return NextResponse.json({ error: "analysis_failed", fallback: true, ...FALLBACK });
    }

    // Parse JSON from the response
    let parsed: Partial<AnalysisResult>;
    try {
      // Strip any potential markdown code fences if Claude adds them despite instructions
      const cleaned = textContent.text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      parsed = JSON.parse(cleaned) as Partial<AnalysisResult>;
    } catch (parseError) {
      console.error("Failed to parse Claude response:", textContent.text, parseError);
      return NextResponse.json({ error: "analysis_failed", fallback: true, ...FALLBACK });
    }

    // Merge with fallback for any missing fields, and validate enum values
    const validPresets = ["modern", "contemporary", "mediterranean", "industrial", "minimalist"];
    const validRoofStyles = ["flat", "gable", "hip", "mansard", "chinese"];
    const validWallMaterials = ["render", "brick", "stone", "wood", "concrete"];
    const validYardPresets = ["pool", "garden", "minimal", "full"];

    const result: AnalysisResult = {
      preset: validPresets.includes(parsed.preset ?? "") ? parsed.preset! : FALLBACK.preset,
      roofStyle: validRoofStyles.includes(parsed.roofStyle ?? "") ? parsed.roofStyle! : FALLBACK.roofStyle,
      roofColor: /^#[0-9a-fA-F]{6}$/.test(parsed.roofColor ?? "") ? parsed.roofColor! : FALLBACK.roofColor,
      wallMaterial: validWallMaterials.includes(parsed.wallMaterial ?? "") ? parsed.wallMaterial! : FALLBACK.wallMaterial,
      wallColor: /^#[0-9a-fA-F]{6}$/.test(parsed.wallColor ?? "") ? parsed.wallColor! : FALLBACK.wallColor,
      accentColor: /^#[0-9a-fA-F]{6}$/.test(parsed.accentColor ?? "") ? parsed.accentColor! : FALLBACK.accentColor,
      floors: ([1, 2, 3] as number[]).includes(parsed.floors ?? 0) ? parsed.floors! : FALLBACK.floors,
      yardPreset: validYardPresets.includes(parsed.yardPreset ?? "") ? parsed.yardPreset! : FALLBACK.yardPreset,
      showPerimeterFence: typeof parsed.showPerimeterFence === "boolean" ? parsed.showPerimeterFence : FALLBACK.showPerimeterFence,
      detectedFeatures: Array.isArray(parsed.detectedFeatures) ? parsed.detectedFeatures : [],
      promptAdditions: typeof parsed.promptAdditions === "string" ? parsed.promptAdditions : "",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("analyze-exterior error:", err);
    return NextResponse.json({ error: "analysis_failed", fallback: true, ...FALLBACK });
  }
}
