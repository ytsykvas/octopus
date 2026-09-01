# Project settings names a script that will not run

The Scripts section of Project settings asks `projectScripts(projectId)`, which
resolves against `project.repoPath` — the checkout. Every actual run asks
`workspaceScripts(workspaceId)`, which resolves against the worktree. Both are
right, and `repoSource.ts` says why in as many words: a branch may carry a
script the checkout has not got, so the answer has to be about the directory the
script would run in.

They can therefore disagree, and nothing says so. Seen in the real app:

- planner's checkout sits on `main`, which still has `.conductor/settings.toml`;
- its workspaces are cut from `origin/develop`, which has `.octopus/scripts/`;
- so settings reports all three scripts as coming from `.conductor/settings.toml`
  and marks the project's own editors read-only against them, while the workspace
  runs three entirely different scripts.

The wording survives this — the notice says "**This checkout** supplies this
script" — but a reader has no reason to hear the distinction, and the section
sits in a dialog whose other half is about running.

The fix is small and the pattern already exists: `instructionSources` takes an
optional `workspaceId` and narrows to the worktree when one is open. Give
`projectScripts` the same, resolve against the workspace when the dialog was
opened from one, and say which directory the answer is about.

Worth doing together with the case that has no workspace open at all, where the
checkout is the only thing to answer about and the answer may still be wrong for
every branch — a line saying so is probably enough there.

Found while checking what Project settings showed after planner was re-added.
