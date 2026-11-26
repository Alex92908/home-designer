/**
 * 内存诊断 HUD 的开关状态（从 sceneDiag.tsx 拆出）。
 *
 * 本模块是纯 React + localStorage，不依赖 three / @react-three/fiber：
 * 顶栏（TopBar，常驻首屏）只需要读开关、显示勾选态；真正的诊断扫描
 * （SceneDiag，fiber + sceneMemory）只进各画布 chunk。
 * sceneDiag.tsx 重导出这里的两个函数，旧 import 路径不断。
 */
import { useSyncExternalStore } from "react";

// ── HUD 开关(按钮控制,localStorage 持久化;关掉时连扫描都不跑,零开销)──────
let _open = (() => {
  try { return localStorage.getItem("zy_memhud") === "1"; } catch { return false; }
})();
const _openSubs = new Set<() => void>();
/** 由顶栏 ⚙ 设置菜单调用,开关内存面板。 */
export function setMemHudOpen(v: boolean) {
  _open = v;
  try { localStorage.setItem("zy_memhud", v ? "1" : "0"); } catch { /* ignore */ }
  _openSubs.forEach((f) => f());
}
/** 内存面板当前是否展开(顶栏菜单读它显示勾选态)。 */
export function useMemHudOpen(): boolean {
  return useSyncExternalStore(
    (cb) => { _openSubs.add(cb); return () => { _openSubs.delete(cb); }; },
    () => _open,
    () => false,
  );
}
