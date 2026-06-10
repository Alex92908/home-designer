/**
 * POST /api/ai-design
 * Body: { description: string, floors?: number }
 *
 * Converts a natural-language home description into a structured floor-plan
 * JSON that the store's applyAiDesign() action can apply directly.
 *
 * Key chain (first configured key wins):
 *   1. ANTHROPIC_API_KEY  → Claude claude-opus-4-5（服务端 env 优先）
 *   2. provider + apiKey（请求 body，用户 BYOK）→ 该平台文本模型；智谱可回退
 *      .env.local 的 ZHIPUAI_API_KEY（老用户零配置仍可用）。
 *
 * provider 决定 endpoint / 文本模型，见 aiProviders 注册表。密钥只存浏览器本地，
 * 随请求转发，不落服务端、不回显。
 */
import { NextRequest, NextResponse } from "next/server";
import { getAiProvider } from "@/lib/aiProviders";
import { MATERIALS } from "@/lib/data";
import { FURNITURE } from "@/lib/furniture";
import { OUTDOOR_ASSET_LIBRARY, type OutdoorCategory } from "@/lib/outdoorAssets";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const ZHIPUAI_API_KEY   = process.env.ZHIPUAI_API_KEY;

// ─── 材质目录（从 MATERIALS 动态生成，给模型按 id 选墙/地/灯/砖）────────────
// 列成 `id=中文名` 让模型能根据「水晶吊灯」「橡木地板」等口语精确挑到对应 id。
function materialCatalog(cat: "wall" | "floor" | "light" | "tile"): string {
  return MATERIALS.filter(m => m.category === cat)
    .map(m => `${m.id}=${m.name}`)
    .join(" | ");
}
const MATERIAL_CATALOG = `墙面 wall（id=名称）：
  ${materialCatalog("wall")}
地板 floor：
  ${materialCatalog("floor")}
灯具 light（含各式吊灯/筒灯/射灯）：
  ${materialCatalog("light")}
瓷砖 tile（厨卫地砖）：
  ${materialCatalog("tile")}`;

// ─── 院子素材目录（从 OUTDOOR_ASSET_LIBRARY 动态生成，给模型按 kind 选树/花/石/装饰）──
function yardCatalog(cat: OutdoorCategory): string {
  return OUTDOOR_ASSET_LIBRARY.filter(a => a.category === cat)
    .map(a => `${a.kind}=${a.label}`)
    .join(" | ");
}
const YARD_CATALOG = `结构件 prefab（id=名称，整块结构）：pool=泳池 | pergola_classic=廊架 | outdoor_kitchen=户外厨房 | fountain=喷泉
单体 kind（id=名称）：
  树 tree：${yardCatalog("tree")}
  花草 plant：${yardCatalog("plant")}
  石头 rock：${yardCatalog("rock")}
  装饰/设施 feature：${yardCatalog("feature")}
  户外家具 furniture：${yardCatalog("furniture")}`;

// ─── 外墙装饰目录（category==="exterior_wall_decor" 的家具，按 id 选）──────────
const WALL_DECOR_CATALOG = FURNITURE
  .filter(f => f.category === "exterior_wall_decor")
  .map(f => `${f.id}=${f.name}`)
  .join(" | ");

// ─── Shared system prompt ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert Chinese residential architect AI.
The user describes a home in natural language (usually Chinese).
Your ONLY job: output a single JSON object that matches this exact schema — no prose, no markdown fences, no extra keys.

