# A forgotten terminal has no way back

**Found:** 2026-09-07, narrowed from
`a-hot-reload-leaves-a-session-nobody-remembers.md` when that one landed. The
sequence recovers itself now; this is what is left of the same trouble.

## What happens

The halves announce what they are running and the sequence takes it back, so a
hot update no longer offers `Run` over a live server. That covers everything
where the **runner** survives, which is what Fast Refresh usually leaves.

It does not cover a session whose runner is gone. `Terminal` disposes its
session on unmount, so an unmounted half takes its pty with it — but a reload
that remakes the whole document (⌘R, a renderer crash) is caught in `main` by
`did-start-loading`, and that path already ends every session the window owns.
The gap is anything that unmounts a half **without** running its cleanup, which
React does not do, and anything that leaves a session `main` still holds while
no window claims it.

So this is a narrow residue rather than a symptom anybody has hit since. It is
written down because the machinery that would close it is the same one the
original note asked for, and because there is no way to see the residue at all
today: nothing lists what `main` is holding.

## Why it matters

Less than the original did. A pty nobody claims keeps a shell alive, holds a
port and, for a dev server, keeps writing to a file nobody reads. The failure it
produces is the one that sent this hunt into a user's own script twice: "a
server is already running", from somebody else's tool.

## Sketch

`terminal:list`, answering with the live sessions and enough of each spec to say
whose it is — the workspace and the kind. Two things fall out of it: a pane can
reconcile on mount rather than guess, and Settings can show what is running with
a way to end one.

The spec carries neither today (`core/terminal.ts`), so the first step is an
`owner` the renderer chooses and `main` keeps beside the session.

Worth doing when the terminal manager is next opened, not before: it serves a
residue rather than a symptom.
