# 导演台声音/音乐库（云横店 M4-C）

> 数据：`src/lib/soundLibrary.ts`（配乐库 + 每镜推荐）  
> 合成：`src/lib/soundEffects.ts`（WebAudio 合成音效）  
> 接入：`src/components/CinematicDirector.tsx`（拍摄模拟触发 + 音效开关 + 每镜配乐选择 + storyboard.json 导出）  
> 校验：`scripts/check-sound.ts`（`npx tsx scripts/check-sound.ts`）

**本页只讲「去哪里找音乐、模拟里响什么音效」。仓库里不捆绑任何音频文件。**

---

## 一、配乐库：10 种情绪

每条 = 情绪 → 适用场面 → 推荐乐器/感觉 → 来源 + 许可证。许可证是写代码时的快照，**下载前务必再看一眼曲目页**——库会换许可。

| 情绪 | 推荐 | 乐器/感觉 | 来源 | 许可证 |
|---|---|---|---|---|
| 💕 浪漫 | 柔板钢琴（例：肖邦《夜曲 Op. 9 No. 2》，曲子是公共版权） | 钢琴独奏，柔板；安静留白，让台词先出来 | Musopen | 曲子公共版权；录音按条标 CC0/CC BY |
| 🥊 打斗 | 重鼓（例：Kevin MacLeod《Hitman》） | 重鼓 + 急促弦乐；鼓点跟出拳走 | Incompetech | CC BY 3.0 |
| 🕵️ 悬疑 | 低音弦乐（例：Kevin MacLeod《Darkest Child》） | 低音弦乐 + 不协和长音；音越少越吓人 | Incompetech | CC BY 3.0 |
| 🏮 古装 | 古筝（去库里搜 guzheng / Chinese traditional） | 古筝 + 笛；拨弦留白，像烛光一样一闪一闪 | YouTube 音频库（或 FMA） | 按曲目：免署名许可 或 CC BY |
| 😂 喜剧 | 轻快拨弦（例：Kevin MacLeod《Monkeys Spinning Monkeys》） | 轻快拨弦 + 长笛；笑点落在拨弦的空拍上 | Incompetech | CC BY 3.0 |
| 😢 悲伤 | 独奏大提琴（例：萨蒂《Gymnopédie No. 3》，MacLeod 演绎版） | 独奏大提琴或缓慢钢琴；一个音拉长，越慢越疼 | Incompetech | CC BY 3.0（曲子本身公共版权） |
| 🏃 紧张追逐 | 快打击乐（例：Kevin MacLeod《A Mission》） | 快速打击乐 + 驱动型低音；脚步声踩在鼓点上 | Incompetech | CC BY 3.0 |
| 🏠 温馨家庭 | 轻柔木吉他（去库里按心情筛「温馨/平静」） | 轻柔木吉他；暖、不抢戏 | YouTube 音频库 | 按曲目：免署名许可 或 CC BY |
| 🌃 夜店/都市 | 电子霓虹（去库里搜 synthwave / electronic night） | 电子合成器/合成波；低音压着、亮音闪着 | Pixabay Music | Pixabay 内容许可（免费、无需署名） |
| ⚔️ 史诗/战争 | 管弦乐（例：Kevin MacLeod《Despair and Triumph》） | 管弦乐团 + 合唱式高潮；高潮只留给全片最关键的一镜 | Incompetech | CC BY 3.0 |

### 曲名是怎么核实的

只写了核实过的曲名，其余条目只给「去该库搜什么」，不编曲名：

- 《Monkeys Spinning Monkeys》——Wikimedia Commons 有该曲文件页（CC BY 3.0，ISRC USUAN1400011），Incompetech 原曲。
- 《Scheming Weasel（faster version）》——同上，喜剧备用（未进代码，只记在这里）。
- 《Hitman》《Darkest Child》《A Mission》《Despair and Triumph》《Gymnopédie No. 3》——Incompetech 曲库曲目，见 MacLeod 代表作/配乐收录表；CC BY 3.0。
- 肖邦《夜曲 Op. 9 No. 2》、萨蒂《Gymnopédie No. 3》——曲子本身是公共版权（作曲家去世超 70 年）；**录音**须另找一条标 CC0/CC BY 的，录音许可以下载页为准。

### 来源入口

- **Incompetech**（Kevin MacLeod 曲库）：https://incompetech.com/music/royalty-free/ —— 免费 CC BY 3.0，须按曲目页格式署名（曲名 / Kevin MacLeod / incompetech.com / CC BY 3.0）；不想署名可付费买免署名许可。按 feel（aggressive / eerie / quirky…）搜最快。
- **YouTube 音频库**：进 YouTube Studio（https://studio.youtube.com）→ 左侧「音频库」。按心情/流派/时长/是否需署名筛；标「无需署名」的直接用，标 CC BY 的须在简介署名。
- **Musopen**：https://musopen.org —— 公共版权古典乐的录音库，每条录音标 CC0 或 CC BY，下载前看该条标注。
- **Pixabay Music**：https://pixabay.com/music/ —— Pixabay 内容许可，免费、无需署名；不得把音乐本身原样转卖或声称是自己创作。
- **Free Music Archive**：https://freemusicarchive.org —— 每首许可不同（CC0 / CC BY / CC BY-NC…），以下载页为准；CC BY-NC 不可商用。

