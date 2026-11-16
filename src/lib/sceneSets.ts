/**
 * sceneSets — 片场（云横店）场景清单。
 *
 * 导演台"一键搭片场"、描述匹配、画廊"片场系列"共用的单一事实来源：
 * id 以 "set-" 开头的 PROJECT_TEMPLATES 就是全部片场——加新场景 =
 * 在 projectTemplates.ts 里加一个 ProjectTemplate（id 以 set- 开头），
 * 这里自动出现，不用逐处硬编码。
 *
 * 本文件只做轻量映射（名字/emoji/面积/描述），不 import 任何重型渲染模块
 * 之外的东西；PROJECT_TEMPLATES 本身已被 TemplatesPanel 等引用，包体积
 * 不因此新增。
 */
import { PROJECT_TEMPLATES } from "./projectTemplates";

export interface SceneSet {
  id: string;
  name: string;
  nameEn: string;
  emoji: string;
  description: string;
  descriptionEn: string;
  areaSqm: number;
}

/** 全部可选片场（按 PROJECT_TEMPLATES 里的顺序） */
export const SCENE_SETS: SceneSet[] = PROJECT_TEMPLATES.filter((t) => t.id.startsWith("set-")).map((t) => ({
  id: t.id,
  name: t.name,
  nameEn: t.nameEn,
  emoji: t.emoji,
  description: t.description,
  descriptionEn: t.descriptionEn,
  areaSqm: t.areaSqm,
}));

export function getSceneSet(id: string): SceneSet | undefined {
  return SCENE_SETS.find((s) => s.id === id);
}
