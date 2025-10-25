import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
const transport = new StdioServerTransport();

server.connect(transport).catch(error => {
  console.error('[rtm-mcp] Failed to start MCP server (stdio):', error);
  process.exit(1);
});
