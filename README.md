# RTM MCP Server

Node.js MCP server with streamable HTTP and stdio transports.

## What's In This Repo

- **MCP server**: `/mcp` endpoint (streamable HTTP) and stdio transport (`--stdio`), entry point `server.js`.

## Quick Start (Local)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a local `.env` from `.env.example` and fill in the RTM credentials plus `USER_TOKEN`.

3. Start the server (preferred for local iteration):
   ```bash
   npm run dev
   ```

The server defaults to port `5000` unless `PORT` is set.

## Endpoints

- `GET /health` -> `{ "status": "ok", "server": "rtm-mcp" }`
- `POST /mcp` -> MCP JSON-RPC 2.0 (session header on `initialize`)

## Authentication (HTTP Only)

Set `USER_TOKEN` in the environment and include it on every HTTP MCP request:

- `x-user-token: <token>` header, or
- `Authorization: Bearer <token>` header

Unauthorized requests return `{ "message": "user is not authenticated" }`.
The landing page and `/health` endpoint are public.

### MCP Session Header

The streamable HTTP MCP transport sets `mcp-session-id` in the `initialize` response. Subsequent requests must include it as a request header.

## Tools

Tools are defined in `src/mcp.js`. Keep tool definitions in sync with handlers when adding new tools.

### Calendar helpers

- `rtm-get-date-context`: Current local date, weekday, timezone, and period boundaries.
- `rtm-list-holidays`: Discover known nationwide US holidays and observances with actual/observed dates.
- `rtm-resolve-date`: Resolve structured offsets, weekday relations, weekends, period boundaries, and business days into exact dates or inclusive ranges.

Set `CALENDAR_TIME_ZONE` to your RTM account's IANA timezone (default `UTC`) and
`CALENDARIFIC_API_KEY` for holiday lookups. Ordinary date calculations work without
the holiday service or RTM credentials. Set `CALENDARIFIC_ENABLED=false` to disable
the provider, including after a permanent shutdown.

Calendarific failures return structured retry guidance and block repeat network
requests across MCP sessions. Prolonged failures suspend the provider until operator
intervention; stale cached dates are explicitly labeled.

See [Calendar helper inputs, examples, and failure handling](docs/calendar-tools.md).

### `rtm-list-tasks`

List incomplete tasks, optionally filtered by due date or tag.

Each result includes a composite `id` with `list`, `series`, and `task` values. Pass
that object unchanged to `rtm-update-task` or `rtm-add-task-note`.

Parameters:
- `dueDate` (string, optional): Single due date filter (YYYY-MM-DD or natural language).
- `dueStart` (string, optional): Start of a due date range (YYYY-MM-DD).
- `dueEnd` (string, optional): End of a due date range (YYYY-MM-DD).
- `tag` (string, optional): Filter by a Remember The Milk tag.

### `rtm-add-task`

Create a task with optional due date, recurrence, priority, and tags. The result
includes a composite `id` suitable for follow-up updates and notes.

Parameters:
- `name` (string, required): Task name.
- `dueDate` (string, optional): Natural language or ISO due date, e.g., "tomorrow", "never", or "2027-10-31". Defaults to `today`; supplied parseable dates outside today through two years ahead are rejected before any RTM write. Use the calendar helpers to resolve vague dates first.
- `repeats` (string, optional): Recurrence pattern such as "every week".
- `priority` (integer, optional): `1` (high), `2`, or `3`.
- `tags` (string[], optional): List of tags to apply.
- `mode` (string, optional): `smart` (default) or `explicit` for Smart Add vs explicit updates.

### `rtm-update-task`

Update one or more values on an existing task. Only supplied fields are changed.

Parameters:
- `id` (object, required): The composite `{ list, series, task }` ID returned by the add, list, or search tool.
- `name` (string, optional): Replacement task name.
- `dueDate` (string, optional): Replacement natural-language or ISO due date. An empty string clears it.
- `repeats` (string, optional): Replacement recurrence. An empty string clears it.
- `priority` (integer or null, optional): `1`, `2`, or `3`; `null` clears priority.
- `tags` (string[], optional): Complete replacement tag list. An empty array removes all tags.

Replacing or clearing tags uses `rtm.tasks.setTags`, which requires an RTM token
with `delete` permission.

### `rtm-add-task-note`

Add a note through RTM's separate notes API.

Parameters:
- `id` (object, required): The composite `{ list, series, task }` task ID.
- `title` (string, optional): Note title. Defaults to `AI Generated Note`.
- `text` (string, required): Note body.

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
Each result includes the same composite `id` accepted by the update and add-note tools.

Parameters:
- `query` (string, required): Search text to match task names.
- `tag` (string, optional): Filter by a Remember The Milk tag.
- `includeCompleted` (boolean, optional): Return completed tasks as well.

## Development

- `npm run dev` for auto-reload
- `npm start` for a basic server start
- `node server.js --stdio` for stdio transport
- `npm test` for the Node test suite
- Add `--rtm-debug` to log RTM API responses in pretty JSON.

## Deployment (Heroku)

This repo is already set up for Heroku (see `Procfile`).

```bash
heroku login
heroku create your-app-name
heroku config:set RTM_API_KEY=... RTM_SHARED_SECRET=... RTM_AUTH_TOKEN=... USER_TOKEN=...
heroku config:set CALENDAR_TIME_ZONE=America/New_York CALENDARIFIC_API_KEY=REPLACE_WITH_CALENDARIFIC_API_KEY CALENDARIFIC_ENABLED=false
git push heroku HEAD:master
```

Your MCP endpoint will be:
```
https://your-app-name.herokuapp.com/mcp
```

RTM credentials should only be stored as Heroku config vars (or a local `.env` for development).

The Heroku calendar settings include a placeholder key with holiday lookups disabled.
Replace `CALENDARIFIC_API_KEY` with a real key and set `CALENDARIFIC_ENABLED=true`
to enable holiday lookups. Calendar calculations that do not use holidays work
while the provider is disabled.

## License

ISC