SCHEMA:
{
  "floors": <integer 1-99>,
  "exterior": {
    "preset": "<one of: modern-minimal | french-classical | industrial-loft | mediterranean | japanese-zen — pick the closest style; this drives the whole facade+material package>",
    "wallColor": "<hex color e.g. #F5F0E8>",
    "roofType": "<flat|gable|hip|chinese>",
    "roofColor": "<hex color>",
    "accentColor": "<hex color for trim/accent>",
    "hasRooftop": <true|false — true if the user wants a 天台/rooftop terrace>,
    "wallMaterial": "<render|brick|stone|wood|concrete|glass — 可选, 改外墙材质类型才给>",
    "footprintShape": "<rect|L|U|T — 可选, 改楼体轮廓才给>",
    "pilotis": <可选,米 0-4 — 架空层/吊脚楼高度>,
    "fence": <可选 true|false — 外围栅栏开关>,
    "wallZones": [ { "material": "<render|brick|stone|wood|concrete|glass>", "color": "<hex>", "heightFraction": <0-1,各带占比和为1> } ]
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
          "y": <number>,
          "furniture": [
            { "category": "<FurnitureCategory>", "x": <可选,cm 距西/左墙>, "y": <可选,cm 距北/后墙>, "rotation": <可选,度 0|90|180|270>, "scaleW": <可选,宽倍数>, "scaleD": <可选,深倍数>, "scaleH": <可选,高倍数>, "mountCeiling": <可选 true=吊顶安装> }
          ],
          "wall": "<material id, category wall — 可选, 改墙面才给>",
          "floor": "<material id, category floor — 可选, 改地板才给>",
          "light": "<material id, category light — 可选, 改灯/吊灯才给>",
          "tile": "<material id, category tile — 可选, 改瓷砖才给>",
          "windows": [ { "wall": "<N|S|W|E>", "pos": <cm 沿墙偏移>, "len": <cm 窗宽>, "h": <可选,cm 窗高>, "sill": <可选,cm 窗台离地>, "style": "<可选 sliding|casement|fixed|louvered|security|wooden>" } ],
          "openWalls": [ "<N|S|W|E>" ],
          "door": "<wood_panel|frosted_glass|sliding_barn|french_double — 可选, 改房门款式才给>",
          "doorWall": "<N|S|W|E — 可选, 改门朝向才给>",
          "doorPos": <可选,cm 门沿墙偏移>,
          "doorLen": <可选,cm 门宽,默认80>,
          "hasDoor": <可选 false=这间不要门>,
          "shape": "<rect|l-shape|convex — 可选, 改房间形状才给>",
          "name": "<可选, 房间自定义显示名, 如'琴房'>",
          "exteriorStyle": "<glass|concrete|auto — 可选, 该房间外立面>",
          "ceiling": "<material id, 复用 wall 材质条目 — 可选, 改天花板才给>",
          "wallLower": "<material id, category wall — 可选, 墙裙/护墙板才给>",
          "lightOn": <可选 true|false — 灯开关>,
          "lightBrightness": <可选 0.3-2.0 — 灯亮度倍数>,
          "lightColor": "<可选 hex — 灯色温, 暖光#FFD8A0 冷白#F2F8FF>",
          "doors": [ { "wall": "<N|S|W|E>", "pos": <cm 沿墙偏移>, "len": <可选,cm 门宽>, "h": <可选,cm 门高>, "style": "<可选,同 door 四选一>" } ],
          "wallDecor": [ { "id": "<外墙装饰 id>", "wall": "<N|S|W|E>", "u": <可选 0-1 横向>, "v": <可选 0-1 纵向> } ]
        }
      ],
      "removeRooms": [ "<RoomType — 可选, 要从这层删除的房间>" ]
    }
  ],
  "yard": {
    "clear": <可选 true|false — true=先清空现有院子物件再加>,
    "add": [
      { "prefab": "<pool|pergola_classic|outdoor_kitchen|fountain — 结构件，二选一>", "x": <可选,cm 世界坐标>, "z": <可选,cm 世界坐标>, "scale": <可选> },
      { "kind": "<单体素材 id，如 tree.olive>", "x": <可选>, "z": <可选>, "scale": <可选> }
    ],
    "paths": [
      { "points": [[x1,z1],[x2,z2],...], "widthCm": <可选,默认80>, "material": "<可选 stone|gravel|grass|brick>" }
    ]
  },
  "summary": "<30字以内的中文描述，概括设计亮点>"
}

VALID RoomType values (use exactly these strings):
  living, master, bedroom, bedroom2, bedroom3,
  kitchen, bathroom, bathroom2,
  dining, study, study2,
  closet, balcony, balcony2,
  garage, gym, cinema, stair,
  custom1, custom2, custom3, custom4, custom5

VALID FurnitureCategory values (for "furniture"; use exactly these strings):
  sofa, coffee_table, tv_unit, bed, nightstand, wardrobe, dresser,
  dining_table, dining_chair, kitchen_cabinet, refrigerator, range_hood,
  kitchen_sink, toilet, bathtub, shower, bathroom_vanity,
  desk, office_chair, bookshelf, sideboard, storage,
  floor_lamp, plant, rug, artwork, curtain

FURNITURE RULES:
- Each room MAY include a "furniture" array of { "category": <FurnitureCategory> }.
  The server resolves each category to a concrete product and auto-places it.
  You MAY also give a piece an explicit "x"/"y" to place/move it precisely
  (omit them = server auto-arranges).

POSITIONING (房间局部坐标系 — 用来"摆位/挪家具"):
- Each room is widthCm × depthCm. Origin (0,0) = the room's 北/后墙-西/左墙 corner.
  "x" = cm from 西墙(左, x=0) toward 东墙(右, x=widthCm).
  "y" = cm from 北墙(后, y=0) toward 南墙(前, y=depthCm).
- 方位换算：靠北/后墙 → y≈0；靠南/前墙 → y≈depthCm；靠西/左墙 → x≈0；靠东/右墙 → x≈widthCm；居中 → (widthCm/2, depthCm/2)。
- The value is the piece's CENTER; the server clamps it inside the room, so being
  approximate is fine. Example：把床放主卧南墙居中 → { "category":"bed", "x":widthCm/2, "y":depthCm-90 }.
