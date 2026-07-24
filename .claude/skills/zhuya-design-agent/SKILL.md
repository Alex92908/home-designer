---
name: zhuya-design-agent
description: >
  筑雅 ZHUYA 智能建筑/室内设计 agent 工作流：通过筑雅的 MCP server
  (http://localhost:3000/api/mcp) 对话式完成设计——咖啡馆/餐厅/办公室/别墅/住宅，
  模板打底 + 增量微调，浏览器画布实时生效。当用户想「帮我设计一间…」「改一下外墙/
  某个房间/家具摆位」「换个风格」并且筑雅在本机跑着时使用。本 skill 是给接入方
  agent 的操作手册；也可整目录分发给最终用户放进他们的 .claude/skills/。
---

# 筑雅智能设计 · Agent 工作流

你是设计师。筑雅暴露的 MCP 工具是你的画笔——**你自己产设计 JSON**，不需要再调别的大模型。

## 0. 接入（一次性）

用户需在本机跑筑雅（`npm run dev`，http://localhost:3000）并**保持页面打开**（浏览器每 2s 与 MCP 桥同步，命令才会落到画布）。

Claude Code 接入：

```bash
claude mcp add --transport http zhuya http://localhost:3000/api/mcp
```

接入后你可用 6 个工具：`get_design_guide` / `list_templates` / `apply_project_template` / `apply_design` / `get_design_state` / `open_preview`。

## 1. 铁律

- **先读契约再设计**：第一次设计前必调 `get_design_guide`，你的设计 JSON 必须严格遵守它（房型枚举、坐标系、素材 id 目录都在里面）。
- **模板打底，不从零瞎生成**：用户意图命中业态/风格（咖啡馆/餐厅/办公室/日式/地中海/幕墙/泳池别墅…）→ `list_templates` 挑最贴近的 → `apply_project_template`。模板是人工精修的，比从零生成好得多。
- **增量微调用 merge:true**：模板落底后，用户的具体要求（"玻璃门面""吧台卡座""外墙米白"）用 `apply_design {design: <只含要改的字段>, merge: true}` 叠加。**只发 delta**，别整套重发。
- **改前先看现状**：微调既有设计前调 `get_design_state`，基于真实现状改（房间尺寸、已有家具位置），不要凭想象。
- **验证再汇报**：apply 后工具会返回浏览器真实回执（ok/失败/未连接）。失败/未连接要如实告诉用户，别谎报成功。改完可再 `get_design_state` 抽查关键字段落没落上。

## 2. 标准流程

```
用户描述
  → 含糊就先问清：业态？风格？几层？硬性要求（如天台/泳池/幕墙）？
  → get_design_guide（首次）
  → list_templates → 命中 → apply_project_template
  →（未命中任何模板：按契约从零 apply_design {merge:false, floorLayouts 必给}）
  → 用户具体要求逐条 → apply_design {merge:true, 只发 delta}
  → get_design_state 抽查 → open_preview 告诉用户怎么看（外观/房间/漫游）
  → 用户反馈 → 继续增量微调
```

## 3. 设计 JSON 要点（细节以 get_design_guide 为准）

- 坐标：**房间内局部 cm**，原点=房间西北(左后)角，x→东，z→南；家具 rotation 为度。
- 房间落位：`floorLayouts[].rooms[]` 的 x/y 是**楼层平面 cm**（同 NW 原点约定）。
- 素材按 **id** 选：墙/地/灯/砖、家具、院子树/花/石、外墙装饰的 id 目录都在契约里，别造 id。
- 尺度品味：大气雅致——房间放大、家具留白、别塞太挤（模板的密度就是标杆）。

## 4. 失败排查

| 现象 | 处理 |
|---|---|
| 回执 `Browser not connected` | 让用户打开/切回 http://localhost:3000 页面；命令已排队，页面一开就会应用 |
| 超时无回执 | 页面可能在后台被节流——让用户把标签页切到前台再试 |
| apply_design 被拒 | merge=false 时必须给 floorLayouts；对照 get_design_guide 检查 JSON |

## 5. 分发给最终用户

把本目录整个拷给用户放 `~/.claude/skills/zhuya-design-agent/`（或项目 `.claude/skills/`），再执行上面 `claude mcp add`。之后在 Claude Code 里一句「帮我设计一间临街咖啡馆」即可全程对话式设计。
