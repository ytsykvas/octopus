# A refused removal has already thrown the workspace's conversations away

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`removeWorkspaceById` does its destructive work before the step that can refuse.

1. `closeChatsOf(workspaceId)` (`service.ts:2723`) — for every chat this runs
   `closeOneChat`, which kills the session and then `removeTranscript` deletes
   the conversation log from disk.
2. the project's cleanup script (`service.ts:2739`), which is what drops the
   workspace's database.
3. only then `removeWorkspace` (`service.ts:2752`), whose guards throw
   `uncommittedChanges` or `branchUnmerged` **before git touches anything** —
   the comment above them even says "Both checks happen before anything is
   destroyed."

When either throws, the commit at `service.ts:2787` never runs. The workspace
record, its chat records and its worktree all survive — with every transcript
deleted and the cleanup script already run.

Driven against the real service in a throwaway repository — clean worktree, one
commit not in main, one chat with one entry, an archive script writing a marker,
called with `{ force: false, deleteBranch: true }` exactly as the renderer sends
it — the result was `{"code":"branchUnmerged","historyBefore":1,"historyAfter":0,"chatsStillListed":1,"workspacesStillListed":1,"archiveScript":"ran"}`.

`branchUnmerged` is the ordinary path, not an exotic one. `useWorkspaces` pre-ticks
the delete-branch checkbox and sends `force: hasChanges`, so a **clean** workspace
whose commits are not yet merged refuses every time — the everyday "the agent
committed, nothing is merged yet" state. (The `uncommittedChanges` half can only
fire on a race, since a dirty worktree sends `force: true`.)

## Why it matters

The user asks to remove a workspace, is told the branch has commits that are not
in `origin/main`, cancels — and has silently lost every conversation in that
workspace plus whatever the cleanup script tore down.

The chat records survive **with their session ids**, so the tabs reopen empty
above an agent that still remembers everything. `transcript.ts:3-7` describes
that exact failure in its own words. Nothing in the interface says it happened.

`docs/core.md:171` states the opposite invariant: "An operation that fails cleans
up after itself."

## Evidence

- `src/core/service.ts:2716-2723` — `removeWorkspaceById` opens with
  `closeChatsOf`, before any guard has run.
- `src/core/service.ts:1723` — `removeTranscript(chat.id, dataRoot)` inside
  `closeOneChat`; `src/core/transcript.ts:92-94` is an unconditional
  `rm(..., { force: true })` with no copy kept.
- `src/core/service.ts:3064-3066` — `chatHistory` reads the transcript and
  nothing else, so a deleted file is an empty log for good.
- `src/core/service.ts:2739-2745` — the cleanup script, still before any guard.
- `src/core/workspaces.ts:379-383` and `:404-415` — the two throws, under the
  comment at `:385-387`.
- `src/core/service.ts:2787` — the state commit, never reached on a refusal.
- `src/renderer/src/hooks/useWorkspaces.ts:319-330` — `checked: true` on the
  branch checkbox, `{ force: hasChanges, deleteBranch: answer.checked }`.
- `src/core/chats.ts:504` with `src/core/service.ts:1974` — the surviving chat
  record keeps `sessionId`, and `resume: chat.sessionId` brings the agent back
  with its memory intact above the emptied log.
- `src/core/service.test.ts:541` asserts only that the refusal happens; the
  cleanup-script tests from `:1553` all take the success path. Nothing pins the
  ordering as intended.

## What is already decided

**Do not fix it by reordering the destruction.** Both `closeChatsOf` and the
archive script must run while the worktree still exists, and the comments at
`service.ts:2719-2722` and `:2725-2728` say why — a live session pointed at a
path about to vanish, a script whose cwd is the worktree. `service.test.ts:1553`
pins it: "runs in the workspace before the worktree goes."

`removeProjectById` (`service.ts:2620-2650`) has the same ordering and is fine:
it calls `removeWorkspace` with `{ force: true, deleteBranch: true }` wrapped in
`.catch(() => undefined)`, so nothing can refuse mid-way. Leave it.

## Sketch

A preflight: evaluate the two guards before `closeChatsOf`, then proceed. Both
need only execs that already exist at that point — `makeExec(workspace.path)` for
the dirty check, `makeGh(workspace.path)` for `mergedRemotely`.

Watch the cost: `mergedRemotely` runs `readPullRequest` through `gh`
(`service.ts:2775-2782`), so a preflight that lets `removeWorkspace` re-check
doubles a network round trip. Either export an `ensureRemovable` beside
`removeWorkspace` and call it once, or thread the computed answer down.

A preflight narrows the hole without closing it: if the guards pass and
`discardWorktree` then throws for a real reason (`workspaces.ts:435-441` rethrows
when the path is still on disk), the transcripts are already gone. Closing it
properly means deleting transcripts only after the state commit — `closeOneChat`
fuses "kill the session" and "discard the history" into one call, and those two
want splitting.

`openChat` is lazy (`service.ts:2924`), so a workspace nobody has spoken to loses
nothing. That is the only case that escapes.
