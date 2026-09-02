# The warning about publishing an env file is hidden on the press that publishes it

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`PullRequestPanel` asks git whether the project's env file is ignored and passes
the answer down as `exposedEnvFile`. In `NewPullRequestForm` the warning renders
only under `{committing && exposedEnvFile !== null && …}`, where
`committing = commitMessage.trim() !== ''`.

But the submit handler commits **regardless** of that field:
`view.dirty ? committing ? commitMessage.trim() : (draftedCommit ?? title.trim()) : null`.

So the documented default path — leave the commit field empty and let the agent
or the title name the commit, which is exactly what `pullRequest.dirty` tells the
reader will happen — commits and pushes everything with the warning suppressed.

**The gate is a leftover, and `git show 0d182f8` proves it.** Before that commit
the handler read `commitMessage: committing ? commitMessage.trim() : null`, so an
empty field genuinely did leave the work behind and gating on `committing` was
correct. That commit changed the handler to commit whenever `view.dirty`,
rewrote `pullRequest.dirty` because it "said uncommitted changes 'stay behind'.
That is now false" — and left line 140 and the comment above it untouched.

The exposure case self-selects for the dirty branch: an env file git does not
ignore **is itself** an uncommitted change, so `view.dirty` is true precisely
when there is something to warn about.

**The second surface has no warning at all.** Once a request exists the form is
gone and `PullRequestActions` draws `Commit and push`, whose handler runs the
same `git add -A` plus push. `exposedEnvFile` is never given to that component —
its props interface has no such field.

## Why it matters

octopus writes the workspace's variables into that file itself — the warning
string says so — so what is at stake is the app committing and pushing its own
credentials to GitHub. A push is not retractable: CLAUDE.md's own git section
says a pushed commit is mirrored and indexed within minutes.

The warning exists precisely to prevent this, and it is gated on a field the form
tells the user to leave empty, and absent entirely from the second, repeatable
button.

## Evidence

- `src/renderer/src/components/pr/NewPullRequestForm.tsx:140` — the whole gate;
  `:59` — `committing`; `:103-107` — the handler that commits anyway.
- `src/renderer/src/components/pr/NewPullRequestForm.tsx:134-135` — the stale
  comment, "Left empty, the uncommitted work stays behind — which is the warning
  this field replaced, and it is still the truth", sitting directly above the
  string that now says the opposite.
- `src/renderer/src/i18n/locales/en.ts:384-385` — `pullRequest.dirty`, shown
  exactly when `committing` is false, i.e. exactly when the warning is hidden.
- `src/renderer/src/components/pr/PullRequestPanel.tsx:94-110`, `:260`,
  `:214-227`, `:318-320`; `PullRequestActions.tsx:134-139` and its props at
  `:57-80`.
- `src/core/pullRequests.ts:260, 336-339, 348-354`; `src/core/worktree.ts:252-254`
  — no env guard anywhere on either path.
- `src/renderer/src/components/pr/PullRequestPanel.test.tsx:501-510` and
  `:512-519` — both tests type a commit message first, so full coverage never
  exercises the empty-field path. `:1031-1067` presses `Commit and push`, but
  none of those three tests gives the workspace an env file to expose.

## What is already decided

**Do not model the fix on the other surface.** `ProjectSettings.tsx:677-679`
gates the same warning on `envIgnored || contents.trim() === ''`, where
`contents` is the block typed into the app. A project that carries a real `.env`
in through the carry list and types nothing into the app therefore gets **no
warning there at all**, while the file sits in the worktree full of credentials.
The PR panel's warning is correctly not gated on block contents; copying that
check across would open the hole in the place that matters most.

`Commit and push` is only reachable when `detail.detail !== null`, so on a
request whose detail could not be read neither surface exists.

## Sketch

The warning belongs to "this press will commit everything", not to "a message has
been typed". Dropping `committing &&` is the whole fix for path A: the block is
already inside `{view.dirty && …}`, and an exposed env file is what makes the tree
dirty. The comment at `:134-135` must go with it.

For the existing-request path, `exposedEnvFile` has to reach `PullRequestActions`
beside `dirty`. Note the read at `PullRequestPanel.tsx:96-110` is keyed on
`[visible, workspace]` only — it does not re-run when the project's `envFile`
changes or when `.gitignore` is edited in the worktree, so a long-lived tab can
hold a stale "ignored" answer, and `useState(true)` means **stale defaults to
silence**. `ProjectSettings` re-reads on `project.envFile`; this one does not.

`docs/data.md:731-737` documents the Env-section warning as the mitigation for
this exact risk and says nothing about the pull request pane. Whatever the fix,
that paragraph should name both commit buttons.
