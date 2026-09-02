# `gh` answers are capped and the pane does not say so

## What happens

Three reads have a ceiling, and a request past it is drawn as though there were
nothing there:

| Read                                 | Cap                   | What is silently missing            |
| ------------------------------------ | --------------------- | ----------------------------------- |
| `readBranchRequests`                 | 100 requests          | the mark beside an older branch     |
| `gh pr view --json comments,reviews` | 100 of each, gh's own | the earliest comments on a long one |
| `reviewThreads(first: 50)`           | 50 threads, 20 each   | inline notes past the fiftieth      |

`BRANCH_REQUEST_LIMIT` is named and reasoned about in `src/core/pullRequests.ts`;
the other two are gh's own query and the number in ours, and neither is
mentioned on screen.

## Why it matters

Only the first is likely to be met in this app's own use, and it is the one that
matters least — a workspace whose request is older than the hundred most recent
simply has no mark, which reads as "no request yet". That is wrong rather than
merely incomplete: the header then offers **Create PR** for a branch that
already has one — on a workspace that still has something to carry, since
`readyForRequest` wants changed files or commits ahead as well
(`src/renderer/src/App.tsx:455-458`). The offer is as far as it goes: the button
opens the pull request tab, which asks about the branch itself rather than
reading the capped list (`src/core/pullRequests.ts:158-175`, through
`usePullRequest` in `PullRequestPanel.tsx:75-76`), so the request is there once
the pane is open. What stays silently wrong is the unmarked row and the button
beside it.

The other two need a repository busier than this one. Recorded because a
truncation nobody wrote down is one somebody eventually debugs.

## Evidence

- `src/core/pullRequests.ts:514` — `BRANCH_REQUEST_LIMIT`; `THREADS_QUERY`'s
  `first: 50` at `:464` / `first: 20` at `:470`.
- `src/renderer/src/components/pr/CommentList.tsx:42-52` draws what it is given
  and has no notion of there being more.

## What is already decided

- A cap rather than pagination, for the reason `REPOSITORY_LIMIT` gives
  (`src/core/github.ts:15-16`): past this the answer needs a search box rather
  than a longer page.
- So the fix is to **say so**, not to raise the number: a line under the list
  when the count came back at the ceiling.
