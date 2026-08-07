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

Anything non-deterministic — the clock, randomness — is a parameter too.
Without that, a test either asserts nothing useful or becomes flaky:

```ts
export function nextWorkspaceName(taken: readonly string[], random: Random = Math.random): string
```

Tests that need to name the value they expect pass a fixed source; the rest
assert on properties.

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

## Uniqueness has a scope

Before rejecting a value as a duplicate, ask **within what** it must be unique.
Getting this wrong has produced three separate bugs here, all with the same
shape: a name meaningful inside one project was checked against the whole app.

| Value              | Unique within                               |
| ------------------ | ------------------------------------------- |
| workspace `name`   | its project                                 |
| workspace `branch` | its project — branches live in a repository |
| workspace `id`     | the whole app — it is the IPC key           |
| directory path     | the filesystem                              |

Two projects are two repositories: `octopus/anna` in each is two different
branches, and treating that as a clash locks every project after the first out
of the start of the name pool.

## git is the source of truth, not our state

`state.json` holds only what git cannot know — the agent session, the port, the
label. Anything git knows, ask git.

A branch outlives the worktree it was created for: removal keeps it unless the
user asks otherwise. So a name free in our records may still be taken in the
repository, and `worktree add` will refuse. `takenByBranches` in `workspaces.ts`
exists for exactly this.

## A failed operation cleans up after itself

An operation that creates several things — a directory, a branch, a record —
must undo what it managed before failing. Debris left in git is invisible to
the app but blocks every later attempt, so one failure becomes permanent.

```ts
export async function rollbackWorkspace(workspace: Workspace, exec: GitExec): Promise<void>
```

Rollback is best-effort and never throws: it runs while another failure is
already being handled, and a second one must not replace the original.

## Errors

Never swallow them. If git fails, propagate stderr so the cause is visible in
the UI rather than a generic "something went wrong".

A `catch` is justified when the fallback is genuinely correct — not to make a
gap in coverage disappear. If the alternative is a clearer error one line
later, let it through instead.

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

Real git has already caught bugs no mock would have: a slug that destroyed
Cyrillic, paths git canonicalises (`/var` → `/private/var`, so a workspace read
as missing), and a branch left behind by an earlier removal.

**Never test against the user's real state or data root.** Point the service at
a temporary directory. Writing to `~/.octopus` while the app is running leaves
it acting on a stale in-memory copy — and a repro that corrupts what it is
diagnosing is worse than no repro.

Reproduce the reported bug as a test **before** fixing it. Each of the naming
bugs above now has one, and each would have caught its own regression.

Remember default parameters: to cover the default branch, call the function
both **with** and **without** the argument.

## Before finishing

```bash
npx vitest run --coverage
```

Coverage must stay at 100%. If it drops, add tests — never lower the threshold.
