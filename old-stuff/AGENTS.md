# Repository Guidelines

## Project Structure & Module Organization
- `src/server.ts` builds and configures the `McpServer`, registers tools, and is shared by both transports.
- `src/index.ts` hosts the stdio entry point; `src/http-server.ts` exposes the streamable HTTP transport.
- `package.json` centralizes scripts plus dependency pins; modify scripts here rather than in ad-hoc shell snippets.
- `tsconfig.json` enforces strict ES2020 TypeScript builds; change compiler behavior in this file instead of per-module flags.
- `src/rtm-client.js` houses the Remember The Milk REST helper; keep it framework-agnostic and avoid MCP-specific logic inside.
- Build output (`dist/`) stays untracked—run `npm run build` locally when compiled files are required.

## Build, Test, and Development Commands
- `npm install` — restores dependencies after cloning or lockfile updates.
- `npm run dev` — launches the stdio server through `ts-node`.
- `npm run dev:http` — starts the HTTP transport at `http://localhost:3000/mcp` (set `PORT` to override).
- `npm run build` — emits production JavaScript in `dist/`.
- `npm start` / `npm run start:http` — run the compiled stdio/HTTP servers respectively.
- `npm run typecheck` — executes `tsc --noEmit`; use it as the minimum CI gate.

## Coding Style & Naming Conventions
- Stick to strict TypeScript with ES modules, two-space indenting, single quotes, and trailing commas on multiline literals to keep diffs tidy.
- Exported helpers should declare explicit return types, while internal functions can rely on inference.
- Tool identifiers stay kebab-case (`rtm-list-tasks`), their `title` metadata uses Title Case, and descriptions should explain the observable outcome in under 100 characters.
- Keep comments purposeful—reserve them for protocol nuances or non-obvious transport behavior.

## Testing Guidelines
- A formal suite is not yet defined; when adding one, prefer Vitest or Jest and expose it via `npm test`.
- Name files with the `.test.ts` suffix beside the code under test (e.g., `src/tools/greet.test.ts`).
- Cover success, validation, and failure flows for every tool handler; mock transports sparingly so assertions stay close to observable output.
- Record manual validation steps in PRs until automation lands.

## Security & Configuration Tips
- RTM tools require `RTM_API_KEY`, `RTM_SHARED_SECRET`, and `RTM_AUTH_TOKEN` at runtime; populate `.env` with placeholders and let `dotenv` (imported in `src/index.ts`) load them automatically, but never commit real values to source control.
- When touching `src/rtm-client.js`, be mindful that it relies on the global `fetch` API available in Node 18+; add polyfills only if you keep the dependency lightweight.
- Validate that stdio-based clients inherit the correct environment by launching them from the same shell session used to export credentials.
- Prefer local `.env` files that stay gitignored (or use `direnv`) to avoid leaking tokens in scripts.

## Commit & Pull Request Guidelines
- Existing history is minimal, so follow Conventional Commits (`feat: add weather tool`) to prepare for automated changelogs.
- PR descriptions should include: motivation, summary of changes, commands executed (`npm run typecheck`, etc.), and any screenshots or transcripts relevant to MCP clients.
- Reference tracking issues and call out breaking changes in bold.
- Favor small, reviewable PRs; stack dependent work rather than combining unrelated features.


# Remember The Milk API

## Overview

