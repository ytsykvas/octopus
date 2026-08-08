# The core

`src/core` holds every decision the application makes. It imports no Electron
and touches no DOM, so it is tested without launching anything — and could be
lifted into a CLI or a daemon without rewriting.

Coverage here is 100%, enforced. That is the floor, not the goal: see
[testing.md](testing.md) for why a fully covered function can still be untested.

## The modules

### Pure, safe to import from the renderer

Nothing but zod behind them, so a **value** can cross into the window.

| Module                                   | What it decides                                          |
| ---------------------------------------- | -------------------------------------------------------- |
| [`branches.ts`](../src/core/branches.ts) | how a branch name is shown — `origin/` is noise          |
| [`colors.ts`](../src/core/colors.ts)     | the project palette, and which colour a new project gets |
| [`initials.ts`](../src/core/initials.ts) | the two characters on a project tab                      |
| [`names.ts`](../src/core/names.ts)       | workspace names, drawn at random from 256                |
| [`types.ts`](../src/core/types.ts)       | shared identifiers                                       |

### Storage

| Module                                 | What it decides                                 |
| -------------------------------------- | ----------------------------------------------- |
| [`paths.ts`](../src/core/paths.ts)     | every path under `~/.octopus`, in one place     |
| [`persist.ts`](../src/core/persist.ts) | atomic writes, validated reads, honest failures |
| [`config.ts`](../src/core/config.ts)   | settings and their bounds                       |
| [`store.ts`](../src/core/store.ts)     | projects and workspaces, and the migrations     |

### git

| Module                                       | What it decides                                     |
| -------------------------------------------- | --------------------------------------------------- |
| [`git.ts`](../src/core/git.ts)               | running git safely; slugs; which branch is the base |
| [`worktree.ts`](../src/core/worktree.ts)     | worktrees and branches, and parsing what git prints |
| [`workspaces.ts`](../src/core/workspaces.ts) | the workspace lifecycle and reconciliation          |
| [`projects.ts`](../src/core/projects.ts)     | whether a directory can be a project                |

### External tools and processes

| Module                                           | What it decides                                      |
| ------------------------------------------------ | ---------------------------------------------------- |
| [`github.ts`](../src/core/github.ts)             | listing and cloning through the `gh` CLI             |
| [`accounts.ts`](../src/core/accounts.ts)         | whether `claude` and `gh` are signed in              |
| [`terminal.ts`](../src/core/terminal.ts)         | what a pty should run, where, with which environment |
| [`scripts.ts`](../src/core/scripts.ts)           | `setup.sh` and `run.sh`                              |
| [`instructions.ts`](../src/core/instructions.ts) | prose handed to the agent                            |

### The façade

[`service.ts`](../src/core/service.ts) is the single entry point. It holds state
in memory, persists after every change, and exists so that `main/` can be a
proxy — an IPC handler should only have to forward the call.

## How a module is written

**Dependencies are parameters with defaults.** This is what makes the layer
testable without mocking modules.

```ts
export function rootDir(home: string = homedir()): string
export async function listWorktrees(exec: GitExec): Promise<Worktree[]>
export function nextWorkspaceName(taken: readonly string[], random: Random = Math.random): string
```

The clock and randomness are parameters too. Without that, a test either asserts
nothing useful or becomes flaky.

**Parsing is separate from running.** `parseWorktrees` takes a string, so it can
be tested against output no real repository would produce — a bare worktree, a
locked one, CRLF line endings.

**Failures carry a code.** `ProjectValidationError`, `WorkspaceError` and
`GitHubError` each hold a machine-readable `code` the UI turns into a localised
message. The English text on the error is a fallback for logs.

## The invariants

These are the rules that have been broken, each costing a bug.

### Uniqueness has a scope

Before rejecting a duplicate, ask what it is unique **within**. A workspace name
and its branch are unique per project; the id is unique across the app. See the
table in [data.md](data.md).

### git is asked about git

A branch outlives the worktree it was made for — removal keeps it unless asked
otherwise. So a name free in `state.json` may still be taken in the repository,
and `worktree add` will refuse. `takenByBranches` in `workspaces.ts` exists for
exactly this.

### An operation that fails cleans up after itself

Creating a workspace makes a directory, a branch and a record. If the record
cannot be written, `rollbackWorkspace` undoes the first two. Debris left in git
is invisible to the app but still holds its name, so one failure would otherwise
become permanent.

Rollback is best-effort and never throws: it runs while another failure is being
handled, and a second must not replace the first.

### An update applies every field it carries

`updateProject` lists fields explicitly, which protects against writing back a
stale value — and silently drops any field added to the type but not to the
update. That is why the colour picker did nothing for a while. A test per field
is the only thing that catches it.

### Errors are not swallowed

If git fails, stderr reaches the user. A `catch` is justified when the fallback
is genuinely correct — not to make a coverage gap disappear. If the alternative
is a clearer error one line later, let it through.
