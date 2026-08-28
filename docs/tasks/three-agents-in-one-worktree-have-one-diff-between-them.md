# Three agents in one worktree have one diff between them

**Found:** 2026-08-17, on shipping several conversations per workspace.

## What happens

A workspace now holds up to three conversations, running at once in the one
worktree, with no locking between them — that part is decided (§10.8). What is
not decided is what the review surface does about it.

The changes pane is scoped to the workspace, so it shows the three agents' work
merged into a single diff with nothing saying which conversation wrote which
hunk. A review note is attached to a line of that diff and rides out with the
next message from whichever conversation is showing — which may be the one that
never touched the file, about a line a third conversation has since moved.

## Why it matters

Reviewing is the point of the diff pane, and reviewing needs to know who did
what. "The agent changed this" was an unambiguous sentence while there was one
agent per worktree; it no longer is. Two agents editing the same file also
produce a diff neither of them would recognise as its own work.

§16 names exactly this as the open half of the question — this file records the
surface it actually lands on.

## Evidence

- `src/core/service.ts` — `readWorkspaceChanges(workspaceId)`; nothing about the diff is per conversation.
- `src/renderer/src/hooks/useDiffComments.ts` — notes are kept `byWorkspace`, and `App` passes the one controller to every tab of the pane.
- `src/renderer/src/hooks/useWorkspaces.ts` — the change count on the row is per workspace for the same reason.

## What is already decided

- No locking, no queue, no "one at a time" mode. The user asked for genuine
  parallelism and got it.
- The tab strip announces what each conversation is doing, so "who is working"
  is answered. "Who wrote this line" is not.

## Sketch

Nothing to build yet — the first question is which of these is worth having:

- attributing hunks to a conversation (the service knows which chat announced
  each edit; `editsInFlight` is already keyed by chat), and offering a filter;
- keeping review notes per conversation as well as per workspace, so a note goes
  out with the agent it is addressed to;
- or saying plainly, once, that the diff is the workspace's and leaving it —
  which may well be right, since the branch is what lands and it is one branch.

Worth answering before the diff pane grows anything else.
