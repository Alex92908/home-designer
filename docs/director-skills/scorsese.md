# 马丁·斯科塞斯 — 导演手册（Martin Scorsese Playbook）

> 范围：8 部锚定影片（1976–2023）：《出租车司机》*Taxi Driver* (1976)、《愤怒的公牛》*Raging Bull* (1980)、《好家伙》*Goodfellas* (1990)、《赌城风云》*Casino* (1995)、《无间道风云》*The Departed* (2006)、《华尔街之狼》*The Wolf of Wall Street* (2013)、《爱尔兰人》*The Irishman* (2019)、《花月杀手》*Killers of the Flower Moon* (2023)。另引用《穷街陋巷》*Mean Streets* (1973) 一处针落音乐例子，已注明。
> 核心 DNA：**诱惑先于惩罚** —— 先用长镜头、画外音和一首老歌让你爱上罪犯的世界，再用蒙太奇和清算让你看清代价；**暴力是突然的、真实的、没有快感的**；**音乐不是配乐，是叙事**。
> 状态：已接入导演台风格预设（2026-11-16，`src/lib/directorStyles.ts`）。

## 什么时候用

- 黑帮、犯罪、卧底、金融诈骗、权力腐败题材的短剧。
- 一场戏需要“先让观众羡慕主角的生活，再让观众害怕这个生活”时用这套：诱惑和惩罚必须成对出现。
- 想拍“一个普通人怎么一步步走进犯罪世界”时用这套 —— 斯科塞斯的戏是“进入仪式”，不是“犯罪过程”。
- 预算有限但想显得“大”时优先用这套 —— 核心是走位、旁白和音乐选择，不是布景规模。

## 1. 布景 SETS — 6 种场景类型

| # | 场景类型 | 例子 | 关键点 | 导演台可用的设置 |
|---|---|---|---|---|
| 1.1 | 夜总会/餐厅 —— 犯罪世界的客厅 | 《好家伙》*Goodfellas* (1990)：Henry 带 Karen 第一次进 Copacabana 夜总会 —— 不用排队，走后门、穿厨房、穿过服务通道，一张桌子直接摆到舞台前；《赌城风云》*Casino* (1995)：Tangiers 赌场大厅，Ace 在此巡视、主持电视谈话节目 | 夜总会不是背景，是特权本身 —— 谁能走后门、谁坐前排，就是谁的地位；服务通道和厨房是“内部人”的路 | 场景：餐厅/夜总会 set（set-restaurant）；走位：一条从后门到前排的连续动线；灯光 warm |
| 1.2 | 霓虹夜街 —— 城市即病人 | 《出租车司机》*Taxi Driver* (1976)：开场雨夜纽约街头，蒸汽从井盖升起，霓虹招牌、黄色出租车；Travis 的独白“总有一天，一场真正的大雨会来，把街上这些渣滓都冲走” | 街道是主角内心的外化 —— 拍得越脏、越亮、越吵，主角的孤独就越重；城市本身就是一个角色 | 场景：户外夜街 set；灯光 night + neon；走位：walk 沿街慢行，配旁白 |
| 1.3 | 拳台 —— 暴力当歌剧 | 《愤怒的公牛》*Raging Bull* (1980)：Jake LaMotta 的八场比赛，每场风格不同；最后一场对 Sugar Ray Robinson（1951 年“情人节大屠杀”），Jake 挂在绳索上任打不倒下，血从绳索滴落，说“You never got me down, Ray” | 拳台是忏悔室，不是体育场 —— 每一拳都是人物性格的延伸；Scorsese 本人说打斗场面是“像编舞一样 staging a dance to music，四小节音乐换四记拳” | 场景：94 套里没有专用拳台 set —— 用室内大空间 set + dramatic 灯光搭擂台感（见不确定项）；打斗编排 3–8 拍：punch/block/dodge/fall |
| 1.4 | 办公室/交易大厅 —— 金钱即宗教 | 《华尔街之狼》*The Wolf of Wall Street* (2013)：Stratton Oakmont 销售大厅，几百名经纪人同时打电话、吼叫、扔钱；Jordan 站在人群前演讲“I'm not leaving!”（“我他妈不走！”），全场沸腾 | 办公室是教堂 —— 老板是传教士，电话是武器，演讲是布道；人群的狂热就是权力本身 | 场景：公司 set（set-office）；走位：主角从门口走到人群中央；动作：point/wave；机位 dolly-in 推近 |
| 1.5 | 家/餐桌 —— 谈判桌 | 《好家伙》(1990)：黑帮在家里聚餐、开家庭会议，餐桌上谈的是杀人；《赌城风云》(1995)：Ace 和 Ginger 的家从豪宅变成战场，Ace 的旁白“当你爱一个人，你必须信任她……除此之外别无他法” | 家是最危险的谈判场 —— 最亲的人坐得最近，也最先背叛；餐桌戏的张力来自“谁先放下刀叉” | 场景：家 set；机位：over-the-shoulder 正反打；动作：sit + turn；灯光 warm 转 cold（谈崩时） |
| 1.6 | 警局/法庭 —— 清算的房间 | 《无间道风云》*The Departed* (2006)：波士顿州警总部，卧底 Billy Costigan 和内鬼 Colin Sullivan 在同一栋楼里互相追捕；《花月杀手》*Killers of the Flower Moon* (2023)：法庭审判 William Hale 与 Ernest，结尾是 1930 年代真实罪案广播剧的舞台重演 | 清算的房间要拍得冷、亮、无处可藏 —— 没有阴影给人躲；审判不是高潮，是账单 | 场景：警局/法庭 set（高频场景库含 police、courtroom）；机位：indoor-wide 定场 → indoor-closeup 给证词；灯光 cold |

