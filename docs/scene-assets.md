# 导演台新场景 · 3D 资产说明 (Scene Assets)

- **日期：** 2026-11-16
- **范围：** 73 个参考节 / 94 个片场（上一批 12 个研究场景 set-villa-suburban /
  set-school / set-hospital / set-qinhan / set-weijin / set-yuan /
  set-banpo / set-hemudu / set-rural-republican / set-versailles /
  set-washitsu / set-hanok；本批 24 个高频日常场景：学校 7 /
  家庭 3 / 公司 5 / 联想补充 9；成对场景 11 对 = 22 个片场：
  唐长安 / 宋汴京 / 圆明园 / 大明宫 / 罗马 / 庞贝 / 楼兰 / 商场 /
  豪宅 / 学校 / 村庄，各一繁荣态 + 一衰败态；室外片场 26 个：自然 12 / 植物园艺 3 /
  动物相关 2 / 城市户外 4 / 古代户外 5）

## 结论先行：零外部下载，全部程序化 + 复用现有目录

本次 24 个场景 + 成对 22 个场景 + 室外 26 个场景的家具**没有下载任何外部 3D 模型**。原因：

1. 程序化是既定第一优先级（可靠、零许可风险、离线可用、体积零增长）；
2. Sketchfab / NVIDIA 开源资产对这批器物（汉榻/案/几、胡床、蒙古包、
   干栏屋、半地穴屋、博古架、榻榻米/床の間、温突地板；本批：双层床、
   图书馆书架、打饭窗口、开水房水龙头排、篮球架、足球门、跑道、
   总裁大班台、会议长桌、前台、电梯轿厢、法官席、酒吧吧台、跑步机、
   超市货架、收银台、KTV 大屏、婚礼舞台等；成对场景：瓦砾堆、断裂桌案、
   蛛网、杂草、坍塌墙、集市摊位、灯笼杆、罗马柱、牌楼、石井、焦梁、
   枯树、太湖石、倒塌货架等；室外场景：树木/竹丛/山体/水面/帐篷/城墙/谷仓/
   铁轨/店面/拱桥等）没有尺寸、风格、许可证
   三者都合用的现成模型；逐个谈许可证与格式转换的成本远高于
   程序化建模，且会引入二进制体积与来源维护负担；
3. 其余家具全部复用仓库已有 587 件目录（GLB 模型已在仓库内）。

因此本文件无“外部模型许可证 + 来源 URL”条目——不是遗漏，是本次
刻意为零。如未来某件确实需要外部模型，再按“CC0 / CC-BY / MIT /
NVIDIA 开源许可才可用，许可证 + 来源 URL 随模型登记”的规则补登记。

复用既有件（未新增）：蒙古包 proc-yurt（草原）、半坡火塘 proc-banpo-firepit（战场/军营篝火）、
粟束 proc-millet-sheaf（农场）、稻束 proc-rice-sheaf（稻田）、木箱 proc-wood-chest（集市）、
户外长椅 proc-outdoor-bench（湖/海滩/街道/公园/火车站）；目录件：木质围栏 fence（花海/马场/
农场/军营/火车站）、石板小路 stone-path（森林/竹林/山/桃花林/庭院花园/公园/街道/古镇）。
复用成对场景批的件：集市摊位 proc-market-stall（集市/古镇街道）、枯树 proc-dead-tree（沙漠/
战场）、灯笼杆 proc-lantern-pole（古镇街道/集市/桥）、石井 proc-stone-well（古镇街道/集市/农场）。
未建模故缺席：马匹（程序化动物不可行，马场/农场均为空场）、列车（火车站无车）、
古代兵器甲胄战车（战场只有长枪示意）、假山/曲廊（庭院花园）、辕门望楼拒马（军营）、
瓮城角楼拱券城门（城墙为简化形）。

参考图包见 `docs/scene-references.md`（图片均为链接引用，不入库；
只有明确标注公有领域 / CC0 的文件才可下载进仓库）。

## 程序化家具一览（137 件，id 以 `proc-` 开头）

几何：`src/lib/proceduralFurniture.ts`（纯 three.js，无 JSX，可被
node harness 直接验证）；目录登记：`src/lib/furniture.ts`（无
`model3d`，走程序化分支）；渲染分流：`src/components/RoomCanvas.tsx`
`FurnitureMesh` 顶部按 `proc-` 前缀分流到
`src/components/ProceduralFurnitureMesh.tsx`。

