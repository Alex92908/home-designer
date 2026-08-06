/**
 * /api/ai-agent —— App 内的「设计 agent」:让用户自带的模型(DeepSeek / GLM / Qwen …)
 * 像 Claude Code 那样**多轮调用工具**改设计,而不是单发一份 JSON 就完事。
 *
 * 与 /api/ai-design 的区别:
 *   ai-design : 一次调用 → 一份完整设计 JSON → 应用。盲写,不看结果,不会纠错。
 *   ai-agent  : 循环 —— 调模型 → 拿 tool_calls → 执行 → 结果回喂 → 再调 … 直到模型不再调工具。
 *               它可以先 list_templates 看有什么、套个底子、get_design_state 看现状、
 *               再 apply_design{merge:true} 微调,并根据返回的 ok/error 自我修正。
 *
 * 工具面复用 MCP 的那一份(../mcp/tools),所以外部 Claude Code 和这里能力完全对等;
 * 工具执行同样落到浏览器命令桥(enqueue → 页面执行 → waitResult),画布实时变化。
 *
 * 传输:SSE(text/event-stream),逐条推送 {type} 事件给前端渲染「它正在做什么」。
 */
import { NextRequest } from "next/server";
import { callTool, toolsForOpenAI } from "../mcp/tools";
import { forceLease } from "../mcp/state";
import { getAiProvider, agentModelOf } from "@/lib/aiProviders";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 循环上限:防止模型在工具间打转烧钱。到顶后强制它用文字收尾。 */
const MAX_ROUNDS = 12;

