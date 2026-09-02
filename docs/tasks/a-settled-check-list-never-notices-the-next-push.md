# A settled check list never notices the next push

**Found:** 2026-08-29, while adding the "Fix the checks" prompt.

## What happens

The pull request tab re-reads GitHub every 15 s while something is still
settling, and stops once nothing is. `settling` is true while a check is pending
or mergeability is unknown — neither of which is true of a request whose checks
have all finished, red or green.

So the pane goes quiet on a red check, which is exactly when the agent is most
likely to change something. The agent pushes a fix, GitHub starts the workflow
again, and the pane keeps showing the old failure until somebody presses **Read
GitHub again**. The new "Fix the checks" button makes this easy to walk into:
press it, watch the agent commit and push, and the checks beside it still say
the run that prompted the press.

## Why it matters

The one screen that says whether the fix worked is the one that stops updating
the moment there is a fix to judge. The stale answer is indistinguishable from a
fresh one — nothing on the pane says when it was read.

## Evidence

- `src/renderer/src/hooks/usePullRequestDetail.ts:32` — `settling` is
  `checks.some(pending) || mergeable === 'unknown'`; a finished failure is
  neither.
- `src/renderer/src/hooks/usePullRequestDetail.ts:107` — the next read is
  scheduled only when `settling(result.value)`.
- `src/renderer/src/components/pr/PullRequestPanel.tsx:214-227` —
  `commitAndPush` calls `detail.refresh()`, but a push made by the agent in its
  own worktree goes through nothing that does.
- `src/renderer/src/components/pr/PullRequestSummary.tsx:69-77` — **Read GitHub
  again** (`en.ts:414`) is the button's `title` and `aria-label`, not text on
  screen: it is the `RotateCw` icon beside the request number.

## What is already decided

Not polling for ever. A pane left open on a merged request should cost nothing,
which is the whole reason `settling` exists.

## Sketch

Two candidates, and the second is probably the smaller one.

Re-read when this workspace's git head moves. The workspace already knows when
it has commits the base does not; a push is a change the app can see locally,
without asking GitHub whether anything happened.

Or read once more a minute after the last read whenever any check is failed —
enough to catch a push, cheap enough not to matter, and it stops on its own once
the checks are green.

Either way, saying when the checks were last read would be worth as much as the
re-read itself.
