# zhuya-mcp-server — 出短片 MCP 编排（stdio 适配器）

让 AI 客户端（Claude Desktop / Cursor / Claude Code）通过 MCP 直接编排
ZhuyaHome 的出短片（film）功能：开片场、加演员、走位、多人同步动作、
分镜、模拟、导出分镜——演员们在同一个共享时钟上一起动。

## 它是什么（薄代理，不是第二套工具）

```
AI 客户端 ── stdio JSON-RPC ──▶ zhuya-mcp-server（本包）
              ── HTTP JSON-RPC ──▶ App /api/mcp（server "zhuya-design"）
              ── 内存桥 ──▶ 浏览器 useMcpBridge（每 2s 一跳）
              ──▶ useCineStore（演员 / 分镜 / 模拟 / 导出队列）
```

工具定义、服务端校验、浏览器命令桥全在 App 里（`src/app/api/mcp/`），
本包只做 stdio ↔ HTTP 的协议转发，不复制任何工具逻辑。改工具只改 App，
这里不用动。

## 前置条件

1. App 在跑，且端口与 `ZHUYA_MCP_URL` 一致（默认 `http://localhost:3102/api/mcp`）：
   ```bash
   cd /path/to/home-designer
   npm run build && npm run start -- -p 3102
   ```
2. 浏览器里打开设计器页面（出短片面板更佳）：`http://localhost:3102/?shortfilm=1`
   —— 变异类 film 工具（加演员、编动作……）要等浏览器回执才答复；页面没开
   时返回 "not connected" 错误。只读工具（`film_list_*`、`film_get_state`）
   不需要页面也能列出定义，但 `film_get_state` 没快照时也会报未连接。

## 接入配置

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）
或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows），把
`/ABSOLUTE/PATH/TO/home-designer/mcp-server` 换成你本机真实路径：

```json
{
  "mcpServers": {
    "zhuya-film": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/home-designer/mcp-server/index.mjs"],
      "env": {
        "ZHUYA_MCP_URL": "http://localhost:3102/api/mcp"
      }
    }
  }
}
```

改完重启 Claude Desktop。`env` 可省（默认就是 `http://localhost:3102/api/mcp`）。

### Cursor

`~/.cursor/mcp.json`（全局）或项目根目录 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "zhuya-film": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/home-designer/mcp-server/index.mjs"],
      "env": {
        "ZHUYA_MCP_URL": "http://localhost:3102/api/mcp"
      }
    }
  }
}
```

然后在 Cursor 设置 → MCP 里确认 `zhuya-film` 显示为已连接、工具列表里出现
`film_*`。

### Claude Code（CLI 也可以直接连 HTTP 端点，不用本包）

```bash
claude mcp add --transport http zhuya-design http://localhost:3102/api/mcp
```

## 工具一览（film_*）

| 工具 | 作用 |
| --- | --- |
| `film_list_sets` | 列出片场（id / 名字 / 时代 / 楼层 / 房间） |
| `film_open_set` | 原地加载一个片场（不刷新页面），返回 `/?shortfilm=1&template=<id>` |
| `film_get_state` | **一次拿全场**：全部演员 + 全部镜头 + 模拟/导出进度 —— 编排前先调它 |
| `film_list_actions` | 30 个动作，按类别分组（移动/姿态/手势/打斗/特技） |
| `film_list_costumes` | 全部服装（id / 名字 / 时代 / 颜色 / 配件）+ 24 个角色原型 |
| `film_add_actor` | 加一个演员：`from [x,z] → to [x,z]`；不给服装时自动配一件没人穿的 |
| `film_set_actor` | 改一个演员（名字/角色/朝向/动作/原型/服装/起止点） |
| `film_move_actor` | 改一个演员的 from / to |
| `film_remove_actor` | 删一个演员 |
| `film_add_waypoint` / `film_move_waypoint` / `film_remove_waypoint` | 单点增改走位路点 |
| `film_set_actor_waypoints` | 一次替换一个演员的整条走位 `[[x,z,t], ...]` |
| `film_set_group_action` | **多人同步动作**：同一动作 + 同一起始 + 同时长，加到每个演员的时间轴上；任一 id 非法则整单失败、一个也不加 |
| `film_add_shot` / `film_update_shot` / `film_remove_shot` | 增改删镜头（预设：orbit / dolly-in / crane-up / indoor-wide / indoor-medium / group-wide / indoor-closeup / indoor-ots） |
| `film_start_sim` / `film_stop_sim` | 开始 / 停止拍摄模拟（全部演员共享一个时钟一起动） |
| `film_export_storyboard` | 开始分镜批量导出（异步：回执只表示"已开始"，文件在浏览器里下载完成；用 `film_get_state` 看 queue 进度） |

设计工具（`get_design_guide` / `list_templates` / `apply_project_template` /
`apply_design` / `get_design_state` / `check_layout` / `auto_fix_layout` /
`yard_auto_layout` / `open_preview`）也同时透传——同一个 MCP 服务器既能
做设计又能排出短片。

## 典型编排流程

1. `film_list_sets` → 挑片场 → `film_open_set {templateId: "set-cafe"}`
2. `film_get_state` → 看清当前演员/镜头（坐标系：地面世界坐标 `[x, z]`，米）
3. `film_add_actor` × N（不同位置；不给 `costumeId` 会自动配不同服装）
4. `film_add_shot {presetId: "group-wide"}`（群体镜头一屏框住所有人）
5. `film_set_group_action {actorIds: [...], action: "wave", start: 0, duration: 2}`
   —— N 个人同一时刻一起挥手
6. `film_start_sim` 看模拟；`film_export_storyboard` 出分镜

## 诚实说明：现在做不了什么

Stage A 只有**控制面**（MCP + 已有的姿态系统），没有这些内容：

- **没有球 / 球物理**——`kick` 只是打斗动作，没有球可踢、传、接。
- **没有跳舞、没有唱歌 / 口型同步、没有话筒道具**。
- 所以**足球、篮球、MV 歌舞目前做不了**。它们是后续内容包
  （ball pack / dance-sync pack / singing pack），建在上面这套 MCP
  控制面之上——控制面先行，内容后补。

## 排障

- `Cannot reach the ZhuyaHome app at ...` → App 没跑，或端口不对。
  检查 `ZHUYA_MCP_URL`，确认 `curl http://localhost:3102/api/mcp` 有返回。
- film 工具报 `not connected` → 浏览器里打开设计器页
  （`http://localhost:3102/?shortfilm=1`），等 2 秒再试。
- 工具调用超时（`Timed out waiting for the browser...`）→ 页面被切到后台
  或关了；保持标签页打开。
- `Unknown actorId / presetId / ...` → 先调 `film_get_state` /
  `film_list_actions` / `film_list_costumes` 拿合法 id，服务端校验会把
  错的 id 点名报出来。

## 开发

```bash
cd mcp-server
npm install        # 只装 @modelcontextprotocol/sdk
npm start          # node index.mjs（stdio，日志走 stderr）
```

不用构建步骤：`index.mjs` 就是源码，Node ≥ 20 直接跑。
