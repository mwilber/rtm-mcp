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

### `rtm-list-tasks`

List incomplete tasks, optionally filtered by due date or tag.

Parameters:
- `dueDate` (string, optional): Single due date filter (YYYY-MM-DD or natural language).
- `dueStart` (string, optional): Start of a due date range (YYYY-MM-DD).
- `dueEnd` (string, optional): End of a due date range (YYYY-MM-DD).
- `tag` (string, optional): Filter by a Remember The Milk tag.

### `rtm-add-task`

Create a task with optional due date, recurrence, priority, and tags.

Parameters:
- `name` (string, required): Task name.
- `dueDate` (string, optional): Natural language or ISO due date, e.g., "next Tuesday 5pm" or "2025-10-31".
- `repeats` (string, optional): Recurrence pattern such as "every week".
- `priority` (integer, optional): `1` (high), `2`, or `3`.
- `tags` (string[], optional): List of tags to apply.
- `mode` (string, optional): `smart` (default) or `explicit` for Smart Add vs explicit updates.

### `rtm-list-unwatched-movies`

List incomplete tasks tagged `movie` with no due date.

Parameters: none.

### `rtm-set-due-date`

Update a task's due date.

Parameters:
- `listId` (string, required): Task list identifier.
- `taskseriesId` (string, required): Task series identifier.
- `taskId` (string, required): Task identifier.
- `dueDate` (string, required): Natural language or ISO due date.

### `rtm-search-tasks`

Search task names, optionally filtered by tag. Defaults to incomplete tasks unless `includeCompleted` is true.

Parameters:
- `query` (string, required): Search text to match task names.
- `tag` (string, optional): Filter by a Remember The Milk tag.
- `includeCompleted` (boolean, optional): Return completed tasks as well.

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
