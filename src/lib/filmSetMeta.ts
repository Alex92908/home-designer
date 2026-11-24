/**
 * filmSetMeta — 全部片场（63 个）的「纯元数据」（零依赖）。
 *
 * 首页只需要每套片场的名字/emoji/一句话描述来渲染列表，绝不该为此把
 * projectTemplates + 整个家具目录 + three.js 拖进首页的包。所以列表文案
 * 单独放这里（不 import 任何重模块），与 showcaseMeta.ts 同一做法。
 *
 * 数据来源：src/lib/projectTemplates.ts 的 PROJECT_TEMPLATES，取 name/desc
 * 含“片场”的全部条目（2026-11-24 共 63 个）。模板增减时同步更新本文件。
 */

export interface FilmSetMeta {
  id: string;
  name: string;
  emoji: string;
  desc: string;
}

export const FILM_SET_META: FilmSetMeta[] = [
  { id: "set-cafe", name: "咖啡馆片场", emoji: "☕", desc: "片场 · 单层 · 玻璃门面 · 吧台+四组卡座 · 拍对话/日常戏" },
  { id: "set-office", name: "办公室片场", emoji: "💼", desc: "片场 · 单层 · 开放工位+会议室+茶水间 · 拍职场戏" },
  { id: "set-restaurant", name: "餐厅片场", emoji: "🍽️", desc: "片场 · 单层 · 大堂散座+卡座+吧台 · 包间×2+VIP包间 · 商用后厨 · 男女洗手间 · 骑楼露天" },
  { id: "set-apartment", name: "公寓客厅片场", emoji: "🛋️", desc: "片场 · 单层 · 两居 80㎡ · 大客厅+餐厅 · 拍家庭/日常对话戏" },
  { id: "set-rural-hall", name: "农村堂屋片场", emoji: "🏮", desc: "片场 · 单层 · 堂屋+厨房+卧房+院子 · 108㎡ · 拍农村家庭/乡土戏" },
  { id: "set-ming-hall", name: "明代厅堂片场", emoji: "🏛️", desc: "片场 · 单层 · 正厅+内室+前廊 · 112㎡ · 明式厅堂 · 拍古装/宅斗戏" },
  { id: "set-qing-sanxitang", name: "清宫三希堂片场", emoji: "📜", desc: "片场 · 单层 · 三希堂书斋+外间+藏书间+耳房 · 54㎡ · 小而精的宫廷书房 · 拍清宫/帝王戏" },
  { id: "set-tang-palace", name: "唐宫宴会厅片场", emoji: "🏮", desc: "片场 · 单层 · 宴会厅+偏厅+前廊 · 126㎡ · 拍唐宫/宴饮/宫廷戏" },
  { id: "set-song-study", name: "宋代书斋片场", emoji: "📖", desc: "片场 · 单层 · 书斋+内室+庭院 · 70㎡ · 文人四艺 · 拍宋式文人/书生戏" },
  { id: "set-shikumen", name: "民国石库门片场", emoji: "🏠", desc: "片场 · 单层 · 客堂间+亭子间+灶间+卧房+前后天井 · 80㎡ · 拍民国上海/海派戏" },
  { id: "set-villa-suburban", name: "近郊别墅片场", emoji: "🏡", desc: "片场 · 两层 · 挑高客厅+茶室+双厨房+影音健身酒窖 · 480㎡ · 拍别墅/豪门戏" },
  { id: "set-school", name: "学校教室片场", emoji: "🏫", desc: "片场 · 单层 · 教室+教师办公室+走廊 · 180㎡ · 传统黑板教室 · 拍校园/青春戏" },
  { id: "set-hospital", name: "医院病房片场", emoji: "🏥", desc: "片场 · 单层 · 三床病房+护士站+卫生间+走廊 · 130㎡ · 拍医院/陪护戏" },
  { id: "set-qinhan", name: "秦汉片场", emoji: "🏺", desc: "片场 · 单层 · 正厅+内室+前廊 · 150㎡ · 据汉代反推 · 席地分餐 · 拍秦汉戏" },
  { id: "set-weijin", name: "魏晋南北朝片场", emoji: "🧘", desc: "片场 · 单层 · 书斋+清谈室+庭院 · 110㎡ · 胡床/青瓷/清谈 · 拍魏晋风度戏" },
  { id: "set-yuan", name: "元代片场", emoji: "⛺", desc: "片场 · 单层 · 蒙古包+汉式宫殿 · 140㎡ · 复原 · 毡帐与宫殿两极 · 拍元代戏" },
  { id: "set-banpo", name: "半坡片场", emoji: "🏺", desc: "片场 · 单层 · 160㎡大房子+半地穴屋 · 200㎡ · 无家具 · 只火塘土台陶罐 · 拍史前戏" },
  { id: "set-hemudu", name: "河姆渡片场", emoji: "🌾", desc: "片场 · 单层 · 23m干栏长屋+晒场 · 230㎡ · 种稻 · 楼上住人楼下养畜 · 拍史前戏" },
  { id: "set-rural-republican", name: "民国农村片场", emoji: "🏮", desc: "片场 · 单层 · 一明二暗+院子 · 120㎡ · 火炕/油灯 · 无电灯 · 拍民国乡土戏" },
  { id: "set-versailles", name: "凡尔赛宫片场", emoji: "👑", desc: "片场 · 单层 · 镜厅+沙龙+花园 · 280㎡ · 镜墙/水晶灯 · 无厕所浴室 · 拍宫廷戏" },
  { id: "set-washitsu", name: "日本和室片场", emoji: "🎋", desc: "片场 · 单层 · 和室+茶室+缘侧 · 60㎡ · 榻榻米/床の間/障子 · 拍日式日常戏" },
  { id: "set-hanok", name: "韩国韩屋片场", emoji: "🏯", desc: "片场 · 单层 · 温突房+大厅+厨房+院子 · 110㎡ · 温突/木地板大厅 · 院子空旷 · 拍韩式日常戏" },
  { id: "set-tang-changan-prosperous", name: "盛唐长安片场", emoji: "🏮", desc: "片场 · 单层 · 朱雀大街+东市+西市 · 216㎡ · 盛唐长安 · 拍长安繁华/市集/灯会戏" },
  { id: "set-tang-changan-ruined", name: "安史后长安片场", emoji: "🏚️", desc: "片场 · 单层 · 朱雀大街+东市+西市 · 216㎡ · 安史之乱后长安 · 拍战后萧条/废墟/流亡戏" },
  { id: "set-song-bianjing-prosperous", name: "北宋汴京片场", emoji: "🎆", desc: "片场 · 单层 · 御街+樊楼酒肆+茶肆书场 · 216㎡ · 北宋汴京 · 拍清明上河/市井/酒楼戏" },
  { id: "set-song-bianjing-ruined", name: "靖康后汴京片场", emoji: "🏚️", desc: "片场 · 单层 · 御街+樊楼酒肆+茶肆书场 · 216㎡ · 靖康之变后汴京 · 拍国破/萧条/流亡戏" },
  { id: "set-qing-garden-prosperous", name: "圆明园盛时片场", emoji: "🌸", desc: "片场 · 单层 · 正大光明殿+长春园书房+后湖园林 · 160㎡ · 圆明园盛时 · 拍清宫/园林/盛世戏" },
  { id: "set-qing-garden-ruined", name: "火烧圆明园后片场", emoji: "🏚️", desc: "片场 · 单层 · 正大光明殿+长春园书房+后湖园林 · 160㎡ · 火烧圆明园后废墟 · 拍劫后/废墟/凭吊戏" },
  { id: "set-ming-palace-prosperous", name: "大明宫盛时片场", emoji: "👑", desc: "片场 · 单层 · 含元殿+宣政殿偏殿+丹凤门前廊 · 126㎡ · 大明宫盛时 · 拍宫廷/朝会/宴饮戏" },
  { id: "set-ming-palace-ruined", name: "大明宫废墟片场", emoji: "🏚️", desc: "片场 · 单层 · 含元殿+宣政殿偏殿+丹凤门前廊 · 126㎡ · 大明宫废墟 · 拍王朝倾覆/废墟/凭吊戏" },
  { id: "set-rome-prosperous", name: "罗马鼎盛片场", emoji: "🏛️", desc: "片场 · 单层 · 罗马广场+元老院议事厅+市集廊柱 · 160㎡ · 罗马鼎盛 · 拍罗马/元老院/市集戏" },
  { id: "set-rome-ruined", name: "罗马陷落后片场", emoji: "🏚️", desc: "片场 · 单层 · 罗马广场+元老院议事厅+市集廊柱 · 160㎡ · 罗马陷落后 · 拍帝国倾覆/废墟/蛮族戏" },
  { id: "set-pompeii-prosperous", name: "庞贝繁华片场", emoji: "🏺", desc: "片场 · 单层 · 庞贝民居中庭+面包房商铺+石板街道 · 126㎡ · 庞贝繁华 · 拍罗马市井/家庭戏" },
  { id: "set-pompeii-ruined", name: "庞贝废墟片场", emoji: "🌋", desc: "片场 · 单层 · 庞贝民居中庭+面包房商铺+石板街道 · 126㎡ · 火山爆发后庞贝 · 拍灾难/废墟/考古戏" },
  { id: "set-loulan-prosperous", name: "楼兰繁华片场", emoji: "🐫", desc: "片场 · 单层 · 丝路集市+客栈驼队院+胡商铺面 · 160㎡ · 楼兰繁华 · 拍丝路/胡商/驼队戏" },
  { id: "set-loulan-ruined", name: "楼兰废墟片场", emoji: "🏚️", desc: "片场 · 单层 · 丝路集市+客栈驼队院+胡商铺面 · 160㎡ · 楼兰沙漠废墟 · 拍丝路湮没/沙漠/考古戏" },
  { id: "set-mall-prosperous", name: "繁华商场片场", emoji: "🛍️", desc: "片场 · 单层 · 中庭+品牌店+扶梯走廊 · 180㎡ · 繁华商场 · 拍逛街/约会/都市戏" },
  { id: "set-mall-ruined", name: "废弃商场片场", emoji: "🏚️", desc: "片场 · 单层 · 中庭+品牌店+扶梯走廊 · 180㎡ · 废弃商场 · 拍末世/探险/悬疑戏" },
  { id: "set-mansion-prosperous", name: "豪宅片场", emoji: "🏰", desc: "片场 · 单层 · 客厅+餐厅+门廊 · 135㎡ · 豪宅 · 拍豪门/婚恋/家族戏" },
  { id: "set-mansion-ruined", name: "破败老宅片场", emoji: "🏚️", desc: "片场 · 单层 · 客厅+餐厅+门廊 · 135㎡ · 破败老宅 · 拍落魄/鬼宅/悬疑/寻亲戏" },
  { id: "set-school-prosperous", name: "繁华学校片场", emoji: "🎒", desc: "片场 · 单层 · 教室+图书角+走廊 · 120㎡ · 繁华学校 · 拍校园/青春/师生戏" },
  { id: "set-school-abandoned", name: "废弃学校片场", emoji: "🏚️", desc: "片场 · 单层 · 教室+图书角+走廊 · 120㎡ · 废弃学校 · 拍悬疑/恐怖/寻访旧址戏" },
  { id: "set-village-prosperous", name: "繁华村庄片场", emoji: "🌾", desc: "片场 · 单层 · 村口晒场+堂屋+灶房 · 216㎡ · 繁华村庄 · 拍乡村/乡愁/丰收戏" },
  { id: "set-village-hollow", name: "空心村片场", emoji: "🏚️", desc: "片场 · 单层 · 村口晒场+堂屋+灶房 · 216㎡ · 空心村 · 拍留守/归乡/乡村凋敝戏" },
  { id: "set-digong", name: "地宫片场", emoji: "🏺", desc: "地宫：墓道+主墓室+耳室+祭祀厅+陪葬品室，石灯长明、陶器陪葬的地下宫殿" },
  { id: "set-cemetery", name: "墓地片场", emoji: "🪦", desc: "墓地：石灯成行、残碑断柱、枯树寒鸦的荒野墓园" },
  { id: "set-basement", name: "地下室片场", emoji: "📦", desc: "地下室：储藏间、洗衣房、活动室、工具间，蛛网与旧物的潮湿地库" },
  { id: "set-underground-mall", name: "地下商场片场", emoji: "🛍️", desc: "地下商场：中庭、店铺、美食区、通道，灯火通明的地库商业街" },
  { id: "set-rental", name: "出租房片场", emoji: "🏠", desc: "出租房：卧室、客厅、厨房、卫生间，挤挤挨挨的都市合租小家" },
  { id: "set-hotel", name: "酒店片场", emoji: "🏨", desc: "酒店：大堂、两间客房、餐厅、走廊，金碧辉煌的迎宾大堂" },
  { id: "set-parking", name: "停车场片场", emoji: "🅿️", desc: "停车场：停车区、收费亭、设备间、入口坡道，车灯与立柱的地库" },
  { id: "set-lake-island", name: "湖中岛屿片场", emoji: "🏝️", desc: "湖中岛屿：碧波环绕的湖心岛，凉亭、竹林、石灯、拱桥" },
  { id: "set-ancient-camp", name: "古代军营片场", emoji: "⚔️", desc: "古代军营：点将台、帅帐、营帐、马厩、练兵场，旌旗猎猎的边塞大营" },
  { id: "set-night-market", name: "古代集市/夜市片场", emoji: "🏮", desc: "古代集市：灯笼高挂的夜市长街，摊位成行、酒旗招展的烟火人间" },
  { id: "set-water-town", name: "水乡古镇片场", emoji: "🌉", desc: "水乡古镇：河道穿镇的江南水乡，石桥、乌篷船、临水商铺" },
  { id: "set-airport", name: "机场片场", emoji: "✈️", desc: "机场：值机大厅、候机区、安检、登机口，人来人往的航站楼" },
  { id: "set-prison", name: "监狱片场", emoji: "🔒", desc: "监狱：两间牢房、警卫室、食堂，铁窗与高墙的铁窗生涯" },
  { id: "set-tv-studio", name: "电视台演播厅片场", emoji: "📺", desc: "电视台演播厅：主播台、演播舞台、导播室、化妆间，灯光下的直播现场" },
  { id: "set-temple", name: "寺庙片场", emoji: "🛕", desc: "寺庙：大雄宝殿、偏殿、禅房、山门庭院，香烟缭绕的古刹" },
  { id: "set-metro", name: "地铁站片场", emoji: "🚇", desc: "地铁站：站厅、站台、设备间，闸机与轨道的地下车站" },
  { id: "set-rooftop", name: "天台片场", emoji: "🌇", desc: "天台：城市之上的露台，藤架、躺椅、绿植与万家灯火" },
  { id: "set-desert-oasis", name: "沙漠绿洲片场", emoji: "🌴", desc: "沙漠绿洲：黄沙之中的一泓碧水，棕榈、帐篷与驼队歇脚处" },
  { id: "set-snow-cabin", name: "雪山木屋片场", emoji: "🏔️", desc: "雪山木屋：雪山脚下的小木屋，松雪、篝火与袅袅炊烟" },
];

export const FILM_SET_COUNT = FILM_SET_META.length;