### 每镜怎么推荐（suggestMusicForShot）

优先级（先赢）：

1. 本镜显式选的配乐情绪（`Shot.musicMood`，面板里每镜可改）；
2. 有打斗编舞，或演员动作是打斗类（fight/punch/kick/block）→ 打斗；
3. 剑类飞行动作（flySword/flyBroom/wireFly/leap）→ 古装；
4. 灯光映射（Part 2 的灯光维度）：烛光 → 古装；霓虹 → 夜店/都市；黄昏 → 浪漫；暖光 → 温馨家庭；月光/阴天 → 悲伤；戏剧光/夜晚/冷光 → 悬疑；白天 → 温馨家庭；
5. 默认：温馨家庭。

例子：打斗场面 + 戏剧光 → 打斗音乐；浪漫场面 + 黄昏灯光 → 柔板钢琴。

每镜的推荐随 storyboard.json 导出（`shots[].music`：情绪、曲名、乐器、来源、来源链接、许可证、搜什么、核实过的示例曲），控制包下游按此配乐。

---

## 二、合成音效：9 个（WebAudio，无音频文件）

| 音效 | 合成方法 | 触发时机（拍摄模拟） |
|---|---|---|
| 出拳 punch | 正弦 160→55Hz 闷响 + 300Hz 带通噪声 burst，0.12s | 打斗 beat（punch）开始；时间轴 punch 段开始；默认动作 punch 在镜开头 |
| 踢 kick | 正弦 110→38Hz 低沉闷响 + 200Hz 低通噪声，0.18s | 打斗 beat（kick）开始；时间轴 kick 段开始 |
| 脚步 footstep | 400Hz 低通噪声轻点 + 70Hz 低音，0.06s，音量小 | 走/跑时按步频（走 0.55s/步，跑 0.4s/步），最多 2 个演员 |
| 剑风声 swordWhoosh | 噪声带通 500→2600Hz 上扫，0.3s | 时间轴 flySword 段开始 |
| 关门 doorClose | 正弦 95→48Hz 闷响 + 短促咔哒，0.2s | **暂无触发动作**——动作库里没有开/关门；在面板「音效」行试听 |
| 格挡 block | 方波 220Hz + 三角波 620Hz 金属碰击，0.08s | 打斗 beat（block）开始；时间轴 block 段开始 |
| 倒地 fall | 正弦 140→50Hz 下滑 + 300Hz 低通噪声闷响，0.35s | 打斗 beat（fall）开始；时间轴 fall 段开始 |
| 闪避 dodge | 噪声带通 900→300Hz 下扫气流声，0.22s | 打斗 beat（dodge）开始；时间轴 dodge/flyBroom/wireFly 段开始 |
| 跳 jump | 正弦 300→520Hz 轻上扬，0.18s，音量小 | 时间轴 jump/leap 段开始 |

没有音效的动作（idle/stand/sit/turn/wave/point/bow/crouch/getUp/climb/cling/ride/hide/prone/rappel/swim）= 静默，不硬配。

### 触发规则（collectDueSounds，`src/lib/soundEffects.ts`）

- 按帧时间窗 `(prevT, curT]` 算：段开始、beat 开始（用 `fightBeatAt` 的 `beatStart`）、镜开头默认动作、脚步步频。
- 一段/一拍只响一次（fired 集合）；换镜、scrub 回拨、大跳（窗口 > 0.5s，视为跳播）时静默重置，不补响一串。
- 音效开关关掉时只推进游标、不发声——重开时不补响。
- 音量封顶 0.6、时长 ≤ 0.4s，短促不吵人。

### 音效开关

- 位置：面板「音效」行 + 模拟播放条（🔊/🔇）。
- 默认开，持久化在 `zhuya-cine-shots-v1`（和分镜/演员/灯光同一个 store）。
- AudioContext 在用户手势里建（点「开始模拟」/点「试听」）；没有 AudioContext（node、旧浏览器）时全部调用静默返回 false，模拟照常播，绝不崩。

---

## 三、不做的事

- 不捆绑任何音频文件，不新增音频依赖。
- 配乐不自动播放、不进导出视频——模拟是静默 previz，配乐是「推荐 + 下载指引」，用户按推荐下载后配进成片。
- 关门音效暂无触发动作（动作库无开/关门）：等以后有门相关动作/道具再接，现在只保留合成 + 试听。
- 剧本（Part 4）不在此任务内。
