# The README still says the pull request stops at opening it

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

README.md's "Not there yet" section lists, among the unbuilt things, "everything
around a pull request past opening it — checks and review threads."

All of it is built. `pullRequestShapes.ts` parses the check rollup
(`summariseChecks`) and the `reviewThreads` GraphQL node into
`PullRequestComment`; `ipc.ts` registers `workspaces:pullRequestDetail`,
`commitAndPush`, `closePullRequest` and `mergePullRequest`; and the right pane
draws them through `ChecksList` and `CommentList`, offering merge/squash/rebase.

**The README understates it in two places, not one.** The positive "What it does"
entry at `README.md:84-86` also stops at opening — "shows the diff against the
base branch, takes comments on it, and opens a PR through `gh`" — never
mentioning the check rollup, the review verdict, the inline threads or merging.
So a fix that only edits the "Not there yet" line leaves the front door still
describing a loop that ends at `gh pr create`.

Every other document says otherwise. `docs/PROJECT.md:677` goes out of its way to
narrate the change — "Opening one arrived first; the checks, the review threads
and merging followed" — and CLAUDE.md states plainly that pull requests are not
out of scope. Only the README was not updated.

## Why it matters

The README is the front door and the only document most people read. It tells a
prospective user that the feature which most distinguishes this from a bare
worktree — reading CI state and review threads without leaving the window — does
not exist, in the section they would check before deciding whether to build the
app.

It also misdirects a contributor: "work already identified but not done" points
at `docs/tasks/`, where the real remaining gap is narrower, so someone picking up
the line would start building what is already there.

## Evidence

- `README.md:195-198` — the "Not there yet" section; `README.md:84-86` — the
  second, subtler spot.
- `src/core/pullRequestShapes.ts:212` (`summariseChecks`), `:369-372`
  (`ThreadsPayloadSchema` reaching `reviewThreads`), `:447` (the inline comments).
- `src/core/pullRequests.ts:336, 376, 397, 422, 487`.
- `src/main/ipc.ts:521, 527, 532, 543`.
- `src/renderer/src/components/pr/PullRequestPanel.tsx:17-18, 282, 286`;
  `mergeMethods.ts:15-17`.
- `docs/PROJECT.md:677`; `docs/tasks/a-review-thread-can-be-read-here-but-not-answered.md`.

## What is already decided

**Do not delete the whole line.** Notifications, a Monaco-based diff, and
Linux/Windows builds are genuinely still out of scope — CLAUDE.md's "Out of scope
for now" and `docs/PROJECT.md:675` both list them. Only the pull request clause
has gone stale.

**Replace, do not just drop, the PR clause.** `PROJECT.md:679` names the real
remaining gap: "replying to a review thread from octopus, and anything about a
request other people's branches have."
`docs/tasks/a-review-thread-can-be-read-here-but-not-answered.md` carries the
same thing with the decisions already taken. Since the README's next sentence
points the reader at `docs/tasks/`, the line should land on a gap that folder
actually holds — otherwise the pointer stays misleading in a new way.

## Sketch

Fix `README.md:84-86` in the same edit, or the front door still sells the feature
short.

Minor, and not worth a separate note: the three out-of-scope lists have drifted
apart in wording — the README says "Linux and Windows builds", PROJECT.md §15 and
CLAUDE.md say "Linux builds", and §15 additionally carries "workspace archiving"
and "signing and notarisation" that the README omits. Whether workspace archiving
has since shipped was **not** verified — `src/core/archive.ts` is the cleanup
_script_ runner, a different thing — so do not assume that line is stale without
checking.
