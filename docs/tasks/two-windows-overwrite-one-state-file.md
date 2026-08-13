# Two app instances silently overwrite each other's state

**Found:** 2026-08-13, while diagnosing a workspace that could not be removed.
The removal failure was the symptom; this is what caused it.

## What happens

Nothing stops a second copy of the app starting. Both open the same
`~/.octopus/state.json`, both hold it in memory, and both write it whole. The
last writer wins, so anything the other window did is gone — not merged, not
refused, just absent the next time it saves.

Observed: one window created a workspace, the other still held a workspace the
first had removed. The state file flipped between the two views within a minute,
depending on which window had last written. Removing the stale workspace then
failed with `fatal: … is not a working tree`, because the worktree it named had
already been removed by the other window.

`docs/data.md` already warns that editing the state file from outside while the
app runs makes the two disagree. A second instance is that same hazard, reached
without editing anything.

## Why it matters

Losing a record is worse than failing to write one. A workspace that vanishes
from the sidebar still has a worktree and a branch on disk, so the next attempt
to create one with that name fails on something the user cannot see — and the
orphaned directory is invisible to the app that made it.

It also makes bug reports untrustworthy: two windows on different builds
disagree about behaviour, and the one in front of the user may not be the one
that was just rebuilt.

## Evidence

- `src/main/` has no `requestSingleInstanceLock()` anywhere — Electron's own
  mechanism for this, which fires `second-instance` on the window already open.
- `src/core/service.ts` — `commit()` serialises writes **within** a process
  (`stateWrites` chains them). Across processes it guarantees nothing.
- `src/core/persist.ts` — `writeJsonFile` writes a temp file and renames, so a
  write is atomic and never torn. Atomic, and still last-writer-wins.

## What is already decided

Nothing. Worth noting that a lock is one line in `src/main/index.ts` and settles
the common case — a second launch focuses the existing window — while a stale
`state.json` written by a crashed instance is a different problem this does not
touch.

The uglier variant is two instances of **different builds** during development,
which is how this was found: `pkill -f "electron-vite dev"` kills the dev server
but not the Electron process it spawned, so `npm run dev` then leaves two apps
running. A lock would have made that impossible rather than merely visible.