| id | 名称 | 用在 | 类别（只为复用承托面/爬升语义） |
|---|---|---|---|
| proc-han-ta | 汉榻（低足榻，足 17–19cm） | 秦汉、魏晋（加高）、元宫殿 | bed |
| proc-han-an | 汉案（低案，12–14cm） | 秦汉、魏晋 | dining_table（承托面） |
| proc-han-ji | 汉几（凭几） | 秦汉、魏晋、民国农村（当小桌复用） | coffee_table（承托面） |
| proc-boshanlu | 博山炉 | 秦汉 | decor |
| proc-lacquer-bowl | 漆碗（黑胎朱口） | 秦汉、魏晋、河姆渡（当漆木碗） | decor |
| proc-huchuang | 胡床（折叠凳） | 魏晋 | dining_chair |
| proc-wood-stool | 木凳 | 魏晋、元、民国农村、别墅茶室/酒窖 | dining_chair |
| proc-celadon-vase | 越窑青瓷瓶 | 魏晋 | decor |
| proc-buddha-statue | 铜佛像（坐姿） | 魏晋（佛龛内置另有小佛） | decor |
| proc-shrine-niche | 佛龛 | 魏晋、元 | storage |
| proc-cross | 十字架 | 元（与佛龛共存） | decor |
| proc-yurt | 蒙古包（斡耳朵，圆毡帐+中柱+天窗圈） | 元 | outdoor_structure |
| proc-bluewhite-vase | 青花瓷瓶（元，高端器物） | 元宫殿 | decor |
| proc-banpo-pot | 半坡彩陶罐 | 半坡 | decor |
| proc-banpo-firepit | 半坡火塘（唯一光源） | 半坡 | decor |
| proc-earth-platform | 土台 | 半坡 | storage |
| proc-banpo-house | 半坡半地穴屋 | 半坡 | outdoor_structure |
| proc-hemudu-pot | 河姆渡黑陶釜 | 河姆渡 | decor |
| proc-hemudu-stilt | 河姆渡干栏长屋（23m） | 河姆渡 | outdoor_structure |
| proc-kang | 火炕 | 民国农村 | bed |
| proc-oil-lamp | 豆油灯 | 民国农村 | decor |
| proc-kerosene-lamp | 煤油灯（1920s+） | 民国农村 | decor |
| proc-wood-chest | 木箱 | 民国农村、元、韩屋 | storage |
| proc-millet-sheaf | 粟束（小米） | 半坡 | decor |
| proc-rice-sheaf | 稻束 | 河姆渡 | decor |
| proc-bogujia | 博古架（多宝格） | 别墅茶室 | bookshelf（承托面） |
| proc-school-desk | 课桌椅 | 学校 | desk |
| proc-blackboard | 黑板 | 学校（前/后黑板） | decor |
| proc-school-broom | 扫帚 | 学校 | decor |
| proc-hospital-bed | 病床（护栏+可调床头） | 医院 | bed |
| proc-iv-stand | 输液架 | 医院 | decor |
| proc-med-strip | 床头设备带（呼叫按钮） | 医院 | decor |
| proc-camp-chair | 陪护折叠椅 | 医院 | dining_chair |
| proc-thermos | 保温壶 | 医院 | decor |
| proc-basin | 脸盆 | 医院、韩屋厨房 | decor |
| proc-mirror-wall | 镜墙 | 凡尔赛 | decor |
| proc-chandelier-crystal | 水晶吊灯 | 凡尔赛 | lamp |
| proc-gilt-chair | 鎏金扶手椅 | 凡尔赛 | dining_chair |
| proc-tatami | 榻榻米（一帖 180×90cm） | 和室、茶室 | rug |
| proc-tokonoma | 床の間 | 和室 | decor |
| proc-shoji | 障子拉门 | 和室、韩屋（当纸门） | decor |
| proc-floor-cushion | 坐垫 | 和室、韩屋 | decor |
| proc-futon | 被褥（折叠） | 和室茶室 | bed |
| proc-ondol-table | 韩屋小桌 | 韩屋 | coffee_table（承托面） |
| proc-ondol-floor | 温突地板 | 韩屋温突房 | rug |
| proc-hanok-stove | 韩屋灶口 | 韩屋厨房 | kitchen_cabinet（承托面） |
| proc-bunk-bed | 双层床（上下铺+护栏+爬梯） | 宿舍 | bed |
| proc-library-shelf | 图书馆书架（双面五层） | 图书馆 | bookshelf |
| proc-cafeteria-table | 饭堂长桌（+两侧长凳） | 饭堂 | dining_table |
| proc-serving-counter | 打饭窗口柜台（玻璃挡板+餐盘菜盆） | 饭堂打饭区 | kitchen_cabinet |
| proc-water-tap-row | 开水房水龙头排（8 龙头+排水槽） | 水房 | kitchen_cabinet（承托面） |
| proc-basketball-hoop | 篮球架（篮板+篮筐+篮网） | 操场 | outdoor_structure |
| proc-goal-post | 足球门（+球网） | 操场、田径场 | outdoor_structure |
| proc-track-lane | 田径跑道（12m 直道垫+分道线） | 田径场 | rug |
| proc-parking-stop | 停车挡（水泥+黄条） | 停车场 | outdoor_hardscape |
| proc-outdoor-bench | 户外长椅 | 操场、浴室、停车场、水房、宿舍、大堂、电梯、法庭、婚礼 | outdoor_structure |
| proc-ceo-desk | 总裁大班台（皮面嵌+抽屉柜） | 总裁办公室 | desk（承托面） |
| proc-meeting-table | 会议长桌（线盒+话筒） | 会议室 | dining_table |
| proc-reception-desk | 前台接待台（石材台面+金色标识板） | 公司大堂 | storage |
| proc-elevator-car | 电梯轿厢（门+后墙镜+扶手+按钮盘） | 电梯 | storage |
| proc-pantry-counter | 茶水间柜台（水槽+水壶+微波炉） | 茶水间 | kitchen_cabinet（承托面） |
| proc-whiteboard | 白板（挂墙） | 饭堂（菜单板）、会议室 | decor |
| proc-evidence-board | 案情板（照片+红线，挂墙） | 警局 | decor |
| proc-bar-counter | 酒吧吧台（背架酒瓶两层+脚踏杆） | 酒吧 | kitchen_cabinet |
| proc-judge-bench | 法官席（高台+法槌） | 法庭 | desk |
| proc-witness-stand | 证人席（围栏+话筒） | 法庭 | desk |
| proc-gym-treadmill | 跑步机（控制台+扶手） | 健身房 | appliance |
| proc-gym-bench | 卧推凳（+杠铃+杠铃片） | 健身房 | appliance |
| proc-dumbbell-rack | 哑铃架（两层+6 对哑铃） | 健身房 | appliance |
| proc-supermarket-shelf | 超市货架（双面四层+商品+价签） | 超市 | bookshelf |
| proc-checkout-counter | 收银台（传送带+收银屏） | 超市 | kitchen_cabinet |
| proc-shopping-cart | 购物车（筐+把手+四轮） | 超市 | storage |
| proc-ktv-screen | KTV 大屏（发光屏面+歌词行，挂墙） | KTV | electronics |
| proc-wedding-arch | 婚礼拱门（花球+飘带） | 婚礼宴会厅 | decor |
| proc-wedding-stage | 婚礼舞台（低台+纱幔+顶梁） | 婚礼宴会厅 | outdoor_structure |
| proc-cooktop | 灶台面板（玻璃+四炉头圈） | 厨房（放橱柜上） | appliance |
| proc-rubble-pile | 瓦砾堆（碎石板+断砖+碎瓦） | 全部衰败态 | decor |
| proc-broken-table | 断裂桌案（桌面倾斜+缺腿） | 全部衰败态（室内） | dining_table |
| proc-broken-chair | 断裂椅子（座面微斜+靠背歪斜+缺腿） | 全部衰败态（室内） | dining_chair |
| proc-cobweb | 蛛网（墙角扇形网，挂墙） | 全部衰败态（室内墙角） | decor |
| proc-weed-clump | 杂草丛（枯黄草叶+土丘） | 全部衰败态 | plant |
| proc-broken-wall | 坍塌墙段（矮墙基+断墙头+露砖） | 全部衰败态 | decor |
| proc-market-stall | 集市摊位（柜台+四柱+顶篷+货物） | 唐长安/宋汴京/罗马/庞贝/楼兰繁荣态 | counter |
| proc-lantern-pole | 灯笼杆（立柱+横挑+红灯笼） | 唐长安/宋汴京/大明宫繁荣态 | decor |
| proc-roman-column | 罗马柱（基座+圆柱身+柱头） | 罗马/庞贝繁荣态 | decor |
| proc-fallen-column | 倒塌石柱（横倒柱身+断鼓+柱头残块） | 罗马/庞贝/圆明园/大明宫衰败态 | decor |
| proc-pailou | 牌楼（双柱+额枋+双层檐顶，简化无翘角） | 唐长安/宋汴京繁荣态 | outdoor_structure |
| proc-stone-well | 石井（石环+井口+双柱小顶） | 楼兰/村庄两态（衰败态干涸留存） | decor |
| proc-burnt-beam | 焦黑断梁（横倒焦木+碎木） | 唐长安/宋汴京/圆明园/大明宫衰败态 | decor |
| proc-dead-tree | 枯树（主干+五条秃枝） | 全部衰败态（室外/门廊） | outdoor_plant |
| proc-rockery | 太湖石（三层叠石） | 圆明园两态（衰败态留存） | decor |
| proc-toppled-shelf | 倒塌货架（侧倒+商品散落） | 商场/学校衰败态 | bookshelf |
| proc-tree-oak | 橡树 | 森林、湖、公园、街道、农场等 | outdoor_plant |
| proc-tree-peach | 桃树 | 桃花林 | outdoor_plant |
| proc-pine | 松树 | 森林、山、悬崖 | outdoor_plant |
| proc-pine-snow | 雪松 | 雪山 | outdoor_plant |
| proc-palm | 棕榈树 | 海滩 | outdoor_plant |
| proc-bamboo-clump | 竹丛 | 竹林、庭院花园 | outdoor_plant |
| proc-rock | 岩石 | 各自然场景 | outdoor_hardscape |
| proc-rock-big | 巨石 | 沙漠、山、悬崖 | outdoor_hardscape |
| proc-bush | 灌木丛 | 各自然场景 | outdoor_plant |
| proc-bush-snow | 雪灌木 | 雪山 | outdoor_plant |
| proc-grass-tuft | 草丛 | 各自然场景 | outdoor_plant |
| proc-flower-lavender | 薰衣草丛 | 花海 | outdoor_plant |
| proc-flower-mixed | 野花丛 | 花海、公园、庭院花园 | outdoor_plant |
| proc-flower-rapeseed | 油菜花丛 | 花海 | outdoor_plant |
| proc-ground-grass | 草地铺面 | 各草地场景（缩放铺满） | outdoor_hardscape |
| proc-ground-sand | 沙地铺面 | 沙漠、海滩、马场骑乘圈 | outdoor_hardscape |
| proc-ground-snow | 雪地铺面 | 雪山 | outdoor_hardscape |
| proc-ground-stone | 石地铺面 | 悬崖、街道、火车站、古镇、城墙 | outdoor_hardscape |
| proc-ground-dry | 干草地铺面 | 草原、战场、军营、农场场院 | outdoor_hardscape |
| proc-water-plane | 水面 | 瀑布水潭、湖、庭院池塘、公园水面、桥下水道 | outdoor_water |
| proc-sea-plane | 海面 | 海滩 | outdoor_water |
| proc-mountain | 远山 | 山、森林、草原、茶园、稻田、战场 | outdoor_hardscape |
| proc-mountain-snow | 雪山 | 雪山、山 | outdoor_hardscape |
| proc-dune | 沙丘 | 沙漠、海滩 | outdoor_hardscape |
| proc-street-lamp | 路灯 | 街道、公园、火车站 | decor |
| proc-tent | 帐篷 | 草原、战场、军营、城墙 | outdoor_structure |
| proc-banner | 旗帜 | 草原、战场、军营、城墙、悬崖、马场 | decor |
| proc-city-wall | 城墙段 | 城墙 | outdoor_hardscape |
| proc-city-gate | 城门 | 城墙 | outdoor_hardscape |
| proc-arch-bridge | 拱桥 | 桃花林、庭院花园、桥 | outdoor_structure |
| proc-wooden-boat | 木船 | 湖、海滩 | outdoor_structure |
| proc-shop-facade | 临街店面 | 街道、火车站（作站房） | outdoor_structure |
| proc-timber-facade | 木构店面 | 古镇街道、集市 | outdoor_structure |
| proc-tea-row | 茶树行 | 茶园 | outdoor_plant |
| proc-rice-paddy | 稻田块 | 稻田 | outdoor_plant |
| proc-crop-row | 作物行 | 农场 | outdoor_plant |
| proc-barn | 谷仓 | 农场 | outdoor_structure |
| proc-stable | 马厩 | 马场 | outdoor_structure |
| proc-haystack | 草垛 | 马场、农场 | outdoor_plant |
| proc-platform | 站台 | 火车站 | outdoor_structure |
| proc-rail-track | 铁轨 | 火车站 | outdoor_hardscape |
| proc-stone-lantern | 石灯笼 | 竹林、湖、公园、桃花林、庭院花园 | decor |
| proc-waterfall | 瀑布 | 瀑布 | outdoor_water |
| proc-pergola | 花架亭 | 庭院花园、公园 | outdoor_structure |
| proc-spear | 长枪 | 战场、军营、城墙 | decor |

