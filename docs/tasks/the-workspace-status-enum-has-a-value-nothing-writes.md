# The workspace status enum has a value nothing writes

**Found:** 2026-08-17, while deriving a workspace's status from its conversations.

## What happens

`WorkspaceStatusSchema` carries `archived`, and nothing in the application ever
writes it. Archiving is out of scope for stage 1 (§16), so the only way a
workspace can hold that value is a state file edited by hand.

It has just gained a cost. `workspaceStatusFrom` derives a workspace's status
from its conversations, and has to carry a branch for `archived` that no
interaction can reach — a state only a test can produce, which is the shape the
`core-module` skill warns about.

## Why it matters

Small, and worth clearing rather than growing. Every reader of
`Workspace['status']` has to decide what `archived` means to them —
`AGENT_TONES`, `AGENT_LABELS` and `settleStatuses` each already do — and every
one of those decisions is about a value that never arrives. The next reader pays
the same tax.

## Evidence

- `src/core/store.ts` — `WorkspaceStatusSchema = z.enum([… 'archived'])`.
- `grep -rn "'archived'" src/` — the schema, `workspaceStatusFrom`'s guard, `settleStatuses`'s comment, and the tests. No writer.
- `docs/PROJECT.md` §16 — archiving is out of scope.

## What is already decided

Nothing about archiving itself. This is a question about the enum, not about the
feature.

## Sketch

Either build archiving — a workspace kept without its worktree, which §16 says
is not now — or drop the member and let `workspaceStatusFrom` lose its first
branch. Dropping it needs no migration: it is a plain enum on a field every
record already fills, and a file holding `archived` would fail to parse, which
is exactly what `persist.ts` is for.
