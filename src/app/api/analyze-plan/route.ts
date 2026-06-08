/**
 * POST /api/analyze-plan
 * Body: { image: data:image/…;base64,… }
 *
 * Forwards the image to the chosen platform's vision model (OpenAI-compatible
 * schema) with a strict prompt that asks for a JSON array of rooms.
 *
 * Returns { rooms: Array<{ name, bbox:[x,y,w,h], shape }>, raw? }.
 *
 * 密钥来源（BYOK 优先）：请求 body 里的 provider + apiKey（用户弹窗自带，存浏览器
 * 本地，不落服务端）；provider 决定 endpoint / 视觉模型，见 aiProviders 注册表。
 * 智谱可回退 .env.local 的 ZHIPUAI_API_KEY（老用户零配置仍可用）。
 */
import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/aiProviders";

const ZHIPU_KEY = process.env.ZHIPUAI_API_KEY ?? "";

const SYSTEM_PROMPT = `你是建筑户型图分析专家。识别图中每一个独立房间区域，返回严格的 JSON 数组。

每个对象的字段：
- name: 中文房间名，从这些里选一个最贴切的：客厅、餐厅、厨房、主卧、次卧、儿童房、书房、卫生间、衣帽间、阳台、储物间、玄关、车库、健身房、影音室
- bbox: [x, y, width, height]，图像像素坐标，原点在图片左上角
- shape: "rect"（矩形，绝大多数）或 "l-shape"（明显有缺角/L 型才用）

严格要求：
1. 只输出 JSON 数组本身，不要 markdown 代码块（禁止 \`\`\`json），不要解释文字。
2. bbox 要准确，紧贴房间的墙体轮廓，不要把家具算进去也不要把走廊算进去。
3. 相邻房间的 bbox 边界应该对齐（共用墙）。
4. 家具（床/沙发/马桶等）不是房间，不输出。
5. 如果图中没有可识别的户型信息，返回空数组 []。

示例：
[{"name":"客厅","bbox":[120,240,600,480],"shape":"rect"},{"name":"主卧","bbox":[720,0,400,320],"shape":"rect"}]`;

export async function POST(req: Request) {
  let body: { image?: string; apiKey?: string; provider?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const { image, apiKey, provider: providerId } = body;

  const provider = getAiProvider(providerId);
  // BYOK 优先：用户弹窗自带的 key > 服务端 env 兜底（仅智谱有兜底）
  const envFallback = provider.id === "zhipu" ? ZHIPU_KEY : "";
  const key = apiKey?.trim() || envFallback;
  if (!key) {
    return NextResponse.json(
      { error: "no_key", message: "尚未配置大模型 API Key —— 点击「AI 解析」后在弹窗里选平台并填入即可（密钥只存你本机）" },
      { status: 401 },
    );
  }
  if (!image || !image.startsWith("data:")) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: provider.visionModel,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: SYSTEM_PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        }],
        temperature: 0.1,
        // Some Zhipu deployments ignore response_format; harmless to include.
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: "network_error", message: String(e) }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "zhipu_error", status: upstream.status, detail },
      { status: 502 },
    );
  }

  const data = await upstream.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "";

  // Be generous: strip ```json fences, trailing prose, etc.
  let clean = raw.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  // If model returned an object wrapping "rooms": [...] pull the array out.
  const jsonStart = clean.indexOf("[");
  const jsonEnd   = clean.lastIndexOf("]");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    clean = clean.slice(jsonStart, jsonEnd + 1);
  }

  let rooms: Array<{ name: string; bbox: [number, number, number, number]; shape?: string }>;
  try {
    const parsed = JSON.parse(clean);
    rooms = Array.isArray(parsed) ? parsed : (parsed?.rooms ?? []);
    if (!Array.isArray(rooms)) throw new Error("not an array");
  } catch {
    return NextResponse.json({ error: "parse_failed", raw }, { status: 502 });
  }

  // Validate minimally: drop entries with missing/malformed bbox
  const clean_rooms = rooms.filter(r =>
    r && typeof r.name === "string" &&
    Array.isArray(r.bbox) && r.bbox.length === 4 &&
    r.bbox.every(n => typeof n === "number" && isFinite(n))
  );

  return NextResponse.json({ rooms: clean_rooms });
}