**程序化件总数：46 + 30 + 16 = 92 件。**

## 成对场景的件来源（每对：繁荣态 / 衰败态）

| 对 | 繁荣态 | 衰败态 | 省略 / 代用 |
|---|---|---|---|
| 唐长安 | 新：牌楼、摊位、灯笼杆；复用：木箱、木凳、木柜、油灯、花瓶 | 新：断墙、瓦砾、焦梁、枯树、荒草、断桌、断椅、蛛网；复用：木柜（残留） | 牌楼无翘角；摊位货物做进件内 |
| 宋汴京 | 新：牌楼、摊位、灯笼杆；复用：书桌、木椅、茶具、青瓷、博山炉、博古架 | 新：断墙、瓦砾、焦梁、枯树、荒草、断桌、断椅、蛛网；复用：木柜（残留） | 博古架为明清形制 stand-in；椅子为北欧木椅 stand-in（与唐宫旧例一致） |
| 圆明园 | 复用：鎏金椅、博古架、青花、书桌、水晶灯、波斯毯、喷泉 GLB；新：太湖石 | 新：焦梁、断椅、瓦砾、断墙、蛛网、荒草、枯树、倒塌石柱；新：太湖石（留存） | 大水法残柱用倒塌石柱 stand-in；喷泉干涸撤去 |
| 大明宫 | 复用：书桌、鎏金椅、博古架、青花、石狮、烛台吊灯、波斯毯；新：灯笼杆 | 新：断桌、断椅、瓦砾、焦梁、断墙、蛛网、荒草、枯树、倒塌石柱 | 长案宴饮沿用唐宫旧例（书桌拼合） |
| 罗马 | 新：罗马柱、摊位；复用：喷泉 GLB、会议长桌、长椅、木箱 | 新：倒塌石柱、瓦砾、断墙、荒草、枯树、断桌、蛛网 | 元老院雕像未做；摊位为通用形制 stand-in |
| 庞贝 | 新：罗马柱、摊位；复用：喷泉 GLB（中庭 impluvium）、长椅、木箱 | 新：瓦砾、倒塌石柱、断墙、荒草、枯树、断桌、蛛网 | 面包房烤炉未做（摊位 + 木箱 stand-in） |
| 楼兰 | 新：摊位、石井；复用：汉案、蒲团、漆碗、榻、木柜、油灯、粮草 | 新：瓦砾、断墙、枯树、荒草、断桌、蛛网；新：石井（干涸留存） | 骆驼/驼队无对应件，未做 |
| 商场 | 复用：超市货架、收银台、购物车、前台、长椅、水晶灯、绿植 | 新：倒塌货架、瓦砾、荒草、蛛网、枯树、断墙、断椅；复用：购物车（遗弃） | 扶梯未做（走廊露天围合简化） |
| 豪宅 | 复用：布艺沙发、扶手椅、水晶灯、波斯毯、鎏金椅、青花、大理石圆桌 | 新：断椅、断桌、瓦砾、蛛网、荒草、枯树、断墙 | 未做结构破损（屋顶坍塌等） |
| 学校 | 复用：课桌、黑板、书架、阅览桌、木椅、长椅、绿植 | 新：断桌（同课桌尺寸代用）、倒塌书架、瓦砾、蛛网、荒草、枯树、断墙 | 废弃态黑板已撤去 |
| 村庄 | 新：石井；复用：火炕、木柜、油灯、煤油灯、粮草、方桌、木凳 | 新：断桌、断椅、瓦砾、蛛网、荒草、枯树、断墙、石井（留存）；复用：火炕（留存） | 灶台未做（木柜 + 煤油灯 stand-in） |

