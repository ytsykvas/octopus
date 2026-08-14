# ⌘⇧D is documented and does nothing

**Found:** 2026-08-14, while building the diff viewer.

## What happens

§10.8 of `docs/PROJECT.md` lists `⌘⇧D` as the shortcut for the Changes tab, and
Conductor — whose set ours overlaps on purpose — opens its diff viewer with it.
Nothing in the app listens for it. The tab is reachable only by clicking.

## Why it matters

The diff is now the thing you go to after every turn the agent finishes, which
makes it the pane most worth a key. A documented shortcut that does nothing is
also worse than an undocumented one: it is read once, tried once, and quietly
distrusted along with the rest of the list.

## Evidence

- `docs/PROJECT.md`, §10.8 shortcut table — `⌘⇧D` → changes.
- `src/renderer/src/App.tsx:218-249` — the whole keyboard handler. It covers
  `⌘⇧N`, `⌘1`–`⌘9` and `⌃1`–`⌃9`, and nothing else.
- `src/renderer/src/components/RightPanel.tsx:116` — `tab` is local state with
  no way in from outside, so the shortcut has nothing to call yet.

## What is already decided

The pane folds from one button in the title bar and the fold is not persisted
(`docs/ui.md`). Whether `⌘⇧D` should also unfold a collapsed pane is the one
real question here — it should, or the shortcut does nothing on the setup where
it would help most.

## Sketch

Lift the chosen tab out of `RightPanel` into `App`, the way the pane's width and
the diff view already are, and have the handler set it. `⌘⇧P` for pull requests
is on the same list and waits on §16, so this is the only one that can land now.
