---
name: core-module
description: Creating or changing a module in src/core — headless logic with mandatory 100% test coverage. Use when touching any file under src/core, adding git operations, filesystem work, on-disk state or external processes.
when_to_use: When logic in src/core needs to be added or changed, tests written for it, or when the question "where should this function live" comes up.
paths:
  - src/core/**
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npx vitest:*), Bash(npm test:*), Bash(npm run typecheck:*)
---

# Core module

The invariants are in `.Codex/rules/core.md`; this is how to meet them.
`src/core/` is headless — no Electron, no DOM — which is what makes it
testable without launching the app and extractable into a CLI or daemon later
(§11.1 docs/PROJECT.md).

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

**Apply every field a patch carries.** An update that lists fields explicitly —
`...(name !== undefined && { name })` — protects against writing back stale
values, and pays for it by failing silently when a new field is added to the
type but not to the update. The colour picker looked inert for exactly this
reason: the value crossed IPC, passed validation, and was dropped on the last
line. A test per field is the only thing that catches it.

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
Getting this wrong keeps producing bugs here, and they run both ways: a name
meaningful inside one project checked against the whole app, and a name the
agent treats as global checked inside one directory.

| Value              | Unique within                                                                      |
| ------------------ | ---------------------------------------------------------------------------------- |
| workspace `name`   | its project                                                                        |
| workspace `slug`   | its project — it names a database, and is **not** injective                        |
| workspace `branch` | its project — branches live in a repository                                        |
| workspace `id`     | the whole app — it is the IPC key                                                  |
| skill `name`       | everything the agent can see — both stores, and the checkout's own `.Codex/skills` |
| skill folder       | its store — it is a directory, and the app addresses a skill by it                 |
| directory path     | the filesystem                                                                     |

The skill rows are the pair worth reading together. `skillKey` is the bare name
because the CLI dedupes on it — two skills sharing one are one skill to the
agent — so the name is unique app-wide, while the folder is only unique inside
its store and is what a read or a write is addressed by. Checking the name
inside one store let a global `review` and a project `review` both exist, after
which the switch on either row moved both.

Two projects are two repositories: `octopus/anna` in each is two different
branches, and treating that as a clash locks every project after the first out
of the start of the name pool.

## Worked examples of three rules

- **git is the source of truth.** A branch outlives the worktree it was made
  for, so a name free in `state.json` may still be taken in the repository —
  `takenByBranches` in `workspaces.ts` asks git before `worktree add` refuses.
- **A failed operation cleans up.** `rollbackWorkspace` in `workspaces.ts`
  undoes the directory, the branch and the record, is best-effort and never
  throws: it runs while another failure is already being handled.
- **Errors carry a `code`.** `ProjectValidationError` in `projects.ts` is the
  shape; the renderer maps the code to a localised message. A `catch` is
  justified only when the fallback is genuinely correct, never to make a gap
  in coverage disappear.

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

## 100% coverage is not the same as tested

Every line in `src/core/` is executed by a test, and that has never been the
question. What it does not tell you is whether the test put the system into a
state the real world produces.

The worked example: a workspace whose directory was deleted by hand kept
reporting as healthy. `reconcile` compared paths, and git — which keeps listing
such a worktree, flagged `prunable` — said the path was there. The test passed
because it **filtered the worktree out of the list itself**, modelling a
situation git never creates. Both were at 100%.

So when a function reads external output, ask what that output actually looks
like in the awkward case, and go and get it:

```bash
git worktree list --porcelain   # after rm -rf on the worktree
```

Then assert against that. The probes worth keeping from the last audit:

| Ask                                       | Because                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| what does a hostile name become           | `toSlug` output goes straight into `git branch`, which rejects `.lock`, `..`, leading `-`, `@{`, control characters |
| what happens on collision                 | the pool is twenty blocks, and the port a probe finds free can be taken by the time a server binds                  |
| what does a half-written file look like   | a crash between temp-write and rename leaves the temp behind                                                        |
| what does the tool print on a stale entry | `prunable`, `locked` and `bare` lines the parser had never seen                                                     |

Remember default parameters: to cover the default branch, call the function
both **with** and **without** the argument.

## Before finishing

```bash
npx vitest run --coverage
```

Coverage must stay at 100%. If it drops, add tests — never lower the threshold.