- 摆位合理性：床/沙发背靠墙，电视(tv_unit)贴一面墙、沙发在对墙朝它；餐桌居中；床头柜紧挨床两侧。
- In EDIT MODE「把沙发挪到…」: echo the piece by its existing "id" and give the new
  "x"/"y"; keep other pieces' ids+positions unchanged.
- "rotation" 朝向(度)，只认 0/90/180/270。0=默认朝南/前；「沙发转90度/横过来」→
  在该件上给 rotation（在原值基础上 +90）。
- "scaleW"/"scaleD"/"scaleH" 尺寸倍数（默认1，范围0.2–5）。「餐桌放大一点」→
  scaleW/scaleD ≈1.3；「小一号」→ ≈0.7；「加高」只给 scaleH。
- EDIT MODE 里改朝向/大小：echo 该件的 id + 原 x/y，再给新 rotation/scale*；
  现状里已带 rotation/scale* 的件，没让你改就原样照抄（丢了=被重置）。
- Furnish rooms sensibly: 客厅 sofa+coffee_table+tv_unit; 卧室/主卧 bed+nightstand+wardrobe;
  厨房 kitchen_cabinet+refrigerator; 卫生间 toilet+shower/bathtub+bathroom_vanity;
  书房 desk+office_chair+bookshelf; 餐厅 dining_table+dining_chair.
- 中文家具名映射：书架=bookshelf 沙发=sofa 床=bed 衣柜=wardrobe 书桌=desk
  餐桌=dining_table 茶几=coffee_table 电视柜=tv_unit 床头柜=nightstand 绿植=plant 地毯=rug。
- In EDIT MODE, keep the room's existing "furniture" entries (they carry an "id"
  and position) and only ADD or REMOVE entries the user asked about. A room whose
  furniture you don't touch should still echo its existing "furniture" array
  unchanged. Omit "furniture" entirely for a room only if you want to leave it as-is.

MATERIAL RULES (墙面/地板/灯具/瓷砖 — 改房间装修风格用这些):
- A room MAY include "wall" / "floor" / "light" / "tile", each a material id
  chosen from the catalog below. Use the EXACT id string.
- Only include a slot when the user asks to change it. Omit a slot to keep the
  room's current material. A room's furniture and its materials are independent —
  you can change just "light" without touching "furniture".
- Match the user's words to the closest catalog item by its 中文名:
  「吊灯/氛围灯/水晶灯」→ light-*（吊灯类）; 「筒灯/无主灯/射灯」→ light-recessed/light-spot;
  「换墙色/刷墙/奶茶色墙」→ wall-*; 「木地板/橡木/胡桃木地板」→ floor-*;
  「厨房/卫生间瓷砖/地砖」→ tile-* 或 floor-*。
- These materials are PER ROOM. To restyle the whole home, set them on each room.
- In EDIT MODE, a changed room should echo its existing "wall"/"floor"/"light"/
  "tile" ids unchanged and only swap the one the user named (omit slots you keep).
AVAILABLE MATERIALS (pick "wall"/"floor"/"light"/"tile" by id):
${MATERIAL_CATALOG}

WINDOW RULES (开窗/改窗 — "windows"):
- "windows" is the room's COMPLETE window list. Present (even []) = rebuild the
  room's windows from it; omit = keep current windows. To ADD a window in EDIT
  MODE, echo existing windows AND append the new one. To remove, drop it.
- "wall": which wall — N=北/后, S=南/前, W=西/左, E=东/右. "pos" = cm from that
  wall's start; "len" = window width (cm). Keep pos+len within the wall length
  (N/S wall length = widthCm, W/E wall length = depthCm). Typical len 120-220.
- "南面开大窗/落地窗" → wall "S", big len, sill 低(如 10); 普通窗 sill≈90, h≈150。
- "style" 改窗户款式（可选，不改就省略）：sliding(推拉窗,默认) / casement(平开窗) /
  fixed(固定观景窗,落地窗常用) / louvered(百叶窗) / security(防盗窗) / wooden(木窗)。
  「换成落地观景窗」→ style "fixed" 且 sill 低; 「装防盗窗」→ style "security";
  「百叶窗」→ "louvered"; 「中式木窗」→ "wooden"。改款式时同样要照抄该房间其它窗户。

OPEN-PLAN RULES (开放式/打通/拆墙 — "openWalls"):
- "openWalls" lists the room walls to REMOVE so two spaces merge (开放式). Present
  = rebuild this room's open walls from it; omit = unchanged; [] = put all walls back.