**程序化件总数：46 + 30 = 76 件。**

## 本批复用的上一批程序化件（6 件）

| id | 件 | 用在本批场景 | 备注 |
|---|---|---|---|
| proc-thermos | 保温壶 | 宿舍书桌、水房水龙头排上、卧室床头柜、茶水间柜台上、KTV 茶几上 | 小件放承托面，elevationY = 承托面高度 |
| proc-basin | 脸盆 | 宿舍书桌、厨房南侧橱柜上、卫生间/酒店洗手盆上 | 同上 |
| proc-mirror-wall | 镜墙（200×280cm 落地） | 健身房北墙、卫生间洗手盆上方 | 落地件，elevationY=0 |
| proc-chandelier-crystal | 水晶吊灯 | 婚礼宴会厅 ×3 | mountCeiling（吸顶，凡尔赛同款） |
| proc-gilt-chair | 鎏金扶手椅 | 法庭旁听席 ×4、婚礼舞台两侧 ×2 | **stand-in**：法庭旁听席本应用普通木椅，金椅是凡尔赛件复用，视觉偏华丽，已注明 |
| proc-wood-stool | 木凳 | 警局审讯室、酒吧卡座区 | 通用小凳复用 |

## 本批复用的仓库已有 GLB / 目录件（按场景，节选关键件）