## 2. 拍摄 FILMING — 5 种模式

| # | 模式 | 例子 | 关键点 | 导演台可用的设置 |
|---|---|---|---|---|
| 2.1 | 长镜头跟拍 —— 一镜走进特权世界 | 《好家伙》(1990)：Copacabana 一镜 —— 约 3 分钟不间断，Steadicam 跟 Henry 和 Karen 从后门、楼梯、走廊、厨房一路走到前排座位，配 The Crystals 的《Then He Kissed Me》；摄影 Michael Ballhaus，Steadicam 操作员 Larry McConkey；起因是剧组不被允许拍正门进场，限制变成了名场面 | 长镜头的意思是“畅通无阻” —— 没有剪辑打断，就是没有障碍；观众和 Karen 一起被这个世界“吸进去”，来不及质疑 | 走位：一条连续 waypoints 动线（后门→走廊→厨房→前排），带高度+时间；机位：dolly-in 跟拍；室内用 indoor-wide 连续走位模拟 |
| 2.2 | 画外音开场 —— 主角直接对你坦白 | 《好家伙》(1990)：开场 Billy Batts 被塞进后备箱、Henry 关上盖子，画面定格，Henry 画外音：“As far back as I can remember, I always wanted to be a gangster.”（“我有记忆以来，就一直想当黑帮。”）全片只有 Henry 和 Karen 两人有画外音；《赌城风云》(1995)：Ace 开场即旁白“当你爱一个人，你必须信任她”，汽车爆炸后倒叙 | 画外音是共谋邀请 —— 主角把观众当成同伙，不是观众；旁白的语气是炫耀或忏悔，绝不是解释剧情 | 剧本编辑器：把旁白写成独立的画外音台词行，配 shoot simulation 走一遍节奏；旁白只说画面不说的（内心、时间跳跃），不复述看得见的 |
| 2.3 | 针落音乐（needle drop）—— 老歌当叙事武器 | 《好家伙》(1990)：Derek and the Dominoes 的《Layla》钢琴尾奏，配 Lufthansa 抢劫案后一具具尸体被发现的蒙太奇 —— 甜美的音乐配残忍的画面，反差即主题；《穷街陋巷》*Mean Streets* (1973)：Johnny Boy 伴着 Rolling Stones 的《Jumpin' Jack Flash》在红光中慢动作走进酒吧；《无间道风云》(2006)：Dropkick Murphys 的《I'm Shipping Up to Boston》开场；《赌城风云》(1995)：《Can't You Hear Me Knockin'》配 Nicky 走向毁灭的蒙太奇；《Gimme Shelter》在《好家伙》《赌城风云》《无间道风云》三部片里反复出现，每次都是道德崩塌的信号 | 音乐先以场内音源出现（酒吧点唱机、车载收音机），再放大成全片配乐；最狠的用法是“反差配乐” —— 越甜的歌，配越脏的画面 | 音乐库：选情绪相近的曲目（无原曲版权 —— 导演台音乐库里没有这些歌，只能用同情绪/同时代的替代曲，见不确定项）；规则：一首歌必须配一个反差点，不能只当气氛铺底 |
| 2.4 | 定格（freeze frame）—— 时间停在代价上 | 《好家伙》(1990)：开场关后备箱后定格在 Henry 脸上；《爱尔兰人》*The Irishman* (2019)：每个黑帮出场时画面定格，字幕打出他的名字和死亡日期与死法 —— 一开始像笑话，越往后越像讣告 | 定格是死亡预告 —— 画面停住，观众才有时间读出“这个人已经死了”；定格配旁白，旁白配定格，缺一不可 | ⚠️ 导演台暂不支持真定格：用 indoor-closeup 静止 hold + 剧本字幕模拟（分镜里写“定格：字幕打出姓名与死期”），是缺口不是功能 |
| 2.5 | 快切蒙太奇 —— 崩塌要快，诱惑要慢 | 《好家伙》(1990)：结尾 Henry 吸食可卡因的偏执一日 —— 同时应付家庭、毒品、黑帮监视，配 Harry Nilsson、The Who、Muddy Waters 等快节奏歌曲，一天之内全线崩溃；《赌城风云》(1995)：Devo 翻唱的《(I Can't Get No) Satisfaction》配 Ace 帝国开始暴力崩塌的蒙太奇 | 诱惑用长镜头慢慢拍，崩塌用快切砸下来；蒙太奇的剪辑速度 = 主角失控的速度 | 分镜序列：多分镜快速切换（每镜 1–2 拍）+ 音乐库快节奏曲目；shoot simulation 走一遍，确认节奏越来越快 |

## 3. 动作 ACTION — 5 条原则

| # | 原则 | 例子 | 导演台可用的设置 |
|---|---|---|---|
| 3.1 | 暴力是突然的，不是编排的 | 《好家伙》(1990)：“Funny how?”（“我哪里好笑？”）—— Tommy 讲笑话，全桌大笑，Henry 随口说句“你真逗”，Tommy 瞬间翻脸，逼问“Funny how? 像个小丑一样逗你们笑吗？”—— 笑声和杀意之间没有过渡；开场 Billy Batts 被 Tommy 和 Jimmy 在后备箱里捅死、枪杀，全程没有配乐铺垫；《出租车司机》(1976)：妓院枪战从跟踪镜头直接切入，Travis 一枪打掉看门人的手指 | 暴力之前不给预警音乐、不给慢动作、不给特写预告；观众应该和受害者一样措手不及 | 动作预设：对话动作（sit/turn/point）中途无预警切入 punch/fight；打斗编排 3–8 拍，但第一拍之前不要有“摆架势”的拍子 |
| 3.2 | 打斗当舞蹈编排 —— 按音乐数拍子 | 《愤怒的公牛》(1980)：Scorsese 说每场拳赛都是“像编舞一样 staging a dance to music”—— 不是一节十二小节的音乐，而是四小节的拳；八场比赛每场风格、节奏、机位都不同；拳赛只占全片约 10 分钟，却拍了约 10 周 | 打斗不是“打得好看”，是“打得有节奏”；每场打斗定一个节拍型（快–慢–停），换一场就换节拍 | 打斗编排：3–8 拍 phrase，动作 punch/block/dodge/fall 按节拍排；每场换一个节拍型；配音乐库曲目对拍 |
| 3.3 | 诱惑先于惩罚 —— 结构，不是点缀 | 《好家伙》(1990)：全片结构就是诱惑（Copacabana 长镜头、婚礼蒙太奇、Lufthansa 抢劫后的圣诞派对）→ 惩罚（《Layla》尸体蒙太奇、Tommy 被处决、Henry 偏执一日、最后沦为受保护的证人）；《华尔街之狼》(2013)：前半是狂欢（游艇、派对、演讲），后半是清算（FBI、沉船、监狱、卖笔讲座） | 没有诱惑的惩罚是说教，没有惩罚的诱惑是炫富；短剧也要一头一尾各留一场 | 结构模板：分镜前 1/3 全是“进入仪式”（长镜头+音乐+笑声），后 1/3 全是“清算”（快切+冷灯光+定格字幕）；中间是转折点 |
| 3.4 | 偏执的一天 —— 把崩溃压缩进 24 小时 | 《好家伙》(1990)：结尾 Henry 的一天 —— 早上送弟弟去医院、下午取可卡因、晚上躲直升机监视、半夜被捕，全程配快节奏摇滚；《赌城风云》(1995)：Ace 一天之内同时处理赌场、老婆、FBI 调查和 Nicky 的失控 | 崩溃不是慢慢来的，是同一天里所有事同时爆炸；观众的紧张来自“他顾不过来”，不是“他打不过” | 分镜序列：5–7 个短分镜连续切换，同一角色 walk/run 在不同场景间赶场；音乐库快节奏曲目全程不断 |
| 3.5 | 背叛即高潮 —— 最亲的人动手 | 《无间道风云》(2006)：双卧底结构 —— Billy 是警察派进黑帮的卧底，Colin 是黑帮派进警局的内鬼，两人互相追捕同一只“老鼠”，最后双双死去，结尾镜头是一只老鼠爬过 Sullivan 公寓的窗台；《花月杀手》(2023)：Ernest 一边真心爱 Mollie，一边按叔叔 Hale 的命令给她注射毒药（谎称是糖尿病治疗），毒死她的家人以夺取石油 headright | 背叛的高潮不是动作，是选择 —— 角色在爱和利益之间选了利益，且观众全程看着他选 | 机位：over-the-shoulder 拍两人对话，indoor-closeup 拍下毒/递枪的那只手；动作：sit + turn（转身即背叛）；灯光 cold |

## 4. 镜头 CAMERA — 4 种模式

| # | 模式 | 例子 | 导演台可用的设置 |
|---|---|---|---|
| 4.1 | 跟拍长镜头 —— 权力就是不用停下 | 《好家伙》(1990)：Copacabana 约 3 分钟一镜，Henry 和 Karen 不用排队、不用等位，桌子直接摆到舞台前；《爱尔兰人》(2019)：开场镜头反向致敬 Copacabana —— 同样一个长镜头沿养老院走廊滑过一排老人，最后停在轮椅上的 Frank 面前：同样的运镜，从“进入天堂”变成了“走进等死” | 长镜头必须回答“这个人为什么能走这条路”；没有叙事理由的长镜头就是炫技 | 走位 waypoints（带高度+时间）+ dolly-in；室内 indoor-wide；开场一镜定场，之后再切近 |
| 4.2 | 鸟瞰收尾 —— 从天上看清算 | 《花月杀手》(2023)：最后一镜是俯瞰镜头 —— 现代欧塞奇族人在旷野上围成花形圆圈跳舞，镜头缓缓变黑；《出租车司机》(1976)：结尾枪战后镜头升到天花板俯瞰血泊中的房间（见不确定项） | 鸟瞰是“上帝视角” —— 人物再大，在这个角度下也只是一个点；只用在全片最后一镜 | 机位：crane-up 升到最高点；灯光 dusk 或 moonlight；只做收尾，不做开场 |
| 4.3 | 特写给脸，不给拳头 | 《好家伙》(1990)：“Funny how?”整场戏基本是中景和特写对话 —— 观众盯着 Tommy 的脸，看他从笑到怒到笑，暴力全在表情里；《赌城风云》(1995)：Ace 的旁白配他观察老千下注的特写：“看这些混蛋下注的方式就能认出来……他总是猜对” | 冲击瞬间切受害者/目击者的脸，不是拳头；让观众读出暴力的代价 | 机位：indoor-closeup；对话戏默认 over-the-shoulder + closeup 轮换；打斗中绝不切拳头特写 |
| 4.4 | 一镜到底的独白 —— 镜子前的排练 | 《出租车司机》(1976)：Travis 在公寓镜子前拔枪排练“You talkin' to me?”（“你在跟我说话吗？”）—— De Niro 即兴发挥，镜头在狭小公寓里一次拍完，Bernard Herrmann 的爵士配乐（作曲家遗作）全程压着；这是全片最著名的镜头，也是孤独的极致：他只是在对自己说话 | 独白戏不要切 —— 切了，孤独就散了；一个镜头、一个人、一面镜子 | 机位：indoor-closeup 单镜；动作：turn + point（对镜拔枪排练）；灯光 night；剧本编辑器写独白台词 |

## 5. 装束 COSTUMES — 4 个造型

| # | 造型 | 例子 | 导演台可用的设置 |
|---|---|---|---|
| 5.1 | 黑帮西装 —— 制服即地位 | 《好家伙》(1990)：Henry、Jimmy、Tommy 的剪裁西装、金链、戒指 —— 西装越合身，地位越高；《赌城风云》(1995)：Ace 被剧本写明“衣着一丝不苟”（immaculately dressed），西装、领带、袖扣全套，走到哪都像赌场老板 | 西装是黑帮的制服：同一件西装，主角穿是地位，喽啰穿是制服；换装即升职或失势 | 服装库：西装 archetype + 时代锁定（1970s/1990s）；换装节点写进分镜（升职一场换一套） |
| 5.2 | 街头孤狼 —— 军夹克 + 莫西干 | 《出租车司机》(1976)：Travis 的军夹克（越战老兵）、牛仔靴，最后剃出莫西干头、囤枪、改装袖枪 —— 服装变化即人物黑化进度条：从“退伍兵找工作”到“自封的城市清洁工” | 主角的服装要“越变越不对劲” —— 观众先觉得他只是邋遢，再发现他已经武装起来了 | 服装库：军夹克 archetype + 莫西干发型（若服装库无此发型，见不确定项）；换装节点：剃头一场 = 黑化转折点 |
| 5.3 | 华尔街制服 —— 白衬衫即战袍 | 《华尔街之狼》(2013)：Stratton Oakmont 全员白衬衫、西装、领带，办公室里人人一样，只有 Jordan 的演讲能把他区分出来；Jordan 的西装从廉价到定制，财富写在剪裁上 | 金融骗局的服装逻辑和黑帮一样：identical 制服 = 组织，剪裁差别 = 等级 | 服装库：正装 archetype；公司 set + 人群走位；主角服装随剧情升级（廉价→定制） |
| 5.4 | 年代服装定位时空 —— 一件衣服就是一个年代 | 《花月杀手》(2023)：1920 年代俄克拉荷马 —— 欧塞奇族人的西式正装与原住民服饰并存，石油财富让被殖民者穿得比殖民者更讲究；《爱尔兰人》(2019)：横跨 1950s–1970s，Frank 从卡车司机工装到黑帮西装再到养老院病号服，服装即一生 | 年代感不靠布景，靠服装：换一套衣服，观众就知道过了十年 | 服装库：时代锁定（era locks）—— 1920s / 1950s / 1970s 各一套；同一角色不同年代换装，配灯光变化 |

**另可供导演台后用（已核查）：**《出租车司机》(1976) 获戛纳金棕榈，Bernard Herrmann 的配乐是其遗作（完成数小时后去世）；《无间道风云》(2006) 为 Scorsese 赢得首座奥斯卡最佳导演（此前七次提名未中），同时获最佳影片，翻拍自香港电影《无间道》(2002)；《爱尔兰人》(2019) 预算 1.59–2 亿美元、片长 209 分钟，是 Scorsese 最贵、最长的影片，De Niro、Pacino、Pesci 全程数字减龄；《愤怒的公牛》(1980) 获奥斯卡最佳剪辑（Thelma Schoonmaker）与最佳男主角（De Niro），1990 年入选美国国家电影登记表。

## 6. 不要抄这些 — 5 个失败模式

1. **只抄暴力，不抄诱惑。**《好家伙》成立，是因为观众先被 Copacabana 长镜头和《Layla》之前的美好生活迷住，再看到尸体蒙太奇。模仿者开场就是枪战、后备箱、尸体 —— 没有诱惑，暴力只是噪音，观众没有任何东西可失去。规则：前 1/3 分镜不许见血，只许见好日子。
2. **画外音当说明书。**《好家伙》的旁白是炫耀和忏悔（“当黑帮比当总统还好”），《赌城风云》的旁白是上课（“拉斯维加斯人人都在互相监视”）—— 旁白说的是画面之外的东西。模仿者用旁白复述观众看得见的剧情（“他走进了赌场，他坐下了”），旁白就成了字幕。规则：一句旁白如果删掉后画面意思不变，就删掉。
3. **针落音乐当背景音乐。**《Layla》之所以是影史最佳针落之一，是因为甜美的钢琴尾奏配的是尸体 —— 音乐和画面对位（counterpoint），不是气氛。模仿者选一首“很黑帮的歌”铺在打斗底下当 BGM，歌就白选了。规则：每首歌必须有一个反差点（甜歌配脏画面，或脏歌配体面场面）；没有反差点的歌不进预设。
4. **长镜头炫技。**Copacabana 一镜成立，是因为它要表现“Henry 在这个世界里畅通无阻” —— 镜头不停，就是特权不停。模仿者为了一镜到底而一镜到底，拍一个毫无障碍的人走一条毫无意义的路，观众只觉得拖沓。规则：长镜头之前先回答“这个人为什么能走这条路、别人为什么不能”。
5. **黑帮浪漫化到底，没有清算。**Scorsese 从不让罪犯全身而退：《好家伙》Henry 沦为受保护的证人、过普通人的日子；《赌城风云》Ace 被炸、失去帝国，最后说“这座城市再也不一样了，如今看起来像迪士尼乐园”；《无间道风云》两个卧底双双死去；《爱尔兰人》Frank 在养老院里孤独等死，连女儿都不来看他；《花月杀手》结尾 Scorsese 本人上台读 Mollie 的讣告 ——“没有提到谋杀案”。模仿者让主角帅到最后、赢到最后，拍出来的就是黑帮广告。规则：每部戏必须有一个清算时刻（审判、背叛、孤独、死亡），且清算的篇幅不小于诱惑的 1/3。

## 7. 预算 — 便宜 / 贵

**便宜（不用花钱 —— 这就是斯科塞斯的核心）：**
- 画外音：剧本编辑器里写几行旁白，成本为零。这是风格的大头 —— 《好家伙》开场定格+一句旁白就立住了全片。
- 针落音乐：音乐库选一首情绪相近的曲目，配一个反差画面。成本：选曲时间，不是版权费（原曲买不起，也买不到 —— 见不确定项）。
- 定格模拟：indoor-closeup 静止 hold + 剧本字幕（“定格：字幕打出姓名与死期”），成本为零。
- 西装换装：服装库换一套西装，成本：服装，不是搭建。
- 长镜头走位：一条 waypoints 动线穿过餐厅/夜总会 set，成本：走位排练，不是群众演员。

**贵（需要大布景或众多群众演员 —— 在导演台里标出来）：**
- 大场面人群：Copacabana 夜总会满场客人、Stratton Oakmont 几百名经纪人同时打电话。导演台提示：“需要 20+ 群众演员/大布景 —— 预算紧就用 5–8 人小场面 + 更紧的餐厅 set。”
- 年代布景：1920 年代欧塞奇石油小镇（《花月杀手》）、1970 年代拉斯维加斯（《赌城风云》）。导演台提示：“年代布景 —— 复用一间 dress 好的房间 + 时代锁定换装，别建整条街。”
- 黑白摄影：Raging Bull 全片黑白（仅家庭录像片段是彩色）。导演台提示：“⚠️ 无黑白/去色灯光预设 —— 黑白质感目前做不出来，灯光 dramatic + cold 是最接近的替代。”
- 数字减龄：The Irishman 用三机位 rig + CGI 把 70 多岁的 De Niro、Pacino、Pesci 变回 30–40 岁，预算 1.59–2 亿美元。导演台提示：“⚠️ 不支持减龄 —— 跨年代戏用不同演员/换装 + 灯光变化暗示年龄，别指望一张脸演三十年。”
- 真枪战/爆炸：Casino 开场汽车爆炸、Taxi Driver 妓院枪战。导演台提示：“特技道具档 —— 14 件程序化特技道具里没有枪械/爆炸效果，用音效 + 反应镜头替代。”

**给导演台的底线：** 斯科塞斯风格是旁白 + 一首老歌 + 一条长镜头走位，不是钱。预设默认便宜档（一个餐厅 set、一条后门动线、一句画外音、一首反差配乐、一次换装），把大场面人群、年代布景、黑白、减龄标为升级项或缺口，不是必需项。

## 来源

- 8 部锚定影片片名与年份、Scorsese filmography、《无间道风云》奥斯卡最佳导演与最佳影片、《爱尔兰人》预算与片长 — https://en.wikipedia.org/wiki/Martin_Scorsese ；https://en.wikipedia.org/wiki/The_Irishman_(2019_film)
- Copacabana 长镜头：约 3 分钟（184 秒）、Steadicam、摄影 Michael Ballhaus、操作员 Larry McConkey、穿后门与厨房、配《Then He Kissed Me》、因不许拍正门而改走后门 — https://www.odeon.co.uk/odeon-scene/martin-scorsese-best-movie-moments/ ；https://themobmuseum.org/blog/mob-classic-goodfellas-debuted-in-theaters-twenty-five-years-ago/ ；https://www.soundstripe.com/blogs/tracking-shot
- 《好家伙》开场定格 + “As far back as I can remember, I always wanted to be a gangster”、《Funny how?》场景（Bamboo Lounge、Pesci 即兴、源自真实经历）、Henry 与 Karen 双画外音、定格手法致敬 Truffaut《Jules and Jim》 — https://www.pastemagazine.com/movies/goodfellas/best-goodfellas-quotes-martin-scorsese-movie ；https://www.gradesaver.com/goodfellas/study-guide/quotes ；https://themobmuseum.org/blog/mob-classic-goodfellas-debuted-in-theaters-twenty-five-years-ago/
- 针落音乐：《Layla》钢琴尾奏配尸体蒙太奇（片场放歌同步走位）、《Gimme Shelter》三部片、《Can't You Hear Me Knockin'》配《赌城风云》蒙太奇、《I'm Shipping Up to Boston》开场、《Jumpin' Jack Flash》配《穷街陋巷》Johnny Boy 红光入场 — https://screenrant.com/goodfellas-soundtrack-best-songs/ ；https://faroutmagazine.co.uk/martin-scorsese-best-music-moments-films-songs-rolling-stones-dropkick-murphys/ ；https://www.inbella.com/1155269/40-best-needle-drops-in-movies-of-all-time/ ；https://skilldb.dev/skills/directors-styles/director-style-martin-scorsese
- 《出租车司机》(1976)：“You talkin' to me?”镜前独白（即兴）、莫西干头、“Someday a real rain will come”独白、Bernard Herrmann 遗作配乐、戛纳金棕榈、Scorsese 本人客串乘客 — https://thefilmspectrum.com/?p=20670 ；https://www.cineversegroup.com/2026/02/aggression-as-art-enduring-unnerving.html ；https://dyerbolical.com/taxi-driver-1976-robert-de-niros-you-talkin-to-me/
- 《愤怒的公牛》(1980)：黑白摄影、Mascagni《Cavalleria Rusticana》间奏曲配慢动作影子拳击开场、八场比赛各不同风格、“You never got me down, Ray”、拳赛约 10 分钟拍了约 10 周、Scorsese 称打斗为“staging a dance to music” — https://www.thefifthdesk.org/work/raging-bull/ ；https://cinephiliabeyond.org/raging-bull/ ；https://vectree.io/pdf/c/raging-bull
- 《赌城风云》(1995)：count room“holy of holies”、数钱房内鬼 skim、“When you love someone, you've gotta trust them”、“In Vegas everybody's gotta watch everybody else”、“The town will never be the same… looks like Disneyland” — https://scrapsfromtheloft.com/movies/casino-1995-transcript/ ；https://en.wikiquote.org/wiki/?title=Casino_(film)&oldid=3442807
- 《华尔街之狼》(2013)：“I'm not leaving!”演讲、Lemmon 714 Quaalude 爬行（拍了一整天、无替身）、“Sell me this pen”（结尾销售讲座，真实 Belfort 本人介绍 DiCaprio 出场）、Stratton Oakmont — https://spoilertown.com/the-wolf-of-wall-street-2013/ ；https://thebuzzpedia.com/most-famous-dialogues-of-wolf-of-wall-street/ ；https://www.punchpresentations.com/post/the-wolf-of-wall-street
- 《无间道风云》(2006)：翻拍《无间道》(2002)、双卧底结构、结尾窗台老鼠、Dignam 枪杀 Sullivan — https://warnerbros.fandom.com/wiki/The_Departed ；https://www.looper.com/220124/the-ending-of-the-departed-explained/ ；https://www.slashfilm.com/626064/the-departed-ending-explained-a-tale-of-two-rats/
- 《爱尔兰人》(2019)：开场养老院走廊长镜头致敬 Copacabana、定格字幕给死亡日期、片头字幕实为《I Heard You Paint Houses》、三机位 rig 减龄、209 分钟 — https://www.thefifthdesk.org/work/the-irishman/ ；https://www.filmcomment.com/article/death-be-not-proud/ ；https://en.wikipedia.org/wiki/The_Irishman_(2019_film)
- 《花月杀手》(2023)：Ernest 毒杀 Mollie 家人夺石油 headright、结尾 Lucky Strike Hour 广播剧、Scorsese 本人客串读 Mollie 讣告“没有提到谋杀案”、结尾俯瞰欧塞奇圆圈舞 — https://www.thegospelcoalition.org/article/killers-flower-moon-christian-movie-review/ ；http://movieweb.com/killers-of-the-flower-moon-ending-explained/ ；https://collider.com:443/killers-of-the-flower-moon-not-true-crime/

**不确定项（不要当作定论）：**《Gimme Shelter》在《无间道风云》里出现的次数有冲突 —— 一个来源说三次，一个说两次，本手册只写“多次出现”；《出租车司机》镜前独白是否为“单镜头一次拍完”只有一个较弱来源支持，按待核对待；《出租车司机》结尾枪战后的天花板俯瞰镜头未在本轮核查中确认，写进手册时已标注；94 套场景里是否有专用拳台 set 未核查 —— 本手册按“没有”处理，用室内大空间 + dramatic 灯光替代，若实际有拳台 set 应修正；服装库是否有莫西干发型、军夹克 archetype 未核查 —— 5.2 的换装节点以实际服装库为准；导演台音乐库的具体曲目未核查 —— 2.3 的“情绪相近替代曲”需对照实际曲库挑选，本手册不点名任何一首库内曲目。
