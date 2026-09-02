# Deleting a set of variables asks nothing

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

The Delete button in Project settings → Env removes a set of variables with no
confirmation. `dropProfile` calls `projects.removeEnv` straight from the button;
`removeProfile` is an `rm` with `force`, so the 0600 file — the only copy the app
keeps — is gone with no undo, no rename-aside and no backup anywhere in core.

The same modal already confirms a lesser deletion: `SkillsSection.tsx:79-89` uses
`useConfirm({ destructive: true })` before removing a skill.

Two references move on the same unconfirmed click, and neither is mentioned
anywhere:

- a workspace pinned to the deleted set goes back to following the project;
- if the deleted set was the project's own default, the project moves onto
  `remaining[0] ?? DEFAULT_PROFILE`.

The pane header shows only the resolved name, so a workspace deliberately kept
off the project's default now reads as the project's default with nothing having
said it changed. The next `prepare` then writes the project's block into that
workspace's `.env`.

## Why it matters

The deleted file is the only copy in existence — `docs/repo-config.md:62` is
explicit that the env block "is never exported, never imported, and not
represented in `.octopus/` even as a list of key names". One misclick on a button
that asks nothing destroys a project's credentials.

A project whose default is the risky environment then hands it to a workspace
that was deliberately kept off it.

**There is a recovery window worth knowing:** the deleted block survives in each
workspace's env file, between our markers, until the next `prepare` overwrites it
via `applyEnvOverrides`. A user who notices before the next Run can still read
the values out of a worktree; after one Run they are gone from disk entirely.

## Evidence

- `src/renderer/src/components/ProjectSettings.tsx:342` — `dropProfile` calls
  `removeEnv` with nothing in between; `:643` — the destructive button.
- `src/renderer/src/components/settings/SkillsSection.tsx:79-89` — the in-dialog
  precedent, better evidence than `App.tsx:80`.
- `src/core/envProfiles.ts:214-220` — `rm(path, { force: true })`.
- `src/core/service.ts:2234-2238` — the project's own default silently moves;
  `:2241` — pinned workspaces go to `null`.
- `src/renderer/src/components/ProjectSettings.test.tsx:842` — "deletes the one
  on screen" asserts `removeEnv` is called immediately, so it breaks the moment a
  confirm is added; the sibling at `:857` too.

## What is already decided

**The reference rewriting is not the bug.** It is deliberate, commented
(`service.ts:2222-2227`), asserted by `service.test.ts:1839`, and stated in commit
`295bfc7`. It is load-bearing: rewriting in the same commit is what keeps
`state.json` from ever holding a reference to a file that is not there, which is
the invariant `envProfiles.ts:236-241` relies on to make a vanished file resolve
to nothing rather than to the wrong environment.

So **do not** make `removeEnvProfile` refuse when workspaces are pinned. The
change belongs in the renderer, before the call.

The doc at `envProfiles.ts:236-241` governs a _dangling_ pin — a workspace still
pinned to a set whose file vanished from underneath it — which `removeEnvProfile`
exists to prevent. It is not being contradicted here.

## Sketch

Route Delete through `useConfirm`. No plumbing from `App` is needed:
`useConfirm` renders its own dialog next to the caller, and `SkillsSection.tsx:51`
already does exactly this inside this very modal.

Both `ProjectSettings.test.tsx:842` and `:857` need the confirm driven, the way
the skills tests do.

If the message is to name how many workspaces are pinned — the useful half —
`ProjectSettings` cannot compute it today: its props carry the project, a
`workspaceId` and a boolean `hasWorkspaces`, never the workspace list.
`RightPanel.tsx:366` already has the resolution helper. A confirm that says only
"this cannot be undone" is cheap and still worth having on its own; one that
mentions workspaces but not the project's own default would still under-report.
