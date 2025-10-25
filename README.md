# rtm-mcp

Boilerplate Model Context Protocol (MCP) server that exposes a single `hello-world` tool. The server runs over stdio so it can be embedded in tools such as Claude Code, Cursor, or the MCP Inspector.

## Prerequisites
- Node.js 18+ (the MCP SDK and its transitive dependencies require modern Node features)
- npm 8+

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
`build` compiles TypeScript to `dist/`, and `start` launches the compiled server over stdio.

## Tooling
The `hello-world` tool accepts an optional `name` argument and responds with a plain-text greeting plus structured JSON output for downstream automation.

```json
{
  "name": "hello-world",
  "input": { "name": "Ada" }
}
```

Response example:
```json
{
  "greeting": "Hello, Ada!"
}
```

Use this repository as a starting point for additional MCP resources, prompts, or tools.
