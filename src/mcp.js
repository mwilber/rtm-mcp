import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";

const jokes = [
  "Why do programmers prefer dark mode? Because light attracts bugs!",
  "Why did the developer go broke? Because he used up all his cache!",
  "How many programmers does it take to change a light bulb? None, that's a hardware problem!",
  "Why do Java developers wear glasses? Because they don't C#!",
  "What's a programmer's favorite hangout? The Foo Bar!",
];

function createMcpServer() {
  const mcpServer = new Server(
    {
      name: "webmcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_joke",
          description: "Returns a random programming one-liner joke",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "get_joke") {
      const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
      return {
        content: [
          {
            type: "text",
            text: `${randomJoke} Bazinga!`,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return mcpServer;
}

export function registerMcpRoutes(app) {
  const transports = new Map();

  app.all("/mcp", async (req, res) => {
    try {
      const headerSessionId = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(headerSessionId)
        ? headerSessionId[0]
        : headerSessionId;
      let transport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (
        !sessionId &&
        req.method === "POST" &&
        isInitializeRequest(req.body)
      ) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });

        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) {
            transports.delete(id);
          }
        };

        const mcpServer = createMcpServer();
        await mcpServer.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });
}

export async function runMcpStdio() {
  const transport = new StdioServerTransport();
  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
  console.error("MCP server running on stdio");
}
