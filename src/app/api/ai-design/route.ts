/**
 * POST /api/ai-design
 * Body: { description: string, floors?: number }
 *
 * Converts a natural-language home description into a structured floor-plan
 * JSON that the store's applyAiDesign() action can apply directly.
 *
 * Key chain (first configured key wins):
 *   1. ANTHROPIC_API_KEY  → Claude claude-opus-4-5
 *   2. ZHIPUAI_API_KEY    → GLM-4 (OpenAI-compatible, text-only)
 *
 * Neither key requires user input — both are set in .env.local on the server.
 */
import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const ZHIPUAI_API_KEY   = process.env.ZHIPUAI_API_KEY;
const ZHIPUAI_API_URL   = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

// ─── Shared system prompt ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert Chinese residential architect AI.
The user describes a home in natural language (usually Chinese).
Your ONLY job: output a single JSON object that matches this exact schema — no prose, no markdown fences, no extra keys.

SCHEMA:
{
  "floors": <integer 1-3>,
  "exterior": {
    "wallColor": "<hex color e.g. #F5F0E8>",
    "roofType": "<flat|gable|hip|chinese>",
    "roofColor": "<hex color>",
    "accentColor": "<hex color for trim/accent>"
  },
  "floorLayouts": [
    {
      "floorIndex": <0-based>,
      "rooms": [
        {
          "type": "<RoomType>",
          "widthCm": <number>,
          "depthCm": <number>,
          "x": <number, pixel-like position from top-left in cm>,
          "y": <number>
        }
      ]
    }
  ],
  "summary": "<30字以内的中文描述，概括设计亮点>"
}

VALID RoomType values (use exactly these strings):
  living, master, bedroom, bedroom2, bedroom3,
  kitchen, bathroom, bathroom2,
  dining, study, study2,
  closet, balcony, balcony2,
  garage, gym, cinema, stair,
  custom1, custom2, custom3, custom4, custom5

LAYOUT RULES:
- Canvas is 1200×900 cm. Origin (0,0) = top-left.
- Rooms must NOT overlap. Leave 20cm gaps between rooms.
- x + widthCm ≤ 1200, y + depthCm ≤ 900.
- Reasonable sizes (cm): living 480×420, master 380×340, bedroom 300×280,
  kitchen 320×260, bathroom 240×200, dining 360×300, study 280×260,
  balcony 400×150, stair 260×220, garage 480×280.
- Upper floors (floorIndex ≥ 1) should have fewer rooms than ground floor.
- "stair" room MUST appear on every floor when floors > 1, at the SAME x,y on each floor.
- Ground floor: living + dining + kitchen + bathroom + (garage/study optional)
- Upper floors: bedrooms + master + bathrooms + stair
- Use master bedroom only once (typically on upper floor for Chinese preference).

STYLE HINTS:
- Modern/简约: flat roof, #F5F5F5 walls, #2A2A2A roof, #888 accent
- Mediterranean/地中海: hip roof, #F5EBCF walls, #C0392B roof, #1A5276 accent
- Chinese/中式: chinese roof, #EDE8E0 walls, #5D4037 roof, #8D6E63 accent
- Minimalist/极简: flat roof, #FFFFFF walls, #1A1A1A roof, #C0C0C0 accent

OUTPUT ONLY the JSON. No explanation. No markdown.`;

// ─── Helper: strip markdown fences and parse JSON ────────────────────────────
function parseJSON(raw: string): unknown {
  const clean = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(clean);
}

export async function POST(req: NextRequest) {
  let description = "";
  let floors = 0;
  try {
    const body = await req.json();
    description = (body.description ?? "").trim();
    floors = Number(body.floors) || 0;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  if (!ANTHROPIC_API_KEY && !ZHIPUAI_API_KEY) {
    return NextResponse.json(
      { error: "No AI key configured. Add ANTHROPIC_API_KEY or ZHIPUAI_API_KEY to .env.local" },
      { status: 500 }
    );
  }

  const userMessage = floors > 0
    ? `请帮我设计一个${floors}层的住宅。需求描述：${description}`
    : `请帮我设计一个住宅。需求描述：${description}`;

  // ── 1. Try Anthropic Claude ──────────────────────────────────────────────
  if (ANTHROPIC_API_KEY) {
    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const raw = data?.content?.[0]?.text ?? "";
        try {
          return NextResponse.json(parseJSON(raw));
        } catch {
          console.error("[ai-design/claude] JSON parse error, raw:", raw.slice(0, 200));
          // Fall through to ZhipuAI
        }
      } else {
        console.warn("[ai-design/claude] non-OK status:", res.status);
      }
    } catch (e) {
      console.warn("[ai-design/claude] fetch error:", e);
    }
  }

  // ── 2. Fallback: ZhipuAI GLM-4 ──────────────────────────────────────────
  if (ZHIPUAI_API_KEY) {
    try {
      const res = await fetch(ZHIPUAI_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${ZHIPUAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "glm-4",
          max_tokens: 2000,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: userMessage },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        const raw = data?.choices?.[0]?.message?.content ?? "";
        try {
          return NextResponse.json(parseJSON(raw));
        } catch {
          console.error("[ai-design/glm4] JSON parse error, raw:", raw.slice(0, 200));
          return NextResponse.json({ error: "AI returned invalid JSON", raw: raw.slice(0, 300) }, { status: 502 });
        }
      } else {
        const errText = await res.text();
        console.error("[ai-design/glm4] error:", res.status, errText);
        return NextResponse.json({ error: "AI service error", detail: errText }, { status: 502 });
      }
    } catch (e) {
      console.error("[ai-design/glm4] fetch error:", e);
      return NextResponse.json({ error: "Network error" }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "All AI providers failed" }, { status: 502 });
}