- 「客厅和厨房打通」= 在相邻的两个房间，各自把相邻那面墙加进 openWalls。
  「LDK 一体/开放式厨房」同理。先判断两房相邻在哪面墙（看 x/y 与尺寸），再开那面。

DOOR RULES (房门 — "door"/"doorWall"/"doorPos"/"doorLen"/"hasDoor"，每个房间一扇门):
- 只有用户明确要改某房间的"门"时才给这些字段，否则省略（不要顺手改）。
- "door" 款式四选一：wood_panel(实木门板) / frosted_glass(磨砂玻璃木框门) /
  sliding_barn(谷仓推拉门) / french_double(法式对开玻璃门)。
  「磨砂玻璃门/玻璃门」→ frosted_glass；「谷仓门/推拉门/移门」→ sliding_barn；
  「法式门/对开门」→ french_double；「实木门/木门」→ wood_panel。
- "doorWall" 改门在哪面墙（N=北/后 S=南/前 W=西/左 E=东/右），"doorPos" 沿墙
  偏移(cm)，"doorLen" 门宽(cm,默认80)。「主卧门改到东墙」→ "doorWall": "E"。
- "hasDoor": false = 这间不要门（开放门洞）。「储物间不装门」→ false。
- 例：「主卧门换磨砂玻璃」→ 在 master 房间输出 "door": "frosted_glass"。

SHAPE & NAME RULES (房间形状/改名/外立面 — "shape"/"name"/"exteriorStyle"):
- "shape" 三选一：rect(矩形) / l-shape(L型) / convex(凸字型)。按房间当前宽深
  自动生成多边形。「客厅改成L型」→ "shape": "l-shape"；改回方正 → "rect"。
- "name" 改房间显示名（≤12字）。「把书房叫琴房」→ study 房间 "name": "琴房"。
  注意 "type" 仍必须是合法 RoomType，改名不换类型。
- "exteriorStyle" 该房间外墙在外观图的画法：glass(玻璃幕墙)/concrete(实墙开窗)/
  auto(自动)。「客厅做成玻璃幕墙」→ "exteriorStyle": "glass"。

CEILING & LIGHT-STATE RULES (天花板/墙裙/灯光状态):
- "ceiling" 天花板材质（复用 wall 材质 id）：「天花板刷深色」→ 选个深色 wall 材质 id。
- "wallLower" 墙裙/护墙板（wall 材质 id）：下半墙用它、上半墙用 "wall"。
  「客厅做半墙护墙板」→ 给 wallLower 一个木质 wall 材质。
- "lightOn"/"lightBrightness"/"lightColor" 改灯光状态，不换灯具本身：
  「主卧灯调暖一点」→ "lightColor": "#FFD8A0"；「调亮」→ "lightBrightness": 1.5；
  「关灯」→ "lightOn": false。换灯具类型仍用 "light"（材质 id）。

REMOVE-ROOM RULES (删房间 — floorLayouts[].removeRooms，仅 edit 模式):
- 「把书房去掉/拆掉次卧」→ 该层输出 "removeRooms": ["study"]，"rooms" 可为 []
  或只含其它要改的房间。不要把要删的房间留在 "rooms" 里。
- 删除只下架房间（家具/材质随之隐藏），不影响其它房间。

MULTI-DOOR RULES (多门 — "doors"):
- "doors" 是该房间完整门列表（语义同 windows）：给了（含[]）=按此重建；省略=不动。
- 「客厅南墙和东墙各开一扇门」→ "doors": [{"wall":"S","pos":...},{"wall":"E","pos":...}]。
- 与单门字段（doorWall/doorPos/doorLen）二选一：要多扇门用 "doors"，只挪一扇用单门字段。

WALL-DECOR RULES (外墙装饰 — "wallDecor"，贴房间外墙外侧):
- 整组重建语义（同 windows）：给了（含[]）=重建该房间外墙装饰；省略=不动。
  EDIT MODE 加一件 → 照抄现有 wallDecor 再 append。
- "wall" 是装饰贴在该房间哪面外墙；"u" 0=左 1=右（从外看），"v" 0=地 1=顶。
- 「大门口挂个灯笼」→ 入口房间 S 墙 wall-lamp-lantern；「贴春联」→ 门两侧
  couplet-spring (u≈0.35) + couplet-prosperity (u≈0.65)。
AVAILABLE WALL DECOR (pick by id): ${WALL_DECOR_CATALOG}

YARD-PATH RULES (院子小径 — yard.paths):
- 追加语义：只写要新铺的路，现有小径不回传也不会被清掉。
- "points" 是世界坐标(cm)折线，原点=房子中心，+z=前院(南)、+x=右(东)。
  「从大门铺条石板路到泳池」→ 2-3 个点连线即可，material "stone"。

