# The pull request draft never asks the repository

`readEffectiveInstruction` in `service.ts:2504` puts the repository first — a
worktree carrying `.octopus/instructions/pull-request.md`, or Conductor's
`[prompts]`, wins over the project's own copy and the installation's. That is
what the pull request tab shows, and what the six prepared prompts send.

`draftPullRequest`, three hundred lines further down at `service.ts:2848`, calls
`effectiveInstruction` directly — `service.ts:2858-2859`, the third and fourth
elements of the `Promise.all`:

```ts
const [diff, changed, instruction, commitInstruction] = await Promise.all([
  // ... the diff and the change count ...
  effectiveInstruction('pullRequest', workspace.projectId, dataRoot),
  effectiveInstruction('commitMessage', workspace.projectId, dataRoot)
])
```

So the one place the app writes a description **itself** — the form left empty,
the agent asked to title and describe the work — reads a chain one layer short.
A repository that supplies its own pull request instruction is obeyed everywhere
except there, and nothing says so.

The fix is to route both through the same helper the panel uses. The awkward
part is that `readEffectiveInstruction` is keyed by workspace id while this has
the workspace in hand, so the shared piece is a small function taking the
workspace, not the id.

Worth a test that would have caught it: a worktree carrying
`.octopus/instructions/pull-request.md`, and an assertion that the text reaches
the draft. There is no such test today for either call.

Found while correcting `docs/data.md`, which claimed the chain had two levels.
The same claim is still in the preload's doc comment for the call the panel
makes — `preload/index.ts:432` says "its project's, or the global one" — and is
worth fixing at the same time.