- 学校：车辆 5 件（停车场：bmw_m3_e46 / porsche_911 / bmw_m5_g90 /
  cyberpunk_car / vino 踏板车，均为仓库已有 GLB）；树、草坪、石径、
  淋浴间、马桶、小便池、洗手盆、冰箱、植物（目录件复用）。
- 家庭/公司/联想：床、床头柜、衣柜、梳妆台、沙发、茶几、餐桌椅、
  办公桌椅、书架、橱柜、冰箱、油烟机、马桶、浴缸、淋浴间、洗手盆、
  地毯、落地灯、植物（全部为目录已有件，未新增 GLB）。
- **油烟机（hood-side-black）**：挂墙件，已加入 harness 的墙挂白名单
  （与白板/案情板/KTV 屏同类处理），放灶台上方 elevationY=150。

## 被程序化件取代的旧 stand-in（上一批 6 场景留下的）

上一批场景为赶工用了下列拼搭，本次新场景不再用它们；**旧 10 个场景
本身本次未动**（任务范围只含新 12 场景），以下只说明“新场景里
谁取代了谁”，供以后回填旧场景时参考：

- 案 = 胡桃长柜（tvunit-walnut）→ `proc-han-an`（真 12–14cm 低案）
- 交椅/圈椅 = 单人扶手椅（sofa-armchair）→ `proc-huchuang` /
  `proc-wood-stool`（魏晋）；明代厅堂的交椅/圈椅仍是旧拼搭，未动