EXTERIOR RULES (外墙材质/楼体轮廓 — exterior.wallMaterial / exterior.footprintShape):
- "wallMaterial" 整楼外墙材质类型：render(抹灰涂料) / brick(砖) / stone(石材) /
  wood(木) / concrete(清水混凝土) / glass(玻璃)。「外墙换红砖」→ "brick"
  （配合 wallColor 给砖红色如 #B05030）。
- "footprintShape" 楼体平面轮廓：rect / L / U / T。「盖成U字型的房子」→ "U"。
  只有用户明确说楼体形状才给；普通设计请求省略。
- "pilotis" 架空层高度(米,0-4)：「吊脚楼/底层架空2米」→ 2。
- "fence" 外围栅栏开关：「不要围墙」→ false。
- "wallZones" 分层外墙（自下而上）：「上面玻璃下面砖」→
  [{"material":"brick","color":"#B05030","heightFraction":0.4},
   {"material":"glass","color":"#C8E0F0","heightFraction":0.6}]。
  各带 heightFraction 和为 1。只有用户明确要分层墙面才给。

YARD RULES (院子/花园/前后院 — "yard"，只作用于 floor 0):
- 一致性主线：「日式庭院/地中海花园」这类"换庭院风格"的请求 → 输出对应的
  "exterior.preset"（japanese-zen / mediterranean…），preset 自带整套配齐的
  庭院包（分区+植物+小径），不要再手拼 yard.add 散件。
  只有"在现有院子上加几样东西"才用 yard.add，且所加素材应与当前风格协调
  （日式配枫/松/石，地中海配棕榈/橄榄/多肉，法式配柏树/花境）。
- 只有当用户提到院子/花园/泳池/草坪/绿化/树/喷泉等室外内容时才输出 "yard"，否则整段省略。
- "yard.add" 是要"加进"院子的物件：结构件给 "prefab"（pool/pergola_classic/
  outdoor_kitchen/fountain），植物/石头/装饰/户外家具给 "kind"（见下方目录的精确 id）。
  一个物件只给 prefab 或 kind 之一。
- 「院子加个泳池」→ { "prefab": "pool" }；「种几棵橄榄树」→ 多个 { "kind": "tree.olive" }。
- 坐标 "x"/"z" 是世界坐标(cm)，原点=房子中心，+z=前院(南)、+x=右(东)。一般可省略，
  服务端会自动在前院散开摆放；只有用户明确说"放左边/门口"等才给坐标。
- "clear": true 仅在用户要"清空院子/重做花园"时给；普通"加个X"不要给（默认在现有院子上追加）。
- EDIT MODE：CURRENT DESIGN 里的 "yard.add" 是院子现状；想加东西就 append 新物件，
  其余照抄；想全换就配合 "clear": true。
AVAILABLE YARD ITEMS (pick "prefab" or "kind" by id):
${YARD_CATALOG}

LAYOUT RULES:
- Canvas is 1200×900 cm. Origin (0,0) = top-left.
- Rooms must NOT overlap. Leave 20cm gaps between rooms.
- x + widthCm ≤ 1200, y + depthCm ≤ 900.
- Reasonable sizes (cm): living 480×420, master 380×340, bedroom 300×280,
  kitchen 320×260, bathroom 240×200, dining 360×300, study 280×260,
  balcony 400×150, stair 260×220, garage 480×280.
- "floors" is the number of regular floors; it may be any value 1-99.
- Upper floors (floorIndex ≥ 1) should have fewer rooms than ground floor.
- "stair" room MUST appear on every floor when floors > 1, at the SAME x,y on each floor.
- Ground floor: living + dining + kitchen + bathroom + (garage/study optional)
- Upper floors: bedrooms + master + bathrooms + stair
- Use master bedroom only once (typically on upper floor for Chinese preference).

STYLE HINTS (always also set "preset" to the matching canonical id):
- 现代极简/Modern Minimal → preset "modern-minimal": flat roof, #F0EDE6 walls, #3A3E48 roof, #888 accent
- 法式古典/French Classic → preset "french-classical": gable roof, #F5EBD8 walls, #E8D8B0 roof, #C0A040 accent
- 工业风/Industrial → preset "industrial-loft": flat roof, #9B9088 walls, #5E564E roof, #1E1E22 accent
- 地中海/Mediterranean → preset "mediterranean": hip roof, #F8F2E8 walls, #C26840 roof, #2A6088 accent
- 日式禅意/Japanese Zen → preset "japanese-zen": flat roof, #F4F0E4 walls, #2A1E14 roof, #1E1E22 accent

