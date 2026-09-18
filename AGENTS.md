# AGENTS.md

OpenWork is a free, open-source desktop app (macOS, Windows, Linux) for doing
work with AI agents on your own files — an open-source alternative to Claude
Cowork and Codex, built on OpenCode, running any model from 50+ providers.
Desktop mode keeps files local; cloud is optional. Three surfaces live in this
repo:

* **Desktop app** (`apps/`, `packages/`) — local-first agent workspace: chat on
  files, skills, browser automation, scheduled automations, Anthropic-compatible
  plugins.
* **OpenWork MCP gateway** (`ee/apps/den-api`) — one URL
  (`api.openworklabs.com/mcp/agent`) that brings org-assigned skills, plugins,
  and connections (Google Workspace, Microsoft 365, MCPs) into Codex, Claude
  Code, Cursor, or any MCP client via `search_capabilities` /
  `execute_capability`.
* **OpenWork Den** (`ee/apps/den-*`) — the org control plane: provision
  inference, manage teams and access, set desktop policies, publish skills and
  plugins through marketplaces.

The app consumes OpenWork server surfaces (self-hosted or hosted) rather than
inventing parallel behavior. Anything OpenCode can do is available in OpenWork,
even before a dedicated UI exists.

## Confidentiality (hard rule — this repo is public)

Never let a branch name, commit, PR text, comment, fixture, or evidence identify
a customer, prospect, partner, or outside person; use internal ticket IDs, and
escalate any leak instead of rewriting history.

## Development workflow (this environment)

* Default branch is `dev`; there is no `main`. Keep personal work on a dedicated
  integration branch derived from `dev` and never commit directly to `origin`.
* `origin` is read-only for this setup. Push your integration branch to a
  personal fork remote instead; sync by merging `origin/dev` into the branch
  (never the reverse) and force-pushing nothing.
* Build prerequisites: pnpm workspace (`pnpm install` at root). `apps/server`
  builds with `bun` (`pnpm dev` fails without it). The evals harness requires
  Node 24 (`AsyncDisposableStack`); see `.nvmrc`.
* Desktop AppImage lifecycle: swap or roll back the Linux binary with
  `scripts/openwork-swap.sh` (`backup` / `install` / `restore` / `list` /
  `prune`). `install` and `restore` gracefully close any running OpenWork
  first (SIGTERM, then SIGKILL after 15s) and normalize the binary to a
  stable `openwork.AppImage` in `~/Applications` (via `OPENWORK_APPIMAGE`),
  so the KDE `.desktop` entry (`com.differentai.openwork`) can point at a
  fixed path.
* Desktop user data lives in Electron's `userData` dir (keyed by appId
  `com.differentai.openwork`), never inside the AppImage — replacing the binary
  preserves workspaces, chats, and tokens, but match data schema versions before
  mixing an older build with newer data.

## Coding

* pnpm only, never npm/yarn. TypeScript: never `any`, typecasts, or `as` unless
  100% necessary or instructed.
* Prefer Tailwind, React, shadcn/ui (Base UI), TanStack Query, Zustand, Zod,
  Drizzle, Better-Auth. Reuse `@/components`; end users are non-technical.
* Any user-facing UI (desktop app, Den web, MCP Apps, artifact views) follows
  `DESIGN.md`: read it before designing, cite its rule ids in PRs, and attach
  screenshots of new UI. Warden's `design-spec-review` warns on violations.

