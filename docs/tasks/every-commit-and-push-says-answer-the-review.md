# Every "Commit and push" commits under "Answer the review"

## What happens

The button in the pull request pane commits everything in the workspace under a
fixed message: `pullRequest.answerCommit`, which reads **"Answer the review"**.
It is passed at the press, not chosen:

```tsx
onCommitAndPush={() => {
  commitAndPush(t('pullRequest.answerCommit'))
}}
```

`src/renderer/src/components/pr/PullRequestPanel.tsx:386`.

So a workspace where nobody has reviewed anything — the ordinary case of "I made
another change, send it" — produces a commit claiming to answer a review that
does not exist.

## Why it matters

The message is the only description that change will ever have, and it goes to
the remote. A branch worked on this way ends up with three or four commits all
called "Answer the review", which is worse than no message: a reader scanning the
log cannot tell them apart, and `git log --oneline` on the request says nothing
about what happened.

The name was right when the button was: it existed to get an agent's answer to a
review onto an open request, and `src/renderer/src/i18n/locales/en.ts` still says
so — _"Named for what the commit is rather than for what changed"_. The button
has outgrown that; the string has not.

## What is already decided

- **Not the Push button's problem.** `workspaces:push` sends what is committed
  and deliberately commits nothing, so it has no message to choose. This is only
  about the commit half.
- **The pieces already exist.** The create-request form has a commit message
  field with its own validation (`CommitMessageSchema`, 1–2 000 characters), and
  `instructions.ts` already carries a `commitMessage` instruction that
  `draftPullRequest` uses to have the agent write one.

## A sketch

Either a small field beside the button, defaulting to nothing and refusing an
empty commit the way the form does — or the `commitMessage` instruction, so the
agent describes its own change, with the drafted text shown before it is used.
The second is closer to what the form already does and reuses the machinery.
