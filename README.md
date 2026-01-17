# WebMCP - Remote MCP Server

Node.js MCP server with streamable HTTP and stdio transports.

## What's In This Repo

- **MCP server**: `/mcp` endpoint (streamable HTTP) and stdio transport (`--stdio`), entry point `server.js`.

## Quick Start (Local)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server (preferred for local iteration):
   ```bash
   npm run dev
   ```

The server defaults to port `5000` unless `PORT` is set.

## Endpoints

- `GET /health` -> `{ "status": "ok", "server": "webmcp-server" }`
- `POST /mcp` -> MCP JSON-RPC 2.0 (session header on `initialize`)

## Authentication (HTTP Only)

Set `USER_TOKEN` in the environment and include it on every HTTP request:

- `x-user-token: <token>` header, or
- `Authorization: Bearer <token>` header

Unauthorized requests return `{ "message": "user is not authenticated" }`.

### MCP Session Header

The streamable HTTP MCP transport sets `mcp-session-id` in the `initialize` response. Subsequent requests must include it as a request header.

## Tools

Tools are defined in `src/mcp.js`. Keep tool definitions in sync with handlers when adding new tools.

## Development

- `npm run dev` for auto-reload
- `npm start` for a basic server start
- Add `--rtm-debug` to log RTM API responses in pretty JSON.

## Deployment (Heroku)

This repo is already set up for Heroku (see `Procfile`).

```bash
heroku login
heroku create your-app-name
heroku config:set RTM_API_KEY=... RTM_SHARED_SECRET=... RTM_AUTH_TOKEN=...
git push heroku main
```

Your MCP endpoint will be:
```
https://your-app-name.herokuapp.com/mcp
```

RTM credentials should only be stored as Heroku config vars (or a local `.env` for development).

## License

ISC
