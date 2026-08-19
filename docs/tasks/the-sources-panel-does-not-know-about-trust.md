# The instruction-sources panel does not know about the trust gate

**Found:** 2026-08-20, while drafting the user documentation page that would have
told people to rely on it.

## What happens

`projectInstructionSources` computes `loaded` from `config.settingSources` alone
(`src/core/service.ts`, the `toSdkSettingSources(config.settingSources)` argument).
`sourcesFor` — the thing that actually starts the session — narrows that to
`['user']` while the repository's capability files are unapproved.

So on an unapproved repository the Instructions panel says **read** for
`CLAUDE.md`, `.claude/settings.json`, commands, skills and subagents, and the
agent reads none of them.

This is the same defect the review confirmed on 2026-08-19 — a panel asserting
something it did not measure — reintroduced the next day by the gate itself.

## Why it matters more than the first time

The first version was wrong about a setting the reader chose. This one is wrong
about a **security** state, in the direction that reassures: it says the project's
instructions are in force when they have been deliberately withheld. Somebody
debugging "why does the agent not know our conventions" is sent to look
everywhere except the answer.

## The knot

The panel is per **project** and reads the checkout. Trust is per **worktree** —
`capabilityFiles(workspace.path)` — because a branch may carry different settings
from the branch beside it. There is no single honest answer for "is this project
approved" when two of its workspaces can differ.

Three ways out:

- **Make the panel per workspace.** Correct, and the largest change: the panel
  lives in the project dialog, which has no workspace.
- **Digest the checkout too**, and compare that against `approvedSettings`.
  Cheap, no new plumbing, and conservative in the common case — but still wrong
  where a worktree's settings differ from the checkout's.
- **Say less.** Drop `loaded` to two states and let the trust strip carry the
  whole story. Loses the thing the panel was rewritten for yesterday.

## Evidence

- `src/core/service.ts` — `projectInstructionSources` vs `sourcesFor`
- `src/core/instructionSources.ts` — takes `sources`, and has no idea a gate exists
- `docs/tasks/` sibling: the review finding this repeats is the one that produced
  `fix(agent): the instructions panel says what is read, not what is on disk`
