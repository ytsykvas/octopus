# Nothing checks a request number belongs to the branch it is merged in

**Found:** 2026-09-03, split off from
`a-request-opened-while-you-look-away-lands-on-another-workspace.md` when that
one landed. The renderer race it described is closed; this is the layer beneath,
which would have made that race harmless.

## What happens

`mergePullRequest(workspaceId, number, method)` takes the two independently and
never compares them:

```ts
mergePullRequest(workspaceId, number, method) {
  const workspace = requireWorkspace(workspaceId)
  return mergePullRequest(number, method, makeGh(workspace.path))
}
```

and core runs `gh pr merge <number>` with that worktree as the cwd. `gh` resolves
the number against the **repository**, not against the branch it happens to be
standing in, so a number belonging to any branch of the same repository merges.
`closePullRequest` is the same shape.

The renderer is the only thing that has ever guaranteed the pair agree, and it
guaranteed it by not drawing a mismatch — which it did, for one release, through
a generation counter claimed after an await instead of before.

## Why it matters

Merging is not reversible. Every other irreversible action in this app is guarded
where it is performed rather than where it is drawn: `revertFile` refuses a path
outside the worktree even though the pane cannot produce one, `removeProfile`
asks first, `RevertPathSchema` rejects at the boundary. This one trusts the
window entirely.

The cost of the guard is one `gh` call on an action somebody performs a few times
a day.

## Evidence

- `src/core/service.ts` — `mergePullRequest` and `closePullRequest` on the
  service, both passing `number` and `workspace.path` with no comparison.
- `src/core/pullRequests.ts` — `gh(['pr', 'merge', String(number), …])`.
- `src/core/store.ts:144` — `branch` is on the workspace record already, so the
  left-hand side of the comparison costs nothing to obtain.

## What is already decided

**The renderer fix is not enough on its own**, which is the reason this file
exists rather than being folded into the one that landed. A guard in core is
defence against the next staleness bug, not this one.

`gh pr view <number> --json headRefName` is the one call, and `shaped()` in
`pullRequests.ts` is already there to refuse an answer of the wrong form.

It needs a new `GitHubErrorCode`, a `useErrorMessage` case and two locales — the
five-point pattern `envProfileExists` sets.
