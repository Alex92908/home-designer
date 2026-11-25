#!/usr/bin/env node
/**
 * zhuya-mcp-server — stdio MCP transport adapter for ZhuyaHome's
 * short-film （出短片） choreography.
 *
 * THIN PROXY, by design: no tool logic lives here. initialize / tools/list /
 * tools/call are forwarded verbatim to the app's HTTP JSON-RPC endpoint
 * (/api/mcp, server "zhuya-design"). The app owns the tool definitions,
 * server-side validation, and the in-memory bridge to the browser
 * (enqueue → page pulls every 2s → executes against useCineStore → acks).
 *
 *   AI client (Claude Desktop / Cursor / Claude Code)
 *     ── stdio JSON-RPC ──▶ this server
 *     ── HTTP JSON-RPC ──▶ http://localhost:3102/api/mcp
 *     ── in-memory bridge ──▶ browser (useMcpBridge, 2s tick)
 *     ──▶ useCineStore (actors / shots / sim / export queue)
 *
 * Base URL comes from env ZHUYA_MCP_URL (default http://localhost:3102/api/mcp).
 * The app must be running (`npm run build && npm run start -- -p 3102`, or
 * `npm run dev` on the same port) AND the designer page open in a browser
 * (/?shortfilm=1) for mutating film tools to apply — otherwise tools/list
 * still works, but film_* calls return a "not connected" error.
 *
 * Logs go to stderr only: stdout is the JSON-RPC channel, never pollute it.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.ZHUYA_MCP_URL ?? "http://localhost:3102/api/mcp";

/** One JSON-RPC 2.0 call to the app's HTTP MCP endpoint. */
async function rpc(method, params) {
  let res;
  try {
    res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
  } catch (e) {
    throw new Error(
      `Cannot reach the ZhuyaHome app at ${BASE_URL} (${e instanceof Error ? e.message : e}). ` +
        "Is the app running on that port?",
    );
  }
  if (!res.ok) {
    throw new Error(`MCP HTTP endpoint ${BASE_URL} returned HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.error) {
    throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
  }
  return body.result;
}

const server = new Server(
  { name: "zhuya-film", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await rpc("tools/list", {});
  return { tools: result.tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await rpc("tools/call", {
    name: request.params.name,
    arguments: request.params.arguments ?? {},
  });
  // The HTTP endpoint already returns MCP-shaped content: [{type:"text", text}].
  return { content: result.content };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`zhuya-mcp-server: proxying stdio MCP to ${BASE_URL}`);
