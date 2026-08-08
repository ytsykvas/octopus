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

Enforced by `.claude/hooks/protect-core.sh`, which blocks the edit outright.

Without it the core could not be tested without launching an application, and
`npm test` would need a display. It also keeps the door open to a CLI or a
daemon later — the same reason the layer exists at all.

If a core operation needs a window, a dialog or a menu, the decision stays in
core as a pure function and `main/` supplies the Electron part. `main/ipc.ts`
is the worked example: it takes `IpcHost` — five functions — rather than
importing `ipcMain`, `dialog`, `BrowserWindow` and `nativeTheme`.

### The renderer may import types from core, but values only from safe modules

Types vanish at build time, so `import type { Project } from '@core/store.js'`
costs nothing. A **value** brings the module with it, and most core modules
reach Node: `store.ts` → `paths.ts` → `node:os`.

This has broken the app once. Importing `PROJECT_COLORS` from `store.ts` passed
type checking, linting and every test, then failed at runtime with _"Module
node:os has been externalized for browser compatibility"_ — because Vite
externalises Node built-ins and the window had no `homedir`.

Safe to import as values: `colors.ts`, `initials.ts`, `branches.ts` — they
depend on nothing but zod. Anything reaching `paths.ts`, `persist.ts` or
`node:*` is not.

### `main/` stays thin

`main/index.ts` is bootstrap: create the service, create the window, register
the menu, hand Electron to the IPC layer. Everything with a decision in it was
moved out, which is why `ipc.ts`, `result.ts` and `theme.ts` exist as separate
files — a 357-line entry point could only be tested by mocking half of Electron.

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
git cannot know: the agent session, the port, the label. When the two disagree —
a worktree directory deleted by hand — the app reports the workspace as missing
rather than quietly agreeing with either side. See [data.md](data.md).

## What is deliberately absent

No state management library: the state is two hooks and some `useState`. No
component library: the components are in `src/renderer/src/components` and are
read as often as they are used. No backend — everything is local, and §5 of
[PROJECT.md](PROJECT.md) explains why that is a goal rather than a stage.
