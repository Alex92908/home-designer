import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

const STYLE_PROMPTS: Record<string, string> = {
  photo:
    "photorealistic architectural photography, professional interior design photograph, soft diffused lighting, high resolution 8K, Architectural Digest quality",
  watercolor:
    "beautiful architectural watercolor illustration, soft washes of color, artistic watercolor painting, professional illustrator style",
  sketch:
    "clean architectural pencil sketch, hand-drawn interior design illustration, professional line drawing, warm paper texture",
  magazine:
    "luxury interior design magazine editorial, Architectural Digest cover photo, dramatic ambient lighting, ultra-premium lifestyle photography",
};

export async function POST(req: Request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "no_key" }, { status: 500 });
  }

  let body: { image?: string; style?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { image, style = "photo" } = body;

  if (!image) {
    return NextResponse.json({ error: "no_image" }, { status: 400 });
  }

  try {
    // Step 1 — GPT-4o vision: describe the 3D scene for DALL-E
    const visionRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 250,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: image, detail: "low" },
              },
              {
                type: "text",
                text: "Describe this 3D interior/exterior render for a DALL-E image generation prompt. Be concise (under 180 words). Mention: room type, furniture arrangement, color palette, materials, lighting mood, architectural style. Start directly with the description.",
              },
            ],
          },
        ],
      }),
    });

    const visionData = await visionRes.json();
    const description: string =
      visionData.choices?.[0]?.message?.content ??
      "a modern beautifully designed interior room";

    // Step 2 — DALL-E 3: generate photorealistic render
    const stylePrompt = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.photo;
    const prompt = `${stylePrompt}. Interior design scene: ${description}. No people, no text overlays.`;

    const dalleRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        size: "1024x1024",
        quality: "standard",
        n: 1,
      }),
    });

    const dalleData = await dalleRes.json();
    const url: string | undefined = dalleData.data?.[0]?.url;

    if (!url) {
      const errMsg: string =
        dalleData.error?.message ?? "generation_failed";
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
