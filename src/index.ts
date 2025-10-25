import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { RTMClient } from './rtm-client.js';

const server = new McpServer({
  name: 'rtm-mcp',
  version: '0.1.0'
});

type DueDateRange = {
  start?: string;
  end?: string;
};

type ListTaskResult = {
  id: { list: string; series: string; task: string };
  name: string;
  due: string | null;
  priority: 1 | 2 | 3 | null;
  tags: string[];
};

type AddTaskResult = {
  success: true;
  id: { list: string; series: string; task: string };
};

const REQUIRED_RTM_ENV = ['RTM_API_KEY', 'RTM_SHARED_SECRET', 'RTM_AUTH_TOKEN'] as const;

const createRtmClient = (): RTMClient => {
  const missing = REQUIRED_RTM_ENV.filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing Remember The Milk credentials (${missing.join(
        ', '
      )}). Set them in the environment before calling RTM tools.`
    );
  }

  return new RTMClient({
    apiKey: process.env.RTM_API_KEY as string,
    sharedSecret: process.env.RTM_SHARED_SECRET as string,
    authToken: process.env.RTM_AUTH_TOKEN as string
  });
};

const resolveRtmClient = (() => {
  let client: RTMClient | null = null;
  return () => {
    if (!client) {
      client = createRtmClient();
    }
    return client;
  };
})();

const formatTaskSummary = (task: ListTaskResult): string => {
  const bits = [`• ${task.name}`];
  if (task.due) {
    bits.push(`due ${task.due}`);
  }
  if (task.priority) {
    bits.push(`priority ${task.priority}`);
  }
  if (task.tags.length) {
    bits.push(`#${task.tags.join(' #')}`);
  }
  return bits.join(' | ');
};

server.registerTool(
  'hello-world',
  {
    title: 'Hello World Tool',
    description: 'Returns a friendly greeting. Optionally personalize it with a name.',
    inputSchema: {
      name: z
        .string()
        .min(1, 'Provide at least one character')
        .max(120, 'Keep names short for the LLM UI')
        .describe('Optional name to greet')
        .optional()
    },
    outputSchema: {
      greeting: z.string()
    }
  },
  async ({ name }) => {
    const greeting = name ? `Hello, ${name}!` : 'Hello, world!';

    return {
      content: [
        {
          type: 'text',
          text: greeting
        }
      ],
      structuredContent: { greeting }
    };
  }
);

server.registerTool(
  'rtm-list-tasks',
  {
    title: 'RTM: List Tasks',
    description: 'Fetch tasks from Remember The Milk filtered by due date and tag.',
    inputSchema: {
      dueDate: z
        .string()
        .describe('Single due date filter (YYYY-MM-DD or natural language).')
        .optional(),
      dueStart: z.string().describe('Start of a due date range (YYYY-MM-DD).').optional(),
      dueEnd: z.string().describe('End of a due date range (YYYY-MM-DD).').optional(),
      tag: z.string().describe('Filter by a Remember The Milk tag.').optional()
    },
    outputSchema: {
      tasks: z.array(
        z.object({
          id: z.object({
            list: z.string(),
            series: z.string(),
            task: z.string()
          }),
          name: z.string(),
          due: z.string().nullable(),
          priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
          tags: z.array(z.string())
        })
      ),
      total: z.number()
    }
  },
  async ({ dueDate, dueStart, dueEnd, tag }) => {
    const client = resolveRtmClient();
    const dueRange: DueDateRange | undefined =
      dueStart || dueEnd ? { start: dueStart || undefined, end: dueEnd || undefined } : undefined;

    const tasks = (await client.listTasks({
      dueDate: dueDate ?? dueRange,
      tag: tag || undefined
    })) as ListTaskResult[];

    const summary =
      tasks.length === 0
        ? 'No tasks matched the supplied filters.'
        : tasks.slice(0, 10).map(formatTaskSummary).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: summary
        }
      ],
      structuredContent: {
        total: tasks.length,
        tasks
      }
    };
  }
);

server.registerTool(
  'rtm-add-task',
  {
    title: 'RTM: Add Task',
    description: 'Create a Remember The Milk task with optional due date, recurrence, and tags.',
    inputSchema: {
      name: z.string().min(1, 'Task name is required.'),
      dueDate: z
        .string()
        .describe('Natural language or ISO due date, e.g., "next Tuesday 5pm" or "2025-10-31".')
        .optional(),
      repeats: z
        .string()
        .describe('Recurrence pattern such as "every week" or "after 2 days".')
        .optional(),
      priority: z
        .union([z.literal(1), z.literal(2), z.literal(3)])
        .describe('1 (high), 2, or 3.')
        .optional(),
      tags: z.array(z.string().min(1)).max(10).describe('List of tags to apply.').optional(),
      mode: z
        .enum(['smart', 'explicit'])
        .default('smart')
        .describe('Use Smart Add parsing or explicit multi-step updates.')
    },
    outputSchema: {
      success: z.literal(true),
      id: z.object({
        list: z.string(),
        series: z.string(),
        task: z.string()
      })
    }
  },
  async ({ name, dueDate, repeats, priority, tags, mode = 'smart' }) => {
    const client = resolveRtmClient();
    const result = (await client.addTask({
      name,
      dueDate: dueDate || undefined,
      repeats: repeats || undefined,
      priority: priority || undefined,
      tags: tags || undefined,
      mode
    })) as AddTaskResult;

    return {
      content: [
        {
          type: 'text',
          text: `Created task "${name}" (list ${result.id.list}).`
        }
      ],
      structuredContent: result
    };
  }
);

const transport = new StdioServerTransport();

server.connect(transport).catch(error => {
  console.error('[rtm-mcp] Failed to start MCP server:', error);
  process.exit(1);
});