- 架子床 = 原木床（bed-wood-nordic）→ `proc-han-ta`（低足榻）
- 神龛 = 边柜 + 供品（sideboard-walnut + 瓶/果盘）→ `proc-shrine-niche`
- 火炕 = 榻榻米矮床横放（bed-tatami）→ `proc-kang`（真砖砌炕体）
- 博古架：旧场景无；别墅茶室直接用 `proc-bogujia`，不用开放式置物架拼搭

## 未能表示的件（省略或用中性替代，已在模板注释中说明）

- 学校：标语、课程表、黑板报——无对应 3D 文字件，未做（不在模板里）。
- 魏晋：麈尾/羽扇/如意（手持小件，片场尺度下不可见）——未做。
- 河姆渡：骨耜、双鸟朝阳象牙雕、猪纹钵——未做（只有黑陶釜 + 漆碗）。
- 秦汉：漆器纹样只做到黑胎朱口，未做具体纹饰。
- 凡尔赛：镜厅只做 5 面镜墙 + 南墙 3 窗示意“窗镜成对”，未复刻 17 对；
  天顶画未做（无对应画件）。
- 和室：榻榻米颜色与障子透光以文字描述 + 程序化近似为准（参考包缺口）。
- 水房：无公开照片，整节按 WordReference 文字描述建模（见参考包 17 节）。
- KTV：无公开照片，整节按指南文字描述建模；点歌触屏、无线麦克风无对应
  3D 件，未做；环形沙发用模块化沙发（sofa-modular-green）stand-in。
- 田径场：只做 24 米直道 + 足球门，未做 400 米标准环形跑道（超出单场
  景尺度）。
