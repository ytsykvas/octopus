# The folded build pane runs its log through two columns

**Found:** 2026-09-02, in a review of the whole repository, alongside
[a-terminal-that-never-opens-leaves-the-workspace-building-for-ever.md](a-terminal-that-never-opens-leaves-the-workspace-building-for-ever.md).

## What happens

The build half's `WorkspaceScripts` is mounted inside
`className={buildOpen ? … : 'hidden'}` — that is, `display: none` — which is
precisely what `WorkspaceScripts.tsx:129-131` warns against in its own comment:
"a display-hidden element measures zero, so FitAddon would size the terminal to
no columns".

It does not fail the create: the spec schema takes anything from 1 column up
(`src/core/terminal.ts:40-41`). Which wrong size arrives depends on what a
`display: none` subtree measures. A zero character cell makes `proposeDimensions`
return nothing and `fit()` leave xterm's 80×24 default standing; otherwise
`getComputedStyle` hands back the host div's `h-full w-full` as percentages
rather than pixels, and the geometry is floored at the addon's minimum of 2
columns and 1 row. Either way the size that goes into `terminal.create`
(`Terminal.tsx:144-145`) was measured from a box that is not the pane, before a
line of output is written.

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

Keep the pane measurable while folded: height zero with `overflow: hidden`
rather than `display: none`. Refitting the terminal when the pane opens is
already there — `Terminal.tsx:166-170` observes the container and calls
`fit.fit()`, which fires the moment the element gains a box — and it is not
enough on its own: the pty was created at the wrong size and the program
running in it has already wrapped its output to that width.
