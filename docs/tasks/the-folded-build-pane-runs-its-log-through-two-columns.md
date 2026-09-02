# The folded build pane runs its log through two columns

**Found:** 2026-09-02, in a review of the whole repository, alongside
[a-terminal-that-never-opens-leaves-the-workspace-building-for-ever.md](a-terminal-that-never-opens-leaves-the-workspace-building-for-ever.md).

## What happens

The build half's `WorkspaceScripts` is mounted inside
`className={buildOpen ? … : 'hidden'}` — that is, `display: none` — which is
precisely what `WorkspaceScripts.tsx:129-131` warns against in its own comment:
"a display-hidden element measures zero, so FitAddon would size the terminal to
no columns".

It does not fail the create: the fit addon clamps to 2 columns and 1 row, and the
spec schema allows ≥1. So a build started while the pane is folded runs its whole
log through a two-column terminal.

## Why it matters

The build half is folded on every mount by design, so this is the ordinary case,
not the exception. The log is the thing a user opens the pane to read when a
build goes wrong, and by then it has already been wrapped into unreadable
fragments — which is exactly the mangled output that comment describes.

## Evidence

- `src/renderer/src/components/RightPanel.tsx:919-921` — the `hidden` class; `:230`
  — the build half starts folded.
- `src/renderer/src/components/WorkspaceScripts.tsx:129-131` — the comment naming
  this hazard.

## Sketch

Either keep the pane measurable while folded (height zero with `overflow: hidden`
rather than `display: none`), or refit the terminal when the pane opens. The
second is cheaper but leaves the already-written lines wrapped, so it only helps
a build still running.