- 总裁办公室：未做落地玻璃幕墙（只有常规打孔窗）；无现代落地窗总裁办
  公室实拍（见参考包 23 节缺口）。
- 宿舍：简化为 3 张上下铺 + 3 张书桌；真实中国大学宿舍常为 6 人一间
  （人民大学例：六张铁架上下铺、桌在床下），床下书桌未做（双层床件
  本身不含桌），如需 6 人满配须另加床位。
- 警局：无开放式办公区实拍；审讯室未做单向玻璃（无对应件）。
- 法庭：旁听席用鎏金扶手椅（凡尔赛件）stand-in，视觉偏华丽；法官席
  法槌、铭牌为程序化近似。
- 酒吧：吧凳用工业风餐椅（chair-industrial-black）stand-in，未做专用
  高脚吧凳。
- 婚礼：宴会桌用方形木餐桌（dining-oak-rect）stand-in，未做圆形大圆桌。
- 电梯：轿厢门静态，无开关动画；电梯井为露天围合（全墙隐藏），非真实井道。
- 超市：收银传送带、价签条为程序化近似；无生鲜/冷柜区。
- 饭堂：无现代中国学校饭堂实拍，打饭窗口按当代通用形制建模。
- 成对场景（11 对）：牌楼无翘角（简化双层檐顶）；罗马柱无柱身凹槽；
  蛛网为墙角扇形近似（非整面蛛网）；枯树无叶、无根系；倒塌石柱的
  断鼓与柱头残块为简化几何；楼兰驼队、庞贝面包房烤炉、商场扶梯、
  豪宅屋顶坍塌均未做（见上表“省略 / 代用”列）；衰败态的断桌/断椅
  只做倾斜 + 缺腿，未做碎裂木屑。

## 时代锁自查（每场景模板注释中亦有说明）

- 秦汉：无椅凳高桌、无青花/玻璃/紫砂、无辣椒土豆玉米；不建阿房宫。
- 魏晋：不摆满明式高家具；正式场合席地而坐。
- 元：蒙古包内无床、无雕花大床、无博古架；无明式素面黄花梨。
- 半坡：无家具、无稻、无砖瓦金属瓷器；不与河姆渡混用。
- 河姆渡：无粟、无半地穴屋；不与半坡混用。
- 民国农村：无电灯、无留声机/电话/电风扇、无冰箱。
- 凡尔赛：无现代卫生间/马桶/浴缸。
- 和室：床の間不放物不坐人、不穿鞋上榻榻米、不做固定西式床。
- 韩屋：院子留空（模板里就是 `[]`）、不用中式假山石。
- 唐长安 / 宋汴京：衰败态无清代雕花、无电灯、无现代家具；博古架为
  明清形制 stand-in（宋酒肆当用敞架/多宝格前身），不得声称“宋代博古架已复刻”。
- 圆明园：衰败态无现代家具、无电灯；大水法残柱用倒塌石柱 stand-in，
  不得声称“大水法已复刻”。
- 大明宫：无清代三希堂式暖阁陈设、无电灯；不得把紫禁城太和殿形制
  直接当作含元殿。
- 罗马 / 庞贝：无中式家具、无灯笼、无牌楼；市集摊位为通用形制
  stand-in，非罗马专属形制。
- 楼兰：无蒙古包（元代件，不属汉代楼兰）、无清代器物；驼队未做，
  不得声称“驼队已复刻”。
- 成对现代场景（商场/豪宅/学校/村庄）：无古代器物时代锁；但不得声称
  “按实拍复刻”——除参考包各节注明有实拍的布局关系外，其余均为手排
  简化场景（程序化件 + 目录件拼搭），非 1:1 建模；豪宅两态为同一栋
  房子（同一 floorLayouts），不得声称“两栋不同房子”。

## 本批时代锁自查（现代场景无古代时代锁；以下为“不得声称已复刻”的简化点）

- 现代场景（学校/家庭/公司/联想补充）：无古代器物时代锁；但不得声称
  “按实拍复刻”——除参考包各节注明有实拍的布局关系外，其余均为手排
  简化场景（程序化件 + 目录件拼搭），非 1:1 建模。
- 宿舍：不得声称“6 人标准间已复刻”（本批为 3 床简化版）。
- 田径场：不得声称“400 米标准跑道”（本批为 24 米直道）。
- KTV / 水房：不得声称“有实拍依据”（本批为文字描述建模，已在参考包注明）。
