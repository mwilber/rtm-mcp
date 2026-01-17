import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { RTMClient } from "./rtm-client.js";

const REQUIRED_RTM_ENV = ["RTM_API_KEY", "RTM_SHARED_SECRET", "RTM_AUTH_TOKEN"];
const isRtmDebugEnabled = () =>
  process.env.RTM_DEBUG === "1" ||
  process.env.RTM_DEBUG === "true" ||
  process.argv.includes("--rtm-debug");

const createRtmClient = () => {
  const missing = REQUIRED_RTM_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing Remember The Milk credentials (${missing.join(
        ", "
      )}). Set them in the environment before calling RTM tools.`
    );
  }

  return new RTMClient({
    apiKey: process.env.RTM_API_KEY,
    sharedSecret: process.env.RTM_SHARED_SECRET,
    authToken: process.env.RTM_AUTH_TOKEN,
    debug: isRtmDebugEnabled(),
  });
};

const resolveRtmClient = (() => {
  let client = null;
  return () => {
    if (!client) {
      client = createRtmClient();
    }
    return client;
  };
})();

const formatTaskSummary = (task) => {
  const bits = [`• ${task.name}`];
  if (task.due) {
    bits.push(`due ${task.due}`);
  }
  if (task.priority) {
    bits.push(`priority ${task.priority}`);
  }
  if (Array.isArray(task.tags) && task.tags.length) {
    bits.push(`#${task.tags.join(" #")}`);
  }
  return bits.join(" | ");
};

function createMcpServer() {
  const mcpServer = new Server(
    {
      name: "rtm-mcp",
      version: "0.1.0",
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
          name: "rtm-list-tasks",
          title: "RTM: List Tasks",
          description:
            "Fetch tasks from Remember The Milk filtered by due date and tag.",
          inputSchema: {
            type: "object",
            properties: {
              dueDate: {
                type: "string",
                description:
                  "Single due date filter (YYYY-MM-DD or natural language).",
              },
              dueStart: {
                type: "string",
                description: "Start of a due date range (YYYY-MM-DD).",
              },
              dueEnd: {
                type: "string",
                description: "End of a due date range (YYYY-MM-DD).",
              },
              tag: {
                type: "string",
                description: "Filter by a Remember The Milk tag.",
              },
            },
          },
        },
        {
          name: "rtm-add-task",
          title: "RTM: Add Task",
          description:
            "Create a Remember The Milk task with optional due date, recurrence, and tags.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                minLength: 1,
                description: "Task name.",
              },
              dueDate: {
                type: "string",
                description:
                  'Natural language or ISO due date, e.g., "next Tuesday 5pm" or "2025-10-31".',
              },
              repeats: {
                type: "string",
                description: 'Recurrence pattern such as "every week".',
              },
              priority: {
                type: "integer",
                enum: [1, 2, 3],
                description: "1 (high), 2, or 3.",
              },
              tags: {
                type: "array",
                items: { type: "string", minLength: 1 },
                maxItems: 10,
                description: "List of tags to apply.",
              },
              mode: {
                type: "string",
                enum: ["smart", "explicit"],
                default: "smart",
                description: "Use Smart Add parsing or explicit updates.",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "rtm-list-unwatched-movies",
          title: "RTM: List Unwatched Movies",
          description:
            'Fetch incomplete tasks tagged "movie" with no due date.',
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "rtm-set-due-date",
          title: "RTM: Set Due Date",
          description: "Update a task's due date.",
          inputSchema: {
            type: "object",
            properties: {
              listId: {
                type: "string",
                description: "Task list identifier.",
              },
              taskseriesId: {
                type: "string",
                description: "Task series identifier.",
              },
              taskId: {
                type: "string",
                description: "Task identifier.",
              },
              dueDate: {
                type: "string",
                description:
                  'Natural language or ISO due date, e.g., "next Tuesday 5pm" or "2025-10-31".',
              },
            },
            required: ["listId", "taskseriesId", "taskId", "dueDate"],
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = request.params || {};
    const args = params.arguments || {};

    if (params.name === "rtm-list-tasks") {
      const { dueDate, dueStart, dueEnd, tag } = args;
      const client = resolveRtmClient();
      const dueRange =
        dueStart || dueEnd
          ? { start: dueStart || undefined, end: dueEnd || undefined }
          : undefined;

      const tasks = await client.listTasks({
        dueDate: dueDate ?? dueRange,
        tag: tag || undefined,
      });

      const summary =
        tasks.length === 0
          ? "No tasks matched the supplied filters."
          : tasks.slice(0, 10).map(formatTaskSummary).join("\n");

      return {
        content: [
          {
            type: "text",
            text: summary,
          },
        ],
        structuredContent: {
          total: tasks.length,
          tasks,
        },
      };
    }

    if (params.name === "rtm-add-task") {
      const { name, dueDate, repeats, priority, tags, mode = "smart" } = args;
      const client = resolveRtmClient();
      const result = await client.addTask({
        name,
        dueDate: dueDate || undefined,
        repeats: repeats || undefined,
        priority: priority || undefined,
        tags: tags || undefined,
        mode,
      });

      return {
        content: [
          {
            type: "text",
            text: `Created task "${name}" (list ${result.id.list}).`,
          },
        ],
        structuredContent: result,
      };
    }

    if (params.name === "rtm-list-unwatched-movies") {
      const client = resolveRtmClient();
      const tasks = await client.listTasks({
        filter: "tag:movie AND status:incomplete AND due:never",
      });

      const summary =
        tasks.length === 0
          ? "No unwatched movies found."
          : tasks.slice(0, 10).map(formatTaskSummary).join("\n");

      return {
        content: [
          {
            type: "text",
            text: summary,
          },
        ],
        structuredContent: {
          total: tasks.length,
          tasks,
        },
      };
    }

    if (params.name === "rtm-set-due-date") {
      const { listId, taskseriesId, taskId, dueDate } = args;
      const client = resolveRtmClient();
      await client.setDueDate({ listId, taskseriesId, taskId, dueDate });

      return {
        content: [
          {
            type: "text",
            text: "Updated task due date.",
          },
        ],
        structuredContent: {
          success: true,
        },
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