EDIT MODE (a "CURRENT DESIGN" JSON is provided in the user message):
- Treat the new description as an INCREMENTAL tweak applied on top of CURRENT DESIGN.
- Return ONLY THE PARTS THAT CHANGE — this is a PATCH, not a full rebuild. The
  server merges your output onto the current design and keeps everything you omit.
  * Only include the floor(s) in "floorLayouts" that you actually changed. Omit
    untouched floors entirely.
  * Within a changed floor, only include the room(s) you actually changed. Omit
    untouched rooms entirely.
  * For a changed room, you MUST still give its "type". Include "x"/"y"/"widthCm"/
    "depthCm" only if you moved/resized it (otherwise omit and the server keeps them).
- FURNITURE in a changed room: include the "furniture" array ONLY if you are
  changing that room's furniture. When you do, list the room's COMPLETE resulting
  furniture — echo every existing entry by its "id" (keep their positions) and add
  the new item as { "category": "<FurnitureCategory>" }. To remove an item, drop
  its entry. (The server rebuilds the room's furniture from exactly this list, so a
  missing existing id = deleted.)
- "exterior": include ONLY the keys you changed; omit it entirely if the request
  doesn't touch the facade/style. "floors": include only if the user changes the
  floor count.
- Keep the patch as SMALL as possible. Do NOT echo unchanged floors, rooms, or
  furniture — that risks truncating the response.
- This PARTIAL/PATCH rule applies ONLY in EDIT MODE. Without a CURRENT DESIGN,
  output the COMPLETE design as described above.

REFERENCE PHOTO MODE (用户消息附带一张参考房间照片时):
- 你的任务是「按图复刻」：识别照片里这一间房的类型、大致尺寸、家具清单与相对
  摆位、墙/地材质色调、窗户位置、灯具类型，然后用本 schema 输出这一间房。
- "floorLayouts" 只含一层、一间房。房间 "type" 按照片判断（卧室→bedroom/master、
  客厅→living、餐厅→dining…）；用户文字点名了房间就用他点名的 type。
- 家具映射到最接近的 FurnitureCategory 并给 "x"/"y" 还原照片相对布局
  （如圆桌居中、椅子环绕 → 桌 x=width/2,y=depth/2，椅子绕四周）。
- 墙/地/灯从 AVAILABLE MATERIALS 挑色调最接近的 id；窗户按照片所在墙面开
  （照片正对的墙通常是 N 或 S，自行判断合理即可）。
- EDIT MODE + 照片：
  * 用户点名了房间 → 复刻到那间（保留其 x/y 位置，只换家具/材质/窗）。
  * 没点名但 CURRENT DESIGN 已有同类型房间 → 复刻进那间。
  * 用户说「新增/加一间」或 CURRENT DESIGN 没有同类型房间 → 新增：选一个
    CURRENT DESIGN 里不存在的 type（同类被占就用 custom1-custom5），并看现有
    各房间的 x/y/widthCm/depthCm 挑一个不重叠的空位摆放。
  * 无论哪种，其余房间一律不动（不要出现在输出里）。

