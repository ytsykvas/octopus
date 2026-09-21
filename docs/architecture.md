# Architecture

## Why there are four layers

Electron gives you two processes and a bridge, and it is tempting to treat that
as the whole design. It is not enough here: the interesting logic — git
worktrees, on-disk state, external CLIs — has nothing to do with Electron, and
tying it to Electron would mean it could only run inside a window.

So there are four:

```
src/core/      logic. No Electron, no DOM. Tested in isolation.
src/main/      Electron: window, menu, IPC table, pseudo-terminals.
src/preload/   the bridge. Channel names and types, no logic.
src/renderer/  the interface.
```

## The rules, and what happens when they break

### `core/` must not import `electron`

Enforced by an ESLint rule (`no-restricted-imports` in `eslint.config.js`), so `npm run check` — and CI — fails on it.

Without it the core could not be tested without launching an application, and
`npm test` would need a display. It also keeps the door open to a CLI or a
daemon later — the same reason the layer exists at all.

If a core operation needs a window, a dialog or a menu, the decision stays in
core as a pure function and `main/` supplies the Electron part. `main/ipc.ts`
is the worked example: it takes `IpcHost` — a named set of functions — rather
than importing `ipcMain`, `dialog`, `BrowserWindow` and `nativeTheme`.

### The renderer may import types from core, but values only from safe modules

Types vanish at build time, so `import type { Project } from '@core/store.js'`
costs nothing. A **value** brings the module with it, and most core modules
reach Node: `store.ts` → `paths.ts` → `node:os`.

This has broken the app once. Importing `PROJECT_COLORS` from `store.ts` passed
type checking, linting and every test, then failed at runtime with _"Module
node:os has been externalized for browser compatibility"_ — because Vite
externalises Node built-ins and the window had no `homedir`.

Safe to import as values are the modules that depend on nothing but zod —
`colors.ts` and `initials.ts` among them, and the renderer already imports
`turnOutcome` from `events.ts` this way. The list is the first table in
[`core.md`](core.md), named there rather than repeated here so that a module
joining it is written down once; every module the renderer takes a value from
is in it, and a new one has to be added there before the import is written.
Anything reaching `paths.ts`, `persist.ts` or `node:*` is not safe, whatever the
table says about the module importing it — and when a constant is wanted in the
window from a module that is not safe, the constant moves rather than the
import.

### The Agent SDK stops at `events.ts`

The SDK's `SDKMessage` is a union of some forty variants that grows between
releases. Nothing outside [`core/agent.ts`](../src/core/agent.ts) ever sees one:
`mapMessage` turns it into the flat `AgentEvent` of
[`core/events.ts`](../src/core/events.ts), and that is what the service stores,
the bridge carries and the interface draws.

Without the boundary every SDK upgrade would be a UI change. With it, a new
message kind maps to nothing until somebody decides what it should look like.

`query` is a **parameter**, not an import, in the same spirit as `GitExec`: the
whole chat — a message sent, events mapped, a permission answered, a session
closed — is exercised without a child process or a network call. `query()` is
never called from a test.

### `main/` stays thin

`main/index.ts` is bootstrap: create the service, create the window, register
the menu, hand Electron to the IPC layer. Everything with a decision in it was
moved out, which is why `ipc.ts`, `result.ts`, `theme.ts` and `loginPath.ts`
exist as separate files — an entry point that grew to hold them could only be
tested by mocking half of Electron.

`index.ts` is the one file the coverage threshold does not apply to
(`bootstrapOnly` in `vitest.shared.ts`), which makes it the easiest place in the
repository to hide an untested branch. `loginPath.ts` exists for that reason:
repairing the process PATH is two effects and one condition, and left inline it
would have been invisible to the gate rather than exempt from it on purpose.

