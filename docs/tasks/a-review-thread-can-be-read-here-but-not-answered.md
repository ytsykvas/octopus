# A review thread can be read here but not answered

## What happens

The pull request tab draws every comment on a request — issue comments, review
submissions and inline notes, with whoever wrote them and when, an inline note's
resolved mark and the lines it was written against
(`src/renderer/src/components/pr/CommentList.tsx:66-126`). There is no way to
reply to any of them. **Add to chat** puts a remark in the composer so the
agent can be asked about it, and the answer then goes back as a commit or not
at all.

## Why it matters

Half of answering a review is saying why something was left as it is. That half
has no home here: the reader reads the thread in octopus, decides, and then
opens a browser to write one sentence. The tab is otherwise the only place the
work needs.

It is also the last thing §16's code-review question is waiting on — the rest of
it is answered.

## Evidence

- `src/core/pullRequests.ts:461-477` — the GraphQL query reads
  `reviewThreads { comments { … } }` and keeps each comment's id, which
  `ThreadsPayloadSchema` parses (`src/core/pullRequestShapes.ts:369-395`), so
  replying has the handle it needs already.
- `docs/PROJECT.md:679` (§15) records this as deliberately out of scope, not
  missed.

## What is already decided

- Replying belongs on the comment, not in a box at the bottom of the pane: a
  reply without its thread is a comment on the request, which is a different
  thing GitHub already has a place for.
- It is a `gh api` write, so it goes through `pullRequests.ts` beside the other
  commands and reports through `GitHubError` like them.
- Resolving a thread is the same shape of write and would arrive with it, with
  one field to add first: the mutation takes the thread's own id, and the query
  asks for the thread's fields but not its `id`
  (`src/core/pullRequests.ts:464-472`), so nothing here has it to pass. Replying
  off a comment id needs nothing added.
