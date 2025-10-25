# rtm-mcp

Boilerplate Model Context Protocol (MCP) server that exposes a single `hello-world` tool. The server runs over stdio so it can be embedded in tools such as Claude Code, Cursor, or the MCP Inspector.

## Prerequisites
- Node.js 18+ (the MCP SDK, RTM client, and native `fetch` all require modern Node features)
- npm 8+

## Environment Variables
Create a `.env` (or export values in your shell) with the Remember The Milk credentials the MCP tools should use:

```bash
export RTM_API_KEY="<your api key>"
export RTM_SHARED_SECRET="<your shared secret>"
export RTM_AUTH_TOKEN="<per-user auth token>"
```

The server loads these variables at runtime; both the Inspector and `npm run dev` inherit whatever is set in the current shell.

## Setup
```bash
npm install
```

## Development
```bash
npm run dev
```
Runs the server with `ts-node` so edits in `src/` take effect immediately.

## Build & Run
```bash
npm run build
npm start
```
`build` compiles TypeScript (and the RTM client JS helper) to `dist/`, and `start` launches the compiled server over stdio.

## Tools
| Tool ID | Purpose | Key Arguments |
| --- | --- | --- |
| `hello-world` | Returns a friendly greeting, optionally personalized. | `name` (optional) |
| `rtm-list-tasks` | Lists Remember The Milk tasks filtered by due date or tag. | `dueDate`, `dueStart`, `dueEnd`, `tag` |
| `rtm-add-task` | Creates an RTM task with optional due date, recurrence, priority, and tags. | `name` (required), `dueDate`, `repeats`, `priority`, `tags`, `mode` |

Example prompts:

```json
{
  "name": "rtm-list-tasks",
  "input": { "tag": "inbox" }
}
```

```json
{
  "name": "rtm-add-task",
  "input": {
    "name": "Draft Q2 roadmap",
    "dueDate": "next Friday 5pm",
    "tags": ["product", "q2"]
  }
}
```
