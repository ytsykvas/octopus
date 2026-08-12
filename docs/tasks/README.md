# Tasks

Work we know needs doing, written down so that finding it does not derail
whatever is being done at the time.

Most of these files start the same way: something unrelated turns up mid-task —
a bug two layers away, a promise in the docs the code never kept, a feature the
work made obvious. Chasing it produces a commit that does two things and a task
that finishes neither. Writing it here costs a minute and loses nothing.

## The convention

One file per piece of work. The filename says the problem, in kebab-case:
`right-panel-kills-running-scripts.md`, not `bug-3.md`.

There is no status field. A file here is open work; when it lands, **delete the
file in the same commit**. Git holds the history, and a folder of things marked
"done" is a folder nobody reads.

What a file should carry:

- **What happens** — the behaviour, not the fix.
- **Why it matters** — what it costs whoever hits it. If there is no answer, the
  file should not exist.
- **Evidence** — `file.ts:line`. A claim without one is a memory, and memories
  about code go stale silently.
- **What is already decided** — so the work does not reopen a settled question.
- **A sketch**, only when the approach is not obvious.

Keep them short. A task file is a note to a colleague who has forgotten the
context, not a specification.

## What does not belong here

**Speculation.** Record what was verified. "This might be slow" is a thought;
"this is slow, here is the measurement" is a task.

**One-line fixes in a file you already have open.** Writing the note costs more
than the fix. Just fix it.

**Open questions about direction.** Those live in §17 of
[PROJECT.md](../PROJECT.md) — that section is for decisions not yet made, this
folder is for work not yet done. If a task turns out to need a decision first,
say so in the file and stop.
