# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts` bootstraps the MCP server and registers tools; add future handlers under `src/tools/` and import them into the entry point.
- `package.json` centralizes scripts plus dependency pins; modify scripts here rather than in ad-hoc shell snippets.
- `tsconfig.json` enforces strict ES2020 TypeScript builds; change compiler behavior in this file instead of per-module flags.
- Build output (`dist/`) stays untracked—run `npm run build` locally when compiled files are required.

## Build, Test, and Development Commands
- `npm install` — restores dependencies after cloning or lockfile updates.
- `npm run dev` — launches the stdio server through `ts-node` for live editing sessions.
- `npm run build` — emits production JavaScript in `dist/`.
- `npm start` — runs the compiled bundle; use this when wiring the server into MCP-aware tools.
- `npm run typecheck` — executes `tsc --noEmit`; use it as the minimum CI gate.

## Coding Style & Naming Conventions
- Stick to strict TypeScript with ES modules, two-space indenting, single quotes, and trailing commas on multiline literals to keep diffs tidy.
- Exported helpers should declare explicit return types, while internal functions can rely on inference.
- Tool identifiers stay kebab-case (`hello-world`), their `title` metadata uses Title Case, and descriptions should explain the observable outcome in under 100 characters.
- Keep comments purposeful—reserve them for protocol nuances or non-obvious transport behavior.

## Testing Guidelines
- A formal suite is not yet defined; when adding one, prefer Vitest or Jest and expose it via `npm test`.
- Name files with the `.test.ts` suffix beside the code under test (e.g., `src/tools/greet.test.ts`).
- Cover success, validation, and failure flows for every tool handler; mock transports sparingly so assertions stay close to observable output.
- Record manual validation steps in PRs until automation lands.

## Commit & Pull Request Guidelines
- Existing history is minimal, so follow Conventional Commits (`feat: add weather tool`) to prepare for automated changelogs.
- PR descriptions should include: motivation, summary of changes, commands executed (`npm run typecheck`, etc.), and any screenshots or transcripts relevant to MCP clients.
- Reference tracking issues and call out breaking changes in bold.
- Favor small, reviewable PRs; stack dependent work rather than combining unrelated features.