OUTPUT ONLY the JSON. No explanation. No markdown.`;

// ─── Helper: strip markdown fences and parse JSON ────────────────────────────
// 宽容解析：先去围栏，解析失败再退而求其次，截取第一个 { 到最后一个 } 的子串
// （有的模型会在 JSON 前后多带一句话）。
function parseJSON(raw: string): unknown {
  const clean = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(clean.slice(first, last + 1));
    }
    throw new Error("no JSON object found");
  }
}

// ─── 工具调用架构（emit_design） ─────────────────────────────────────────────
// 让支持函数调用的模型把"方案"当成一次工具调用的参数产出，平台会强制参数是一个
// 合法 JSON 对象（不裹 markdown、不夹散文）——从根上消除"返回不是 JSON"这类解析
// 失败。参数 schema 只锁顶层结构，字段细节仍交给 SYSTEM_PROMPT 约束：既避免与
// prose schema 双写难同步，又给弱模型留足自由度。
const DESIGN_TOOL_PARAMS = {
  type: "object",
  properties: {
    floors: { type: "integer" },
    exterior: { type: "object" },
    floorLayouts: { type: "array" },
    yard: { type: "object" },
    summary: { type: "string" },
  },
  required: ["floorLayouts"],
  additionalProperties: true,
} as const;

// OpenAI 兼容的 tools 形态（智谱/通义/Kimi/DeepSeek/Grok/OpenAI 都用这套）。
const OPENAI_DESIGN_TOOL = {
  type: "function",
  function: {
    name: "emit_design",
    description: "提交住宅设计方案 JSON（schema 见 system 提示）。必须通过本工具返回结果。",
    parameters: DESIGN_TOOL_PARAMS,
  },
} as const;

type OutputMode = import("@/lib/aiProviders").AiOutputMode;

/** native→json→text 单向降级。任一档位失败都能自愈退到更兼容的档位。 */
function degradeOutput(m: OutputMode): OutputMode {
  return m === "native" ? "json" : "text";
}

/** 按输出档位拼 OpenAI 兼容请求体。user 可以是纯文本，也可以是
 *  多模态 content 数组（文本 + image_url，照片复刻房间用）。 */
function buildProviderBody(model: string, system: string, user: string | unknown[], mode: OutputMode, maxTokens?: number) {
  const base = {
    model,
    // 完整方案 JSON 可能很长（多楼层 + 每房家具/窗/材质），给足 8000 防截断；
    // 但要尊重平台的输出 token 硬顶（如 glm-4-flash 上限 4095，超了直接 400）。
    max_tokens: Math.min(8000, maxTokens ?? 8000),
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (mode === "native") {
    return {
      ...base,
      tools: [OPENAI_DESIGN_TOOL],
      tool_choice: { type: "function", function: { name: "emit_design" } },
    };
  }
  if (mode === "json") {
    return { ...base, response_format: { type: "json_object" } };
  }
  return base;
}

/** 从 OpenAI 兼容响应里取出方案对象：native 优先读 tool_calls.arguments，
 *  否则（含模型无视 tools 把 JSON 放进 content 的情况）回退到 content 宽容解析。 */
function extractProviderDesign(data: unknown, mode: OutputMode): unknown {
  const msg = (data as { choices?: Array<{ message?: {
    content?: string;
    tool_calls?: Array<{ function?: { arguments?: string } }>;
  } }> })?.choices?.[0]?.message;
  if (mode === "native") {
    const args = msg?.tool_calls?.[0]?.function?.arguments;
    if (typeof args === "string" && args.trim()) return parseJSON(args);
  }
  const raw = msg?.content ?? "";
  return parseJSON(raw);
}

export async function POST(req: NextRequest) {
  let description = "";
  let floors = 0;
  let apiKey = "";
  let providerId = "";
  let mode: "create" | "edit" = "create";
  let current: unknown = null;
  let image = "";
  try {
    const body = await req.json();
    description = (body.description ?? "").trim();
    floors = Number(body.floors) || 0;
    apiKey = (body.apiKey ?? "").trim();
    providerId = body.provider ?? "";
    mode = body.mode === "edit" ? "edit" : "create";
    current = body.current ?? null;
    // 参考房间照片（data URL，base64）。给了就走视觉模型按图复刻房间。
    image = typeof body.image === "string" && body.image.startsWith("data:image/")
      ? body.image : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!description && !image) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const provider = getAiProvider(providerId);
  // BYOK 优先：用户弹窗自带的 key > 服务端 env 兜底（仅智谱有兜底）
  const envFallback = provider.id === "zhipu" ? (ZHIPUAI_API_KEY ?? "") : "";
  const providerKey = apiKey || envFallback;

  if (!ANTHROPIC_API_KEY && !providerKey) {
    return NextResponse.json(
      { error: "no_key", message: "尚未配置大模型 API Key —— 在弹窗里选平台并填入即可（密钥只存你本机）" },
      { status: 401 }
    );
  }

  const desc = description || "请参照附带的照片复刻这间房";
  const baseMessage = image
    ? `请按 REFERENCE PHOTO MODE 处理：参照附带的房间照片复刻这间房。${description ? `补充要求：${description}` : ""}`
    : floors > 0
      ? `请帮我设计一个${floors}层的住宅。需求描述：${desc}`
      : `请帮我设计一个住宅。需求描述：${desc}`;
  // 增量微调：把当前设计快照交给模型，让它在原方案上改，而不是重建
  const userText = mode === "edit" && current
    ? `这是当前设计（CURRENT DESIGN）：\n${JSON.stringify(current)}\n\n请在此基础上做增量修改。修改要求：${baseMessage}\n只改我提到的部分，其余保持不变。返回完整 JSON。`
    : baseMessage;
  // 带照片 → OpenAI 兼容多模态 content（text + image_url，各家通用）。
  const userMessage: string | unknown[] = image
    ? [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: image } },
      ]
    : userText;

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
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          // 工具调用：强制 Claude 通过 emit_design 工具回参，拿到的就是合法 JSON 对象。
          tools: [{ name: "emit_design", description: "提交住宅设计方案 JSON（schema 见 system 提示）。", input_schema: DESIGN_TOOL_PARAMS }],
          tool_choice: { type: "tool", name: "emit_design" },
          // Anthropic 的图片块格式与 OpenAI 兼容层不同：data URL 拆成 base64 source。
          messages: [{
            role: "user",
            content: image
              ? (() => {
                  const m = image.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
                  return m
                    ? [
                        { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
                        { type: "text", text: userText },
                      ]
                    : userText;
                })()
              : userText,
          }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // 优先取 tool_use 块的 input（结构化对象）；兜底再读文本块宽容解析。
        const blocks: Array<{ type?: string; input?: unknown; text?: string }> = data?.content ?? [];
        const toolBlock = blocks.find(b => b.type === "tool_use");
        try {
          if (toolBlock?.input && typeof toolBlock.input === "object") {
            return NextResponse.json(toolBlock.input);
          }
          const raw = blocks.find(b => b.type === "text")?.text ?? "";
          return NextResponse.json(parseJSON(raw));
        } catch {
          console.error("[ai-design/claude] JSON parse error");
          // Fall through to ZhipuAI
        }
      } else {
        console.warn("[ai-design/claude] non-OK status:", res.status);
      }
    } catch (e) {
      console.warn("[ai-design/claude] fetch error:", e);
    }
  }

  // ── 2. Fallback: 所选平台文本模型（OpenAI 兼容） ─────────────────────────
  if (providerKey) {
    const callProvider = (mode: OutputMode) => fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${providerKey}`,
      },
      // 带照片走视觉模型（户型/外观解析同款），纯文字走文本模型。
      // 视觉档的 max_tokens 上限往往更紧（glm-4v-flash 限 1024），单独取。
      body: JSON.stringify(buildProviderBody(
        image ? provider.visionModel : provider.textModel,
        SYSTEM_PROMPT, userMessage, mode,
        image ? (provider.visionMaxTokens ?? provider.maxTokens) : provider.maxTokens,
      )),
    });

    // 免费档（尤其 Gemini）经常 429/503 限流或过载——这类是「瞬时」错误，重试一次常能成。
    const isTransient = (status: number) => status === 429 || status >= 500;
    // 工具调用为首选档位；若平台不吃 tools/response_format（400/422）或解析失败，
    // 就自愈降级 native→json→text，最多 2 次降级，绝不会把某个平台彻底搞挂。
    // 视觉模型普遍不支持函数调用（如 glm-4v-flash）→ 带照片时首档降到 json。
    let outputMode: OutputMode = image
      ? (provider.output === "text" ? "text" : "json")
      : (provider.output ?? "text");
    let lastStatus = 0;
    let lastDetail = "";
    let threw = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      // 仅在「瞬时」错误后退避；因降级而重试则立刻再来一发。
      if (attempt > 0 && lastStatus && isTransient(lastStatus)) {
        await new Promise((r) => setTimeout(r, 1200));
      }
      try {
        const res = await callProvider(outputMode);
        if (res.ok) {
          const data = await res.json();
          try {
            return NextResponse.json(extractProviderDesign(data, outputMode));
          } catch (parseErr) {
            console.error("[ai-design/provider] parse error in", outputMode, parseErr);
            // 还能降级就降级再试（如 native 拿不到 tool_call → 退 json/text）。
            const next = degradeOutput(outputMode);
            if (next !== outputMode) { outputMode = next; lastStatus = 0; continue; }
            return NextResponse.json({ error: "AI 返回的内容不是合法 JSON，请重试" }, { status: 502 });
          }
        }
        // 非 2xx：记录。400/422 多半是 tools/response_format 不被支持 → 降级重试。
        lastStatus = res.status;
        lastDetail = (await res.text()).slice(0, 300);
        console.error("[ai-design/provider] non-OK:", res.status, outputMode, lastDetail);
        if ((res.status === 400 || res.status === 422)) {
          const next = degradeOutput(outputMode);
          if (next !== outputMode) { outputMode = next; continue; }
        }
        if (!isTransient(res.status)) break;
      } catch (e) {
        threw = true;
        lastDetail = e instanceof Error ? e.message : String(e);
        console.error("[ai-design/provider] fetch error:", e);
        // 抛错（DNS/超时/TLS）也按瞬时处理，重试一次
      }
    }

    // 重试后仍失败：给出「是哪家平台 + 什么状态 + 该怎么办」的中文提示
    if (lastStatus === 401 || lastStatus === 403) {
      return NextResponse.json(
        { error: `${provider.label} 拒绝了密钥（${lastStatus}）：请在 ⚙️ 里检查/更换 API Key`, detail: lastDetail },
        { status: 401 },
      );
    }
    if (lastStatus === 429 || lastStatus >= 500) {
      return NextResponse.json(
        { error: `${provider.label} 当前繁忙/限流（${lastStatus}），免费档高峰常如此——稍等重试，或在 ⚙️ 换个平台`, detail: lastDetail },
        { status: 502 },
      );
    }
    if (threw) {
      return NextResponse.json(
        { error: `连接 ${provider.label} 失败：${lastDetail || "网络错误"}，请稍后重试或在 ⚙️ 换个平台`, detail: lastDetail },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: `${provider.label} 返回错误（${lastStatus}），请重试或在 ⚙️ 换个平台`, detail: lastDetail },
      { status: 502 },
    );
  }

  return NextResponse.json({ error: "All AI providers failed" }, { status: 502 });
}
