# A request opened while you look away lands on the workspace you looked at

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`usePullRequest` guards late replies with a generation counter, but `create`
claims its generation **after** the slow call rather than before it. The effect
that reads on a workspace switch does `const attempt = ++generation.current`
before its await; `create` awaits `createPullRequest` — seconds of `git push`
plus `gh pr create` — and only then claims one.

So a switch landing during that await is invisible to the guard: it bumps
`generation` in the new workspace's effect, and then `create` bumps it again past
that. The follow-up read is made with the captured **old** `workspaceId`, always
satisfies the check, and writes the old workspace's view into the pane. Either
the new workspace's read is overwritten, or it is still in flight and gets
invalidated by the higher generation and dropped — so nothing ever replaces the
stale view.

The render-time reset does not help: it fires on the switch itself, before the
stale write arrives.

Reproduced with a probe: `pullRequest` mocked per id (anna → ahead 1, bob →
ahead 9), `createPullRequest` held. Create on anna, rerender to bob, wait for
bob's view to land, resolve the create — `view.ahead` came back 1 and the last
`workspaces.pullRequest` call was `['anna']`.

## Why it matters

The pane draws the **new** workspace's branch name over the **other** branch's
request number and title, and the buttons act on that mismatch: `merge` sends
`workspace.id` — the workspace now on screen — together with the stale `number`,
and core runs `gh pr merge <number>` in that worktree with no check that the
number belongs to that branch. Both worktrees point at the same remote, so the
merge succeeds — on the pull request the user was not looking at.

The worst case is when the new workspace **already has** its own request: the
stale write swaps the number and title under an otherwise normal-looking pane,
and the only thing on screen that disagrees is the faint mono branch line. There
is no "read at" timestamp and no visible mismatch to catch it. When the new
workspace has no request, the pane at least jumps from the create form to a
summary, which is noticeable.

The 15s detail poll corrects none of it — `usePullRequestDetail` happily re-reads
the stale number, so a wrong pane that keeps refreshing looks more trustworthy,
not less.

## Evidence

- `src/renderer/src/hooks/usePullRequest.ts:140` — the claim, after the await on
  `:129`; `:145` — the dep list, so the running closure holds the old id;
  `:90` — the check it always satisfies.
- `src/renderer/src/hooks/usePullRequest.ts:71-77` — the render-time reset clears
  `view` and `error` but not `generation`, and not `creating`/`drafting`/`actionError`.
- `src/renderer/src/hooks/useWorkspaceDiff.ts:94` — **the same hook shape done
  right**: `load` claims before the await. That is exactly the ordering `create`
  inverts.
- `src/renderer/src/hooks/usePullRequest.test.tsx:95-104` — the create is resolved
  _before_ the rerender, so the only test of this race exercises the ordering the
  guard already covers.
- `src/core/pullRequests.ts:397-411` — `gh pr merge <number>` with no check that
  the number belongs to the branch at the `gh` cwd.
- `PullRequestPanel.tsx:74-78` is not keyed by workspace, and the whole
  `RightPanel` stays mounted across switches, so the hook instance survives.

## What is already decided

Claiming early is safe: it invalidates the initial effect read for the same
workspace, but `create`'s own follow-up read supersedes it anyway — which is what
the comment at `usePullRequest.ts:137-139` already says.

## Sketch

One line moved: claim `const attempt = ++generation.current` at the top of
`create`, before the `createPullRequest` await, and reuse that same `attempt` for
the `apply`. **Do not claim twice** — `:141` puts a second await between the claim
and the apply, so claiming again after it would not fix anything.

`create` is not the only leak across a switch. `creating`, `drafting` and
`actionError` are not in the reset, so anna's spinner and anna's error land on
bob's form — `NewPullRequestForm.tsx:204-209` and `:175`. And `draft()`
(`:148-164`) has the same late-reply shape, setting `drafting`/`actionError`
after its await with no guard at all. Whatever reset is added should cover those
three alongside `view` and `error`.