const AGENT_SYSTEM = `你是筑雅 ZHUYA 的室内/建筑设计 agent,直接操作用户面前的 3D 画布。

工作方式:
1. 先 get_design_guide 读设计 JSON 契约(**动手前必读**,不读就写 apply_design 几乎一定失败)。
2. 需求接近某个成品场景时,先 list_templates,再 apply_project_template 套一个底子 —— 比从零写快得多、质量也高。
3. 再用 apply_design {merge:true} 做**增量**微调:只发要改的字段(某间房的家具数组、exterior.wallColor 等),不要重发整份设计。
4. 改完用 get_design_state 核对是否真的落到画布上;工具返回 ok:false 就读 error 修正后重试。
5. 改完摆位后跑一次 check_layout 看看后果(必要时用 auto_fix_layout 让 App 推开重叠)。
   apply_design 返回 ok 只代表 JSON 落库了,不代表东西摆得下。
   **注意:不要求把违规清零。** 连精心调过的官方模板都有十几处必须项(有些受房间尺寸所限
   本就无解,比如 260cm 橱柜放进 280cm 的厨房还要求前方留 90cm)。你的目标是:
   **别让自己这次的改动新增明显冲突**,重点看报告里**你刚放的那几件**;跑一两轮就够了,
   数字降不到 0 很正常,**不要反复重试** —— 陷在校验循环里比留几处建议项糟糕得多。

**分工原则(重要)**:你负责"放什么、什么风格、大致在哪个区域";**厘米级的几何冲突交给
auto_fix_layout 去解**。不要自己拿坐标反复演算间距 —— 你算不过真实的家具尺寸和净距规则,
只会陷入「我算着够了/但报告说冲突/再挪一点」的死循环。摆位靠工具,判断靠你。

表达要求:**只说结论,不要把推理过程写给用户看**。不要出现"让我想想""应该够""但报告说…"
这类自言自语,也不要贴坐标演算表。用户要看的是"我做了什么、结果如何"。

**绝对禁止原地打转**:每一轮回复要么调用工具,要么给出结论,二选一。如果发现某个工具
做不到你设想的效果,**立刻选最接近的可行做法执行**,或用一句话说明限制并给替代方案 ——
绝不要反复重述同一段思考、反复权衡同一个选择。写超过三句还没决定,就直接动手最合理的那个。

━━ 这个项目的已知坑(前人踩过,别重蹈)━━
1. **apply_design 的返回会告诉你「实际变化」**,认它,别自己另开一轮 get_design_state 去验。
   若显示「画布没有任何变化」,说明你的字段名或操作不被支持 —— 换做法,**不要原样重发**。
2. 院子坐标原点是**房子中心**;落在房子占地内的物件会被静默丢弃。房子的半宽/半深在
   yardSummary 里,按实际尺寸取值,或干脆省略 x/z 让系统自动散摆。
3. "yard.move" **每条只挪一件**,同名多件用 index 区分。要分散 4 棵树就写 4 条。
   挪动永远优先于「删掉再加一个」——后者会丢掉用户手工摆的东西。
4. 删院子里的某类东西用 "yard.remove"(按 kind),**不要** "clear:true" 全清再重建。
5. 室内家具是**整表替换**:给某间房的 furniture 数组时要带上所有保留项(用它们的 id),
   漏写谁就等于删了谁。
6. 摆位冲突交给 "auto_fix_layout",别自己拿坐标演算净距 —— 规则是带朝向的扇区,手算算不对。
7. 校验分「必须/建议」两级,**不要求清零**;连官方模板都有十几处建议项,受房间尺寸所限
   本就无解。跑一两轮就收,别陷在校验循环里。
8. **院子优先用 yard_auto_layout,别手写坐标**:
   - 要整院效果 → mode=preset 套设计师庭院包(18 套可选,传个错 id 会列出全部)
   - 要种树 → mode=plant(自动避房、间距 ≥7m、分布均匀)
   - 要动线 → mode=paths(自动连接各分区)
   手写 yard.add 只适合「在现成院子上补一两件specific的东西」。碰撞校验只能保证不重叠,
   保证不了好看;好看来自这些引擎。
9. **套用模板之后绝对不要整屋重建**(merge:false / 重写 floorLayouts)。模板是设计师手工调过的
   成品,家具位置、朝向、动线都是对的;你手写坐标排不出同等水平,重建=把好布局换成烂布局。
   模板套上后只做**小增量**:改材质/颜色、增删个别家具、改房间尺寸。哪怕 get_design_state
   看着"内容不多",也不要推倒重来 —— 先信模板,不够再局部加。

要求:
- **只要用户提出任何修改要求,就必须真正调用工具把它落到画布上。只回复文字而不调用工具 =
  什么都没做**,这是最常见的失败。多轮对话里尤其注意:第二次、第三次要求同样要动手,
  不能因为"刚才已经生成过了"就只用嘴答应。
- 续聊时先 get_design_state 看画布**当前真实状态**(用户可能自己改过),再基于它增量修改。
- 每次工具调用前用一句中文说明你要做什么,让用户看得懂进度。
- 全部改完后,用简短中文总结你做了哪些改动(不要罗列 JSON)。
- 用户没要求的东西不要擅自改动。
- **别把选择题丢回给用户**。用户说「布置一下院子」这类目标明确、细节开放的需求时,你要**直接按专业判断
  做一版出来**(挑合适的套组/植物/铺装、算好位置、校验通过),再告诉他"做了什么、想调哪里跟我说";
  不要列一堆"你想要泳池吗?要树吗?"然后停在那儿等回话。只有当需求真的有歧义、做错了代价很大时才反问。
- 看现状时注意:get_design_state 里的 design.yard 只涵盖你能生成的那几类,**院子的分区、小径、
  导入模型在 yardSummary 字段里**。别只看 design.yard 就断言"院子是空的"。`;

/** 模型只回文字、没调工具时的追问。多轮对话里最常见的失败模式(用户实测:第二次要求没写入)。 */
const NUDGE = `你刚才没有调用任何工具 —— 如果用户的话包含设计修改要求,请立刻用工具真正执行
(先 get_design_state 看现状,再 apply_design {merge:true} 改)。如果用户只是提问、不需要改动画布,
那就直接回答即可。`;

type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

