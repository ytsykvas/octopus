---
name: core-module
description: Creating or changing a module in src/core — headless logic with mandatory 100% test coverage. Use when touching any file under src/core, adding git operations, filesystem work, on-disk state or external processes.
when_to_use: When logic in src/core needs to be added or changed, tests written for it, or when the question "where should this function live" comes up.
paths:
  - src/core/**
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npx vitest:*), Bash(npm test:*), Bash(npm run typecheck:*)
---

# Core module

`src/core/` holds all application logic. It is headless: no Electron imports,
no knowledge of the UI. That is what makes it testable without launching the
app and extractable into a CLI or daemon later (§11.1 docs/PROJECT.md).

## Non-negotiables

**Everything is written in English** — code, comments, test names, error
messages. See the language policy in `CLAUDE.md`.

**100% coverage.** The threshold lives in `vitest.config.ts` and fails the
build when it drops. This is not aspirational: the test is written with the
code, not "later".

**No `electron`.** Importing it under `src/core/` is blocked by a hook. If
logic needs a window, dialog or menu, it belongs in `src/main/`, and the core
keeps a pure function behind a typed interface.

**No `any`.** For genuinely unknown data use `unknown` and narrow it with zod.

## Writing a testable module

The key technique: **dependencies are parameters with sensible defaults**.
This removes the need to mock the filesystem and makes coverage trivial.

```ts
// Good: testable without mocks
export function rootDir(home: string = homedir()): string {
  return join(home, '.octopus')
}

// Bad: testing this means mocking a whole module
export function rootDir(): string {
  return join(os.homedir(), '.octopus')
}
```

The same applies to processes and the filesystem: take the executor as a
parameter.

```ts
type Exec = (args: readonly string[]) => Promise<string>

export async function listWorktrees(exec: Exec): Promise<Worktree[]> {
  return parseWorktrees(await exec(['worktree', 'list', '--porcelain']))
}
```

Keep the parser (`parseWorktrees`) a separate pure function — it can then be
tested on strings without any git at all.

## External processes

Only `execFile`, **never `exec`**. Branch names and paths come from the user,
and `exec` hands them to a shell — that is command injection.

**Validate anything arriving over IPC at runtime.** Types vanish at the process
boundary: a buggy or compromised renderer can send any value, and this app
renders agent output, so that boundary is a real attack surface. Parse with zod
before the value reaches a process argument, a path or a script — and never
interpolate it into a shell command or AppleScript source; pass it as an
argument instead.

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const { stdout } = await run('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'])
```

## External data

Anything arriving from disk, git or the SDK is validated with zod **at the
boundary**. Past that point it is typed.

```ts
const WorkspaceSchema = z.object({
  id: z.string(),
  port: z.number().int().min(3000).max(9000)
})

// The type is derived from the schema, so they cannot drift apart
export type Workspace = z.infer<typeof WorkspaceSchema>
```

## Errors

Never swallow them. If git fails, propagate stderr so the cause is visible in
the UI rather than a generic "something went wrong".

For failures the user can act on, throw a typed error carrying a
machine-readable `code` — the renderer turns that into a localised message
(see `ProjectValidationError` in `projects.ts`).

## Test shape

`describe` names the module or function; `it` names the **scenario**, not the
method.

```ts
describe('createWorkspace', () => {
  it('creates a branch using the prefix from config', async () => { ... })
  it('refuses when the branch already exists', async () => { ... })
  it('propagates stderr from git instead of swallowing it', async () => { ... })
})
```

Prefer driving **real** git in a temporary repository over mocking it: parsing
git output is where assumptions turn out wrong. Use a fake executor for edge
cases that real git will not produce.

Remember default parameters: to cover the default branch, call the function
both **with** and **without** the argument.

## Before finishing

```bash
npx vitest run --coverage
```

Coverage must stay at 100%. If it drops, add tests — never lower the threshold.
