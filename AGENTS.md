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
- Supported capabilities: listing tasks by due date and/or tag, and adding tasks with due dates, recurrence, priority, and tags.

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

## Implementation Notes
- RTM API requests require `api_sig = MD5(shared_secret + concat(sorted(key+value)))`.
- Write operations must include a `timeline`.
- Task identifiers include `list_id`, `taskseries_id`, and `task_id` from the add response.