This agent enables interaction with the [Remember The Milk API](https://www.rememberthemilk.com/services/api/) for task management.

It supports:

* Listing tasks by due date and/or tag.
* Adding tasks (with due date, recurrence, priority, and tags).
* Configurable authentication via environment variables.

---

## Prerequisites

### API Credentials

1. Visit [RTM Developer Keys](https://www.rememberthemilk.com/services/api/keys.rtm).
2. Create a new API key and note:

   * **API Key** → `RTM_API_KEY`
   * **Shared Secret** → `RTM_SHARED_SECRET`

### Authentication Token

RTM uses a three-step authentication flow:

1. **Get a frob:**

   ```bash
   curl "https://api.rememberthemilk.com/services/rest/?method=rtm.auth.getFrob&api_key=YOUR_API_KEY&api_sig=MD5_SIGNATURE&format=json"
   ```

2. **Authorize the app:**
   Open this URL in your browser (replace placeholders):

   ```
   https://www.rememberthemilk.com/services/auth/?api_key=YOUR_API_KEY&perms=write&frob=THE_FROB&api_sig=MD5_SIGNATURE
   ```

3. **Exchange the frob for a token:**

   ```bash
   curl "https://api.rememberthemilk.com/services/rest/?method=rtm.auth.getToken&api_key=YOUR_API_KEY&frob=THE_FROB&api_sig=MD5_SIGNATURE&format=json"
   ```

   Copy the returned token as your `RTM_AUTH_TOKEN`.

### Environment Variables

Create a `.env` file:

```bash
RTM_API_KEY=your_api_key_here
RTM_SHARED_SECRET=your_shared_secret_here
RTM_AUTH_TOKEN=your_auth_token_here
```

Install `dotenv`:

```bash
npm install dotenv
```

---

## Agent Capabilities

### Function: `listTasks`

**Purpose:** Fetch tasks filtered by due date and/or tag.

**Parameters:**

* `dueDate` — a single date string (e.g., `"2025-10-31"`) or an object `{start, end}`.
* `tag` — string tag filter.

**Return:**
List of task objects with fields:

```json
{
  "id": { "list": "string", "series": "string", "task": "string" },
  "name": "string",
  "due": "string|null",
  "priority": 1,
  "tags": ["string"]
}
```

**Implementation Notes:**

* Uses `rtm.tasks.getList` with a constructed `filter` parameter.
* Filter examples:

  * `due:2025-10-31`
  * `(dueAfter:2025-10-01 AND dueBefore:2025-10-31) AND tag:marketing`
* Supports `dueWithin:` and `tag:` syntax from RTM Advanced Search.

### Function: `addTask`

**Purpose:** Add a task with full attribute support.

**Parameters:**

* `name` — required task name.
* `dueDate` — optional, `YYYY-MM-DD` or natural text.
* `repeats` — recurrence string (`every week`, `after 2 days`).
* `priority` — 1, 2, or 3.
* `tags` — array of strings.
* `mode` — `"smart"` (default) or `"explicit"`.

**Return:**

```json
{ "success": true, "id": { "list": "string", "series": "string", "task": "string" } }
```

**Behavior:**

* Uses a `timeline` from `rtm.timelines.create`.
* Smart mode: Single call via `rtm.tasks.add` with `parse=1`.

  * Smart Add tokens:

    * `^` = due date
    * `*` = repeat rule
    * `!` = priority
    * `#` = tags
  * Example: `"Submit report ^tomorrow 9am *every week !2 #work #reports"`
* Explicit mode: Performs multiple API calls:

  1. `rtm.tasks.add`
  2. `rtm.tasks.setDueDate`
  3. `rtm.tasks.setRecurrence`
  4. `rtm.tasks.setPriority`
  5. `rtm.tasks.addTags`

---

## Internal Implementation Details

### API Signing

Every request includes `api_sig = MD5(shared_secret + concat(sorted(key+value)))`.

### Timeline Management

* Required for all write operations.
* Created via `rtm.timelines.create`.
* Can be reused across multiple writes.

### Task Path Structure

Most write methods require:

* `list_id`
* `taskseries_id`
* `task_id`

Extracted from the first successful `rtm.tasks.add` response.

### Smart Add vs Explicit Calls

* Smart Add is faster and cleaner but less precise.
* Explicit mode ensures each field is applied deterministically.

---

## Example Usage

```javascript
import "dotenv/config";
import { RTMClient } from "./rtm-client.js";

const rtm = new RTMClient({
  apiKey: process.env.RTM_API_KEY,
  sharedSecret: process.env.RTM_SHARED_SECRET,
  authToken: process.env.RTM_AUTH_TOKEN,
});

(async () => {
  await rtm.addTask({
    name: "Launch blog",
    dueDate: "2025-10-31 17:00",
    repeats: "every week",
    priority: 1,
    tags: ["marketing", "q4"],
  });

  const tasks = await rtm.listTasks({
    dueDate: { start: "2025-10-01", end: "2025-10-31" },
    tag: "marketing",
  });

  console.log(tasks);
})();
```

---

## Error Handling

* Invalid or missing permissions → ensure token perms = `write`.
* Smart Add parsing errors → verify `name` contains base text.
* Response shape mismatches → handled by a robust extractor fallback.

---

## Recommended Enhancements

* Add retry logic for transient network errors.
* Support task notes via `rtm.tasks.notes.add`.
* Expose `getLists()` helper using `rtm.lists.getList`.
* Optional TypeScript type definitions for strong typing.

---

**Author:** Matt Wilber
**Agent Version:** 1.0
**Last Updated:** 2025-10-24
