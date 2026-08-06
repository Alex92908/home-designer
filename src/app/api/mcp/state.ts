/**
 * MCP 状态桥（进程内内存，单用户本地场景）。
 *
 * 回路：
 *   浏览器 ──(每 2s POST /api/mcp/sync {design})──▶ 服务端存最新设计快照
 *   浏览器 ◀─(同一响应携带 commands 队列)────────── MCP 工具入队的待执行命令
 *   浏览器 ──(应用后 POST {ack})────────────────▶ 结果回执
 *   MCP tools/call ──enqueue → waitResult──────────▶ 拿到浏览器真实回执再答复 CLI
 *
 * 进程重启即清空（MVP 设计如此）。多标签页同开会都拉命令——本地单用户场景可接受。
 */

export interface McpCommand {
  id: string;
  type: "apply_template" | "apply_design" | "check_layout" | "auto_fix_layout";
  payload: Record<string, unknown>;
  enqueuedAt: number;
}

export interface CommandResult {
  ok: boolean;
  message?: string;
  at: number;
}

interface Bridge {
  /** 浏览器最近一次推送的完整设计快照（serializeCurrentDesign 的输出）。 */
  design: unknown | null;
  designAt: number;
  /** 院子只读摘要(分区/小径/导入模型等 apply 契约覆盖不到的部分)。 */
  yardSummary: string;
  queue: McpCommand[];
  results: Map<string, CommandResult>;
  /** 桥租约：同一时刻只有一个标签页是「执行者」（推快照+拉命令）。多标签同开时
   *  没有租约会互相抢命令/快照来回打架（实测：命令被另一个标签执行、get_design_state
   *  读到两个标签交替推的快照）。租约 6s 过期，标签关了自动易主。 */
  leaseTabId: string | null;
  leaseAt: number;
}

// ⚠️ 必须挂 globalThis：Next dev 会把 /api/mcp 与 /api/mcp/sync 编成**各自的模块
// 实例**（module-scope 变量各一份）——浏览器推的快照进 sync 的实例、MCP 工具读的是
// 另一份，互相看不见（实测：sync 推送后 get_design_state 的 ageMs 照涨、命令永远
// 无人拉取超时）。globalThis 单例让所有 route bundle 共享同一座桥（prisma 同款模式）。
const g = globalThis as unknown as { __zhuyaMcpBridge?: Bridge };
const bridge: Bridge = g.__zhuyaMcpBridge
  ?? (g.__zhuyaMcpBridge = { design: null, designAt: 0, yardSummary: "", queue: [], results: new Map(), leaseTabId: null, leaseAt: 0 });

/** 租约有效期：超过没心跳就允许易主（标签页关闭/切走后新标签接管）。 */
const LEASE_MS = 6_000;

/** 申请/续租。返回该标签当前是否持有租约。 */
export function acquireLease(tabId: string): boolean {
  const now = Date.now();
  if (bridge.leaseTabId === tabId || !bridge.leaseTabId || now - bridge.leaseAt > LEASE_MS) {
    bridge.leaseTabId = tabId;
    bridge.leaseAt = now;
    return true;
  }
  return false;
}

/** 强制把租约交给指定标签 —— App 内 agent 专用。
 *
 *  租约本是「先到先得」,给外部 CLI(Claude Code)用没问题:同一时刻只该有一个画布
 *  执行命令。但 App 内的 agent 是**从某个标签里发起的**,用户当然期望改的是自己这一页;
 *  若此刻租约在别的标签手里(比如另开的预览页),命令会落到那边,自己的画布纹丝不动,
 *  而 get_design_state 读到的还是对方的快照 → 模型看到的状态自相矛盾(实测踩过)。
 *  故 agent 每次调工具前把租约拽回发起方。 */
export function forceLease(tabId: string): void {
  bridge.leaseTabId = tabId;
  bridge.leaseAt = Date.now();
}

/** 浏览器视为「在线」的窗口：最近 15s 内推送过快照。 */
const CONNECTED_MS = 15_000;

export function pushDesign(design: unknown, yardSummary?: string): void {
  bridge.design = design;
  bridge.designAt = Date.now();
  if (typeof yardSummary === "string") bridge.yardSummary = yardSummary;
}

export function getDesign(): { design: unknown | null; ageMs: number; connected: boolean; yardSummary: string } {
  const ageMs = bridge.designAt ? Date.now() - bridge.designAt : Infinity;
  return { design: bridge.design, ageMs, connected: ageMs < CONNECTED_MS, yardSummary: bridge.yardSummary };
}

export function isConnected(): boolean {
  return getDesign().connected;
}

export function enqueue(type: McpCommand["type"], payload: Record<string, unknown>): string {
  const id = crypto.randomUUID();
  bridge.queue.push({ id, type, payload, enqueuedAt: Date.now() });
  return id;
}

/** 浏览器轮询：取走全部待执行命令（清空队列）。 */
export function drainCommands(): McpCommand[] {
  const out = bridge.queue;
  bridge.queue = [];
  return out;
}

export function ack(id: string, ok: boolean, message?: string): void {
  bridge.results.set(id, { ok, message, at: Date.now() });
  // 防内存缓慢增长：只留最近 50 条回执
  if (bridge.results.size > 50) {
    const keys = [...bridge.results.keys()];
    for (const k of keys.slice(0, bridge.results.size - 50)) bridge.results.delete(k);
  }
}

/** MCP 工具等浏览器回执：每 250ms 查一次，最长 timeoutMs。超时返回 null。 */
export async function waitResult(id: string, timeoutMs = 12_000): Promise<CommandResult | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = bridge.results.get(id);
    if (r) return r;
    await new Promise(res => setTimeout(res, 250));
  }
  return null;
}
