import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from './server.js';

type SessionRecord = {
  transport: StreamableHTTPServerTransport;
};

const app = express();
app.use(express.json({ limit: '1mb' }));

const sessions = new Map<string, SessionRecord>();

const initializeSession = async () => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: sessionId => {
      sessions.set(sessionId, { transport });
    },
    onsessionclosed: sessionId => {
      sessions.delete(sessionId);
    },
    enableJsonResponse: true
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  await server.connect(transport);
  return transport;
};

app.post('/mcp', async (req: express.Request, res: express.Response) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Missing or invalid session ID for non-initialize request'
          },
          id: null
        });
        return;
      }

      const transport = await initializeSession();
      session = { transport };
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error: unknown) {
    console.error('[rtm-mcp] HTTP transport error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error'
      },
      id: null
    });
  }
});

const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).send('Session not found');
    return;
  }

  await session.transport.handleRequest(req, res);
};

app.get('/mcp', handleSessionRequest);
app.delete('/mcp', handleSessionRequest);

const port = Number.parseInt(process.env.PORT || '3000', 10);

app
  .listen(port, () => {
    console.log(`[rtm-mcp] HTTP MCP server running on http://localhost:${port}/mcp`);
  })
  .on('error', error => {
    console.error('[rtm-mcp] Failed to start HTTP server:', error);
    process.exit(1);
  });
