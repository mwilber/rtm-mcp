import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'rtm-mcp',
  version: '0.1.0'
});

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

const transport = new StdioServerTransport();

server.connect(transport).catch(error => {
  console.error('[rtm-mcp] Failed to start MCP server:', error);
  process.exit(1);
});
