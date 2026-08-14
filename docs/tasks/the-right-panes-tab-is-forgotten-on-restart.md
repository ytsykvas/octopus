# The right pane forgets which tab you were on

**Found:** 2026-08-14, while building the diff viewer.

## What happens

The right pane opens on Changes every time. Which tab was showing is local
state: it survives neither a restart nor the pane being folded and unfolded.

## Why it matters

The width of the pane persists, the diff's own layout persists, the workspace
selection persists. The tab is the one thing about that pane that does not, and
it is the one a reader changes most often — somebody who works with the server
log open gets Changes back on every launch.

## Evidence

- `src/renderer/src/components/RightPanel.tsx:116` — `useState<RightTab>('diff')`.
- `src/core/config.ts:149,159` — `rightPanelWidth` and `diffView` are stored, so
  the place to put it already exists and already has a migration story.

## What is already decided

The pane is now kept mounted behind whichever tab is showing, so restoring a tab
costs nothing at startup — the terminal and the diff are already there.

## Sketch

A `rightPanelTab` field beside `diffView`, and the same `App` wiring. Worth
doing together with [the-changes-shortcut-was-never-implemented.md](the-changes-shortcut-was-never-implemented.md),
which needs the tab lifted into `App` anyway.