`broadcast.ts` exists for the same reason and the bill had already come in.
Every channel the main process pushes on lived in `index.ts` and nowhere else,
so renaming one passed the whole gate: unreachable by a test is stronger than
untested, and there is no threshold to notice. It takes the windows to reach as
a parameter — the seam `terminals.ts` uses — so a test fills them with objects
that collect what was sent, and the channel names are asserted where they are
written.

`terminals.ts` is the one part of `main/` that owns something rather than
forwarding it: pseudo-terminals are process resources bound to a window, which
is why they cannot live in the core. Ending one is the whole of what it knows
that nothing else does.

**A session is ended by signalling its process group, not its own process.** A
dev server is a grandchild — the shell runs `run.sh`, which runs the server — so
killing the pty's process leaves the server alive, re-parented to init, still
holding its port and its pid file. node-pty gives each session its own group
through `setsid`, so a negative pid reaches the whole tree and nothing outside
it, and the group outlives its leader while a member is still in it.

**SIGTERM, and only later a hangup.** To a server a hangup often means "reopen
your logs" and it carries on; SIGTERM is the shutdown it cleans up after. The
`pty.kill()` node-pty offers sends SIGHUP, and where a run script `exec`s into
its server that server _is_ the pty's pid — fired in the same tick, the hangup
arrives first and the SIGTERM handler never runs, so the pid file survives and
the next start reports a server already running. It stays as the fallback for a
process that ignores SIGTERM, two seconds later, cancelled the moment the
session exits on its own.

**Ending one answers when it has ended**, not when it was asked to. A restart is
a disposal and a start with nothing in between, and a dev server does not
release its port the instant it is told to — so the next one bound against the
last and failed on the port, blaming itself. `dispose` returns a promise that
resolves on the pty's exit, and the renderer waits on it before opening the
session that replaces it.

**Sessions end with the document that started them.** A reload keeps the
`WebContents` and loses everything the renderer knew, so `disposeFor` ends that
window's sessions on `did-start-loading`. Without it a server carried on with
nothing on screen able to reach it: no Stop, no output, and a port held by
something the pane had forgotten. A Vite HMR update is not a navigation, so in
development an edit can still leave one behind — nothing in `main` can see it.

## The path of one call

Removing a workspace, end to end:

```
WorkspaceRow (click)
  → useWorkspaces.remove          asks for confirmation, handles the failure
  → window.octopus.workspaces.remove   preload: names the channel
  → ipcMain 'workspaces:remove'   main/ipc.ts: validates, calls attempt()
  → service.removeWorkspaceById   core/service.ts: the façade
  → removeWorkspace               core/workspaces.ts: git, then the record
```

Two things are worth noticing.

**Validation happens in `main/ipc.ts`, not deeper.** Arguments arrive from the
renderer, which is a process that renders agent output — a compromised or buggy
one must not reach a command line. Anything that becomes a path, a process
argument or a file is parsed with zod at that boundary.

**Failures come back as values, not exceptions.** `attempt` in `main/result.ts`
converts a throw into `{ ok: false, error, code }`. An exception thrown inside
an IPC handler reaches the renderer as an opaque Electron error with the message
mangled; the `code` is what lets the UI show a localised message instead.

## Where state lives

`git` is the source of truth about git. `~/.octopus/state.json` holds only what
git cannot know: the chats and their agent sessions, the port, the label. When the two disagree —
a worktree directory deleted by hand — the app reports the workspace as missing
rather than quietly agreeing with either side. See [data.md](data.md).

## What is deliberately absent

No state management library: the state is four hooks and some `useState`. No
component library: the components are in `src/renderer/src/components` and are
read as often as they are used. No backend — everything is local, and §5 of
[PROJECT.md](PROJECT.md) explains why that is a goal rather than a stage.

"Local" means there is no server of ours, not that nothing leaves the machine.
Three things do, all of them to somewhere the user already has an account:
`gh` for pull requests, the agent SDK, and — since a workspace has to start from
a base branch that is current — `git fetch` before a worktree is created. Each
is given a deadline, because the alternative to a deadline is a button that
waits for ever.
