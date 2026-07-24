"use client";
/**
 * useMcpBridge — 浏览器侧的 MCP 命令桥（挂在 TopBar，App 打开即生效）。
 *
 * 每 2s 一趟 /api/mcp/sync：
 *   推送 — 当前完整设计快照（serializeCurrentDesign），MCP 的 get_design_state 读它
 *   拉取 — MCP 工具入队的命令（apply_template / apply_design），逐条落进 store
 *   回执 — 应用结果 {id, ok, message}，MCP tools/call 等这个回执答复 CLI
 *
 * 外部 agent（Claude Code 等）由此获得「所见即所得」的设计闭环：CLI 里调工具，
 * 浏览器画布 2s 内生效。失败静默（best-effort）——MCP 未用时零打扰。
 */
import { useEffect } from "react";
import { useDesignerStore } from "./store";
import { serializeCurrentDesign } from "./aiDesignSerialize";
import type { AiDesignResult } from "./aiDesignTypes";

interface BridgeCommand {
  id: string;
  type: "apply_template" | "apply_design";
  payload: Record<string, unknown>;
}

export function useMcpBridge() {
  useEffect(() => {
    let stopped = false;
    let acks: Array<{ id: string; ok: boolean; message?: string }> = [];
    // 本标签的身份：服务端按它发租约，多标签同开只有租约持有者执行命令。
    const tabId = crypto.randomUUID();

    const tick = async () => {
      if (stopped) return;
      try {
        const s = useDesignerStore.getState();
        const design = serializeCurrentDesign(s.floorPlans, s.exterior, s.yardPlan);
        const res = await fetch("/api/mcp/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tabId, design, ack: acks }),
        });
        acks = [];
        const data = (await res.json()) as { commands?: BridgeCommand[] };
        for (const cmd of data.commands ?? []) {
          try {
            const st = useDesignerStore.getState();
            if (cmd.type === "apply_template") {
              st.applyProjectTemplate(String(cmd.payload.templateId));
              acks.push({ id: cmd.id, ok: true, message: `Template ${cmd.payload.templateId} applied.` });
            } else if (cmd.type === "apply_design") {
              st.applyAiDesign(cmd.payload.design as AiDesignResult, { merge: cmd.payload.merge !== false });
              acks.push({ id: cmd.id, ok: true, message: cmd.payload.merge !== false ? "Incremental design merged." : "Design rebuilt." });
            } else {
              acks.push({ id: cmd.id, ok: false, message: `Unknown command type ${cmd.type}` });
            }
          } catch (e) {
            acks.push({ id: cmd.id, ok: false, message: e instanceof Error ? e.message : "apply failed" });
          }
        }
        // 有回执就立刻补一趟，让 CLI 少等一个周期
        if (acks.length) {
          await fetch("/api/mcp/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tabId, ack: acks }),
          });
          acks = [];
        }
      } catch {
        /* best-effort：本地无 MCP 使用时零打扰 */
      }
    };

    // ⚠️ 定时器放 Web Worker：真实用法里用户在 CLI 干活、浏览器标签在后台——Chrome
    // 会把**主线程** setInterval 节流到约 1 次/分钟（实测 hidden 标签页推送稀成这样，
    // agent 的命令要等一分钟才生效）。Worker 线程的定时器不受页面可见性节流，后台
    // 标签也保持 2s 心跳。Worker 不可用（老浏览器/SSR 安全网）回落主线程定时器。
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      const src = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)},2000)"], { type: "application/javascript" }));
      worker = new Worker(src);
      worker.onmessage = () => void tick();
      URL.revokeObjectURL(src);
    } catch {
      timer = setInterval(tick, 2000);
    }
    void tick(); // 打开即同步一次，别让首个命令等 2s
    return () => {
      stopped = true;
      worker?.terminate();
      if (timer) clearInterval(timer);
    };
  }, []);
}
