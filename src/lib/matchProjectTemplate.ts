/**
 * matchProjectTemplate — 文生设计的「模板底子」路由。
 *
 * 用户描述命中已有精修项目模板（咖啡馆/餐厅/办公室/各风格别墅）时，返回该模板：
 * 文生设计先秒套模板当底子，再把它序列化成 current 转「微调(edit)」模式发给 AI——
 * AI 只按描述里的具体要求做增量调整（如"玻璃门面、吧台卡座"），其余保持模板质量。
 * 这是「借鉴模板数据 + 结合用户想法」，不是关键词→整套硬替换（用户明确要求），也
 * 不是从零瞎生成一套差的（用户实拍：说咖啡馆给了个带泳池的别墅）。
 *
 * 表是纯字符串 id（不 import 重型 projectTemplates 模块，client bundle 零增量）；
 * 顺序即优先级：**具体风格在前，泛「别墅」兜底在最后**。业态词（咖啡/餐厅/办公）
 * 排最前——业态比风格词更能代表用户意图（"玻璃门面的咖啡馆"应命中咖啡馆而非幕墙别墅）。
 */
export interface TemplateMatch {
  id: string;
  name: string;
  nameEn: string;
}

const RULES: Array<TemplateMatch & { re: RegExp }> = [
  // ── 业态（片场）──
  { id: "set-cafe", name: "咖啡馆片场", nameEn: "Café set", re: /咖啡|café|cafe|coffee/i },
  { id: "set-restaurant", name: "餐厅片场", nameEn: "Restaurant set", re: /餐厅|餐馆|饭店|食堂|小吃|火锅|hotpot|restaurant|diner|bistro|eatery/i },
  { id: "set-office", name: "办公室片场", nameEn: "Office set", re: /办公|职场|工位|会议室|office|workplace|workspace/i },
  // 公寓客厅：公寓/起居室/living room 直指本片场；裸"客厅"太泛（别墅也有
  // 客厅），只在带户型词（小户型/两居/三居/一居）时才算公寓意图。
  { id: "set-apartment", name: "公寓客厅片场", nameEn: "Apartment set", re: /公寓|起居室|loft|apartment|condo|living\s*room|(小户型|两居|三居|一居).*客厅|客厅.*(小户型|两居|三居|一居)/i },
  // 近郊别墅：近郊/郊区别墅直指；裸"别墅"太泛，仍走最后的泛别墅兜底。
  { id: "set-villa-suburban", name: "近郊别墅片场", nameEn: "Suburban villa set", re: /近郊别墅|郊区别墅|郊野别墅|suburban\s*villa/i },
  // 学校教室：学校/教室/课堂/黑板直指；裸"课"太泛，不用。
  { id: "set-school", name: "学校教室片场", nameEn: "School classroom set", re: /学校|教室|课堂|黑板|classroom|school/i },
  // 医院病房：医院/病房/住院直指；裸"看病"太泛，不用。
  { id: "set-hospital", name: "医院病房片场", nameEn: "Hospital ward set", re: /医院|病房|住院|诊所|hospital|ward|clinic/i },
  // 秦汉：秦汉/秦朝/汉朝直指；裸"汉"太泛（汉语/汉人），不用；秦代室内据汉代反推。
  { id: "set-qinhan", name: "秦汉片场", nameEn: "Qin/Han set", re: /秦汉|秦朝|秦代|汉朝|汉代|qinhan|han\s*dynasty/i },
  // 魏晋南北朝：魏晋/南北朝/清谈/胡床直指。
  { id: "set-weijin", name: "魏晋南北朝片场", nameEn: "Wei-Jin set", re: /魏晋|南北朝|清谈|胡床|weijin|wei-jin/i },
  // 元代：元朝/元代/蒙古包直指；裸"元"太泛（单元/元旦），不用。
  { id: "set-yuan", name: "元代片场", nameEn: "Yuan set", re: /元朝|元代|蒙古包|斡耳朵|金帐|毡帐|yuan\s*dynasty|mongol|ger\b/i },
  // 半坡/仰韶：半坡/仰韶直指；与河姆渡互斥，各自独立规则。
  { id: "set-banpo", name: "半坡片场", nameEn: "Banpo set", re: /半坡|仰韶|banpo|yangshao/i },
  // 河姆渡：河姆渡/干栏直指；与半坡互斥。
  { id: "set-hemudu", name: "河姆渡片场", nameEn: "Hemudu set", re: /河姆渡|干栏|hemudu/i },
  // 明代厅堂：明代/明朝/明式/明厅/正厅直指；裸"厅堂"太泛，只在带"明"时
  // 才算明代意图（"农村厅堂"归农村堂屋，不归这里）。
  { id: "set-ming-hall", name: "明代厅堂片场", nameEn: "Ming hall set", re: /明代|明朝|明式|明厅|正厅|(明.*厅堂|厅堂.*明)/i },
  // 清宫三希堂：三希堂/清宫/乾隆/暖阁直指；清代泛指清朝场景。
  { id: "set-qing-sanxitang", name: "清宫三希堂片场", nameEn: "Qing Sanxitang set", re: /三希堂|清宫|清朝|乾隆|暖阁|清代|qing|sanxitang/i },
  // 唐宫宴会厅：唐朝/唐代/唐宫/大唐/宫廷直指；宴会厅是唐宫宴饮场景。
  { id: "set-tang-palace", name: "唐宫宴会厅片场", nameEn: "Tang palace set", re: /唐朝|唐代|唐宫|大唐|宫廷|宴会厅|tang/i },
  // 宋代书斋：书斋/文人直指；宋朝/宋代泛指宋朝场景。裸"书房"太泛（现代
  // 书房也叫书房），不用。
  { id: "set-song-study", name: "宋代书斋片场", nameEn: "Song study set", re: /宋朝|宋代|宋式|书斋|文人|sung|song/i },
  // 民国农村：民国农村/窑洞/火炕/一明二暗直指；必须排在农村堂屋与石库门
  // 之前——"民国农村"既含"农村"又含"民国"，放后面会被两边抢走；裸"民国"
  // 仍归石库门，裸"农村"仍归农村堂屋。
  { id: "set-rural-republican", name: "民国农村片场", nameEn: "Republican rural set", re: /民国农村|农村.*民国|民国.*农村|乡下.*民国|民国.*乡下|窑洞|火炕|一明二暗|yaodong/i },
  // 农村自建房堂屋：农村/自建房/堂屋/农家直指；裸"院子"太泛（别墅也有院子），不用。
  { id: "set-rural-hall", name: "农村堂屋片场", nameEn: "Rural hall set", re: /农村|自建房|堂屋|农家|乡下|rural|farmhouse/i },
  // 民国石库门：石库门/亭子间/海派/民国直指；裸"上海"太泛（上海公寓应归
  // 公寓），不用。
  { id: "set-shikumen", name: "民国石库门片场", nameEn: "Shikumen set", re: /石库门|石库|亭子间|海派|民国|弄堂|shikumen|republican/i },
  // 凡尔赛宫：凡尔赛/镜厅直指。
  { id: "set-versailles", name: "凡尔赛宫片场", nameEn: "Versailles set", re: /凡尔赛|镜厅|versailles|hall\s*of\s*mirrors/i },
  // 日本和室：和室/榻榻米/床の间/障子直指；裸"日本"太泛（日式别墅另有归属），不用。
  { id: "set-washitsu", name: "日本和室片场", nameEn: "Washitsu set", re: /和室|榻榻米|床の间|障子|washitsu|tatami/i },
  // 韩国韩屋：韩屋/温突直指。
  { id: "set-hanok", name: "韩国韩屋片场", nameEn: "Hanok set", re: /韩屋|温突|ondol|hanok/i },
  // ── 风格别墅（具体风格在前）──
  { id: "japanese-zen-villa", name: "日式禅意庭院", nameEn: "Japanese zen villa", re: /日式|禅|枯山水|zen|japanese/i },
  { id: "mediterranean-villa", name: "地中海庭院别墅", nameEn: "Mediterranean villa", re: /地中海|mediterranean/i },
  { id: "luxury-3f-glass-villa", name: "豪华三层玻璃别墅", nameEn: "3-storey glass villa", re: /三层|3\s*层|三楼/i },
  { id: "wood-accent-pool-villa", name: "木饰面泳池别墅", nameEn: "Wood-accent pool villa", re: /木饰面|原木|木质/i },
  { id: "glass-curtain-villa", name: "现代玻璃幕墙别墅", nameEn: "Glass-curtain villa", re: /玻璃幕墙|幕墙|curtain\s*wall|glass\s*curtain/i },
  { id: "modern-pool-villa", name: "现代泳池别墅", nameEn: "Modern pool villa", re: /泳池|游泳池|pool/i },
  // ── 泛别墅/住宅兜底 ──
  { id: "modern-pool-villa", name: "现代泳池别墅", nameEn: "Modern pool villa", re: /别墅|洋房|villa/i },
];

/** 命中返回模板信息；没命中返回 null（上层回落原从零生成）。 */
export function matchProjectTemplate(description: string): TemplateMatch | null {
  const d = description.trim();
  if (!d) return null;
  for (const r of RULES) {
    if (r.re.test(d)) return { id: r.id, name: r.name, nameEn: r.nameEn };
  }
  return null;
}
