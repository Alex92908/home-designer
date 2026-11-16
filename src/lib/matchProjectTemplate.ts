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
  // 学校饭堂：饭堂直指；带学校/校园/公司限定的食堂也归饭堂（裸"食堂"仍归餐厅，见下条）。
  { id: "set-school-cafeteria", name: "学校饭堂片场", nameEn: "School cafeteria set", re: /饭堂|(学校|校园|公司).*食堂|食堂.*(学校|校园|公司)|school\s*(canteen|cafeteria)|canteen|cafeteria/i },
  { id: "set-restaurant", name: "餐厅片场", nameEn: "Restaurant set", re: /餐厅|餐馆|饭店|食堂|小吃|火锅|hotpot|restaurant|diner|bistro|eatery/i },
  // ── 高频日常场景（学校/家庭/公司/联想补充）：具体词在前，泛词在后 ──
  // 学校操场：操场/运动场直指；田径场/跑道另见下条。
  { id: "set-school-playground", name: "学校操场片场", nameEn: "School playground set", re: /操场|运动场|playground/i },
  // 学校图书馆：图书馆直指。
  { id: "set-school-library", name: "学校图书馆片场", nameEn: "School library set", re: /图书馆|图书室|library/i },
  // 学校水房：水房/开水房直指；与茶水间不同（茶水间是办公室茶水区，水房是打热水的房间）。
  { id: "set-school-waterroom", name: "学校水房片场", nameEn: "School water room set", re: /水房|开水房|开水间|打水房|water\s*room|boiler\s*room/i },
  // 学校浴室：须带学校/校园限定或澡堂；裸"浴室/淋浴"归家庭卫生间（见下条）。
  { id: "set-school-bathroom", name: "学校浴室片场", nameEn: "School bathroom set", re: /(学校|校园).*(浴室|澡堂|淋浴|洗澡间)|(浴室|澡堂|淋浴|洗澡间).*(学校|校园)|澡堂|学校浴室|学校淋浴|school\s*(bath|shower)/i },
  // 学校停车场：停车场直指。
  { id: "set-school-parking", name: "学校停车场片场", nameEn: "School parking lot set", re: /停车场|停车库|parking|car\s*park/i },
  // 学校田径场：田径场/跑道直指；裸"track"须整词（避开 soundtrack）。
  { id: "set-school-track", name: "学校田径场片场", nameEn: "School track field set", re: /田径场|跑道|athletics|running\s*track|track\s*field|\btrack\b/i },
  // 学生宿舍：宿舍/寝室直指；裸"公寓"仍归公寓客厅（见下条）。
  { id: "set-dormitory", name: "学生宿舍片场", nameEn: "Student dormitory set", re: /宿舍|寝室|dormitory|\bdorm\b/i },
  // 酒店房间：酒店/宾馆直指；须在公司大堂之前（"酒店大堂"归酒店）。
  { id: "set-hotel-room", name: "酒店房间片场", nameEn: "Hotel room set", re: /酒店|宾馆|hotel|motel/i },
  // 卧室：裸"卧室"归家庭卧室；"酒店卧室"已由酒店抢先。
  { id: "set-home-bedroom", name: "卧室片场", nameEn: "Bedroom set", re: /卧室|主卧|bedroom/i },
  // 卫生间：裸"浴室/淋浴"归此；学校浴室已由上条抢先。
  { id: "set-home-bathroom", name: "卫生间片场", nameEn: "Bathroom set", re: /卫生间|浴室|洗手间|淋浴|洗澡间|bathroom|shower/i },
  // 厨房：裸"厨房"归此；"餐厅厨房"已由餐厅抢先（餐厅在前）。
  { id: "set-home-kitchen", name: "厨房片场", nameEn: "Kitchen set", re: /厨房|灶台|kitchen/i },
  // 总裁办公室：总裁/霸总直指；须在办公室之前（"总裁办公室"含"办公"）。
  { id: "set-office-ceo", name: "总裁办公室片场", nameEn: "CEO office set", re: /总裁|霸总|ceo\s*office|executive\s*office/i },
  // 会议室：须在办公室之前（办公室规则也含"会议室"）。
  { id: "set-office-meeting", name: "会议室片场", nameEn: "Meeting room set", re: /会议室|会议厅|meeting\s*room|boardroom|conference\s*room/i },
  // 公司大堂：前台/大堂直指；"酒店大堂"已由酒店抢先。
  { id: "set-office-lobby", name: "公司大堂片场", nameEn: "Office lobby set", re: /前台|大堂|公司.*lobby|lobby|reception/i },
  // 茶水间：须与学校水房区分（水房是打热水的房间，茶水间是办公室茶水区）。
  { id: "set-office-pantry", name: "茶水间片场", nameEn: "Office pantry set", re: /茶水间|茶水房|pantry|break\s*room|tea\s*room/i },
  // 电梯：电梯直指；"楼梯间"不含"电梯"，不命中。
  { id: "set-office-elevator", name: "电梯片场", nameEn: "Elevator set", re: /电梯|elevator|\blift\b/i },
  // 警局：警局/派出所/警察直指。
  { id: "set-police", name: "警局片场", nameEn: "Police station set", re: /警局|派出所|警察局|警察|police/i },
  // 法庭：法庭/法院直指；裸"court"不用（basketball court 会误撞）。
  { id: "set-courtroom", name: "法庭片场", nameEn: "Courtroom set", re: /法庭|法院|courtroom|law\s*court/i },
  // 酒吧：酒吧直指；英文 bar 须整词（避开 barbecue/barista）。
  { id: "set-bar", name: "酒吧片场", nameEn: "Bar set", re: /酒吧|酒吧间|\bbar\b|\bpub\b|nightclub/i },
  // 健身房：健身房/健身直指。
  { id: "set-gym", name: "健身房片场", nameEn: "Gym set", re: /健身房|健身|gym|fitness/i },
  // 超市：超市直指；便利店暂归超市（小卖部场景的近似）。
  { id: "set-supermarket", name: "超市片场", nameEn: "Supermarket set", re: /超市|便利店|supermarket|grocery/i },
  // KTV：KTV/卡拉OK直指。
  { id: "set-ktv", name: "KTV片场", nameEn: "KTV set", re: /KTV|ktv|卡拉OK|卡拉ok|karaoke/i },
  // 婚礼宴会厅：须带婚礼/婚宴限定；裸"宴会厅"仍归唐宫（见唐宫条）；须在唐宫之前。
  { id: "set-wedding", name: "婚礼宴会厅片场", nameEn: "Wedding banquet hall set", re: /婚礼|婚宴|婚礼宴会厅|wedding|banquet\s*hall/i },
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
