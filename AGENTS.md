# AGENTS

## Project Context
- Node.js MCP server with HTTP and stdio transports.
- Main entry point: `server.js`.
- MCP endpoint is mounted at `/mcp`.

## Development Notes
- Prefer `npm run dev` for local iteration.
- Keep tool definitions and handlers in sync when adding new tools.

## Git Commit Messages
- Format:
  - First line: one sentence summary.
  - Then a bullet list of each change.
  - Keep bullets concise and high level.
  - Group similar changes into a single bullet.

# Remember The Milk API

## Overview
- This server integrates the Remember The Milk API for task management.
- Supported capabilities: listing and searching tasks, adding tasks, updating task names, due dates, recurrence, priority, and tags, and adding task notes.

## Credentials & Environment
- Required environment variables: `RTM_API_KEY`, `RTM_SHARED_SECRET`, `RTM_AUTH_TOKEN`.
- RTM auth token is created via the RTM frob flow; see https://www.rememberthemilk.com/services/api/ for details.
- Keep credentials in `.env` (gitignored) for local development.

## Tool Behaviors
### `listTasks`
- Filters by `dueDate` (single date or `{ start, end }`) and/or `tag`.
- Uses `rtm.tasks.getList` with the RTM advanced search filter syntax.

### `addTask`
- Adds a task with `name`, `dueDate`, `repeats`, `priority`, and `tags`.
- Uses `rtm.timelines.create` then `rtm.tasks.add`.
- Supports smart add via `parse=1`, or explicit follow-up calls for each attribute.
- Returns the composite `{ list, series, task }` ID used by follow-up edits.

### `updateTask`
- Accepts the composite task ID returned by list, search, and add operations.
- Updates only supplied values through the corresponding RTM task mutation methods.
- Empty due date and recurrence values, a null priority, and an empty tag list clear those values.

### `addTaskNote`
- Adds notes through the separate `rtm.tasks.notes.add` API method.

## Implementation Notes
- RTM API requests require `api_sig = MD5(shared_secret + concat(sorted(key+value)))`.
- Write operations must include a `timeline`.
- Task identifiers include `list_id`, `taskseries_id`, and `task_id` from the add response.
