# 接续笔记 — walkthrough-restore 分支

> 最后更新：2026-05-19（gracious-cannon-4c0b26 worktree）

---

## 当前分支状态

- 分支：`walkthrough-restore`
- 最新 commit：`b6d380d` docs: add real-world makeover patterns to yard references
- 远端已同步：`origin/walkthrough-restore` ✓

---

## 本轮做了什么

### 1. 外观图拖拽性能优化（已 push 到 `claude/gracious-cannon-4c0b26`，已 cherry-pick 或 rebase 进 walkthrough-restore）

根本原因：Three.js `projectObject()` 每帧遍历 ~4200 个 mesh 做视锥剔除，JS 侧耗时约 120ms/帧。

具体改动：
- `HouseCanvas.tsx`：
  - `shadows.type` 改为 `PCFShadowMap`（原 `PCFSoftShadowMap`）
  - `preserveDrawingBuffer: false`（原 true，去掉 GPU→CPU 同步）
  - shadow mapSize 从 4096→2048
  - 新增 `ShadowFreezeOnOrbit` 组件：拖拽时 `gl.shadowMap.autoUpdate=false` 冻结阴影
  - 新增 `hideInterior` state：OrbitControls `onStart` 设 true，`onEnd` 延 150ms 重置
  - `HouseBody` 透传 `hideInterior` prop

- `FloorPlanExterior.tsx`：
  - `FloorPlanBuilding` 新增 `hideInterior` prop
  - `interiorRooms.map` 外层套 `<group visible={insideBuilding || !hideInterior}>`
  - 拖拽期间 visible=false → Three.js 跳过室内 ~3000+ 对象的遍历

效果：draw calls -38%，帧时间 -21%（预览 iframe 数据不可信，需真实浏览器验证）

### 2. 院子设计文档（docs/yard-design-references.md）

现 934 行，11 个章节。关键新增：
- §10 真实改造模板（10 个，含尺寸/功能区/步道拓扑/算法映射）
- §11 三条开发路径 Path 1/2/3，Path 2（模板库）现在是首选

---

## 待决策：院子开发路径

读完 `docs/yard-design-references.md` §11，选一条：

| Path | 描述 | 工作量 |
|------|------|--------|
| **Path 1** | 算法优化（现有 5 个模板质量提升） | 小 |
| **Path 2** | 扩展模板库（10 个真实场景模板） | 中，§10 已把需求摸清 |
| **Path 3** | 新功能（subtype 标签 + 朝向/预算适配） | 大 |

§10.1 发现：代码默认地块 30×30m 是 "Large"，但用户最多的是 "Small"（50–150㎡），**模板默认值偏了**，可能是 Path 1 里的一个快赢。

---

## 待验证

- [ ] 外观图拖拽流畅度：在真实 Chrome（localhost:3000）用 DevTools Performance 录制拖拽，看 JS long task 有没有从 ~120ms 降下来
- [ ] `hideInterior` 视觉：拖拽松手后室内家具恢复是否有闪烁（150ms 延迟够不够）
- [ ] `walkthrough-restore` 上的 fix(roomcanvas): restore camera pose on exit walkthrough —— 确认漫游退出后相机位置是否正确恢复

---

## 回家上手步骤

```bash
cd home-designer
git fetch origin
git checkout walkthrough-restore
git pull
npm install   # 如果 lockfile 有变
npm run dev
```

然后打开 `docs/yard-design-references.md` §11，决定 Path，告诉 Claude Code 开干。

---

## 注意事项

- `walkthrough-restore` 和 `claude/gracious-cannon-4c0b26` **不要 merge**，两条线独立
- 性能优化的改动在 gracious-cannon-4c0b26（commit `821149b`），如果 walkthrough-restore 需要这些改动，用 `git cherry-pick 821149b`
- Chrome 插件（Claude in Chrome）连不上是 MCP 配置问题，不影响开发，跳过即可
