# The right panel kills a running script when its tab loses focus

**Found:** 2026-08-12, while working out whether `setup.sh` runs automatically.

## What happens

Start the dev server from the Server tab, then click over to Changes. The server
dies.

The Build and Server tabs render `ScriptRunner` behind a plain conditional, so
leaving the tab unmounts it. Unmounting the terminal is exactly how the Stop
button is implemented — it is what ends the process. Switching tabs therefore
presses Stop without saying so.

The same applies to a long `setup.sh`: switch away mid-install and it is killed
part-way through, leaving a half-populated `node_modules`.

## Why it matters

A dev server exists to be running while you look at something else. Reading the
diff is the most likely reason to leave the tab, and the tab that has to stay
open is the one showing the least useful thing.

## Evidence

- `src/renderer/src/components/RightPanel.tsx:202` — `{(tab === 'build' || tab === 'server') && <ScriptRunner … />}`
- `src/renderer/src/components/ScriptRunner.tsx:80-93` — the Stop button works by unmounting `Terminal`; the comment says so.

## What is already decided

The fix already exists in the same file, applied to a different tab.
`RightPanel.tsx:191-194` keeps `WorkspaceTerminals` mounted and hides it with a
class, and its comment records why: _"a session belongs to the workspace, not to
whether its tab happens to be on screen. Switching to Changes used to kill every
terminal in the project."_

That is the same bug, found once and fixed in one of the three places it lives.

## Sketch

Hide Build and Server the way Terminal is hidden rather than unmounting them.

Two things to get right:

- `ScriptRunner` is keyed by tab **and** workspace so a run never appears to
  belong to another workspace. Keeping both mounted means two live instances —
  the key still has to keep them apart.
- `Terminal` sizes itself with `addon-fit`, and fitting a hidden element gives
  nonsense dimensions. `WorkspaceTerminals` already takes a `visible` prop for
  this; `ScriptRunner` will need the same.
