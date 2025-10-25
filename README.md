# rtm-mcp

Boilerplate Model Context Protocol (MCP) server that exposes a single `hello-world` tool. The server runs over stdio so it can be embedded in tools such as Claude Code, Cursor, or the MCP Inspector.

## Prerequisites
- Node.js 18+ (the MCP SDK, RTM client, and native `fetch` all require modern Node features)
- npm 8+

## Environment Variables
Create a `.env` with the Remember The Milk credentials the MCP tools should use:

```bash
RTM_API_KEY="YOUR_RTM_API_KEY"
RTM_SHARED_SECRET="YOUR_RTM_SHARED_SECRET"
RTM_AUTH_TOKEN="YOUR_RTM_AUTH_TOKEN"
```

### Direnv workflow

This repo ships with a `.envrc` that loads `.env` automatically via [direnv](https://direnv.net/):

```bash
brew install direnv              # or your package manager
direnv allow                     # trust the .envrc in this repo
```

From then on, every shell you open inside the repo receives the RTM credentials without manual exports. When using MCP Inspector (or other stdio clients), launch them from the same direnv-enabled shell so they inherit the vars.

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
