import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { BrokerClient } from './broker-client.js';
import { DEFAULT_TOOLS } from './tool-handlers.js';

export { DEFAULT_TOOLS } from './tool-handlers.js';
export type { ToolDef } from './tool-handlers.js';

const CHANNEL_NOTIFICATION_METHOD = 'notifications/claude/channel';

export interface McpServerOptions {
  broker: BrokerClient;
  instructions?: string;
  serverName?: string;
  serverVersion?: string;
}

export interface ShimMcpServer {
  server: Server;
  start(): Promise<void>;
  stop(): Promise<void>;
  pushChannelEvent(content: string, meta: Record<string, string>): Promise<void>;
}

export function buildShimMcpServer(opts: McpServerOptions): ShimMcpServer {
  const server = new Server(
    {
      name: opts.serverName ?? 'claude-broker',
      version: opts.serverVersion ?? '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      instructions: opts.instructions,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: DEFAULT_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const response = await opts.broker.callTool(name, (args ?? {}) as Record<string, unknown>);
    if (response.error) {
      return {
        isError: true,
        content: [{ type: 'text', text: response.error }],
      };
    }
    const payload =
      response.result === undefined
        ? ''
        : typeof response.result === 'string'
          ? response.result
          : JSON.stringify(response.result);
    return {
      content: [{ type: 'text', text: payload }],
    };
  });

  let transport: StdioServerTransport | null = null;

  return {
    server,
    async start() {
      transport = new StdioServerTransport();
      await server.connect(transport);
    },
    async stop() {
      if (transport) {
        await server.close();
        transport = null;
      }
    },
    async pushChannelEvent(content, meta) {
      // The MCP SDK's Server is generic on NotificationT. Cast through unknown
      // because claude/channel notifications aren't in the base ServerNotification union.
      await (server as unknown as {
        notification(n: {
          method: string;
          params: { content: string; meta: Record<string, string> };
        }): Promise<void>;
      }).notification({
        method: CHANNEL_NOTIFICATION_METHOD,
        params: { content, meta },
      });
    },
  };
}