export async function POST(req: NextRequest) {
  let history: Array<{ role: string; content: string }> = [];
  let apiKey = "";
  let providerId = "";
  let tabId = "";
  try {
    const body = await req.json();
    history = Array.isArray(body.messages) ? body.messages : [];
    apiKey = (body.apiKey ?? "").trim();
    providerId = body.provider ?? "";
    // 发起 agent 的标签 id —— 用它把命令定向到用户眼前这一页(见 forceLease)。
    tabId = typeof body.tabId === "string" ? body.tabId : "";
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (!history.length) return new Response("messages is required", { status: 400 });

  const provider = getAiProvider(providerId);
  const envFallback = provider.id === "zhipu" ? (process.env.ZHIPUAI_API_KEY ?? "") : "";
  const key = apiKey || envFallback;
  if (!key) {
    return new Response(
      JSON.stringify({ error: "no_key", message: "尚未配置大模型 API Key —— 在 AI 助手设置里选平台并填入(只存你本机)" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* 客户端已断开 */ }
      };

      const messages: Msg[] = [
        { role: "system", content: AGENT_SYSTEM },
        ...history.map(m => ({
          role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          content: String(m.content ?? ""),
        })),
      ];

      let usedTool = false;   // 本次请求是否真的动过工具
      let nudged = false;     // 是否已经追问过「你没调工具」
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const last = round === MAX_ROUNDS - 1;
          const res = await fetch(provider.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: agentModelOf(provider),
              messages,
              // 最后一轮不再给工具,逼模型用文字收尾,避免卡在工具循环里
              ...(last ? {} : { tools: toolsForOpenAI(), tool_choice: "auto" }),
              temperature: 0.3,
              // agent 每轮只该输出「一句说明 + 工具调用」或「简短总结」,给太大的输出预算
              // 反而纵容它把思考过程整篇写出来 —— 实测有一轮反复自问自答上百遍、
              // 一个工具都没调(死循环)。1200 足够,写不下就只能去调工具。
              max_tokens: Math.min(1200, provider.maxTokens ?? 8000),
            }),
          });

          if (!res.ok) {
            const detail = (await res.text()).slice(0, 400);
            send({ type: "error", message: `模型接口 ${res.status}:${detail}` });
            break;
          }

          const data = await res.json();
          const choice = data?.choices?.[0];
          const msg = choice?.message ?? {};
          const calls = (msg.tool_calls ?? []) as NonNullable<Msg["tool_calls"]>;
          const text = typeof msg.content === "string" ? msg.content : "";

          if (text) send({ type: "text", text });

          if (!calls.length) {
            // 一次都没动过工具就想收尾 → 多半是「嘴上答应、没真改」(实测第二轮高发)。
            // 追问一次并强制它调工具;纯提问的场合模型会在追问后仍以文字作答,不会误伤。
            if (!usedTool && !nudged) {
              nudged = true;
              messages.push({ role: "assistant", content: text || null });
              messages.push({ role: "system", content: NUDGE });
              continue;
            }
            send({ type: "done" });
            break;
          }
          usedTool = true;

          // 记下助手这一轮的工具调用(下一轮请求必须带上,否则 tool 结果无处挂靠)
          messages.push({ role: "assistant", content: text || null, tool_calls: calls });

          for (const c of calls) {
            const name = c.function?.name ?? "";
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* 参数坏了交给工具报错 */ }
            send({ type: "tool", name, args: summarizeArgs(name, args) });

            let result: string;
            try {
              // 每次调工具前把租约拽回发起方标签:租约只有 6s,agent 一跑几分钟,
              // 中途可能被别的标签(如另开的预览页)抢走 → 命令落到别处、快照也读错。
              if (tabId) forceLease(tabId);
              result = await callTool(name, args);
            } catch (e) {
              result = JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "tool failed" });
            }
            send({ type: "tool_result", name, ok: !/"ok"\s*:\s*false/.test(result) });
            // 工具返回可能很大(契约/快照),截断以免把上下文撑爆
            messages.push({ role: "tool", tool_call_id: c.id, content: result.slice(0, 24000) });
          }
        }
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "agent failed" });
      } finally {
        try { controller.close(); } catch { /* 已关闭 */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/** 工具参数给前端展示用的摘要 —— 设计 JSON 可能几十 KB,不能整份塞进 UI。 */
function summarizeArgs(name: string, args: Record<string, unknown>): string {
  if (name === "apply_project_template") return String(args.templateId ?? "");
  if (name === "apply_design") {
    const d = (args.design ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (args.merge === false) parts.push("整屋重建");
    if (Array.isArray(d.floorLayouts)) parts.push(`${(d.floorLayouts as unknown[]).length} 层`);
    const keys = Object.keys(d).filter(k => k !== "floorLayouts");
    if (keys.length) parts.push(keys.join("/"));
    return parts.join(" · ");
  }
  return "";
}
