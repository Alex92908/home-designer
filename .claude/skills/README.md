# .claude/skills

Claude Code 技能。分两类：

## 项目专属（本仓库权威，优先）
- **zhuya-scene-authoring** — 素材入库 + 场景/片场模板搭建的**真实**约定
  （数据模型、fit:contain、分类无兜底、compress-models 管线、坐标系、调研先行规矩）。
  这些是本代码库独有的，通用 3D skill 不知道；冲突时以此为准。

## 通用参考（vendored，第三方）
从 https://github.com/freshtechbro/claudedesignskills 取用，仅作通用技术参考：
- **react-three-fiber** — R3F 声明式 3D 通用技巧
- **blender-web-pipeline** — Blender→glTF Web 导出/优化通用流程

> 注意：通用 skill 讲的是「一般 Three.js/R3F 该怎么做」，不含本项目的
> `fit:"contain"` 归一化、`FURNITURE_CATEGORIES` 无兜底、`furnitureOverrides`
> 坐标系等约定。碰到本项目的具体活，以 zhuya-scene-authoring + 实际代码为准。
