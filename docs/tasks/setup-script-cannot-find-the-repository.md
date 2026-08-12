# `setup.sh` cannot find the repository it belongs to

**Found:** 2026-08-12, while checking whether the setup script runs on workspace
creation.

## What happens

The first thing most setup scripts need is a file from the original checkout —
usually `.env`, which is gitignored and therefore absent from a fresh worktree.
The script has no way to locate it.

Three things go wrong together:

1. **No environment.** `ScriptRunner` passes `{}` to the setup script. `run.sh`
   gets `OCTOPUS_PORT`; `setup.sh` gets nothing at all, including any pointer to
   the repository root.
2. **The template's hint is wrong.** It suggests `cp ../../.env .env`. A
   workspace lives at `~/.octopus/workspaces/<project>/<workspace>/`, so `../../`
   is `~/.octopus/workspaces/` — our own data directory, not the user's
   repository. Following the hint copies nothing, or something surprising.
3. **The docs describe behaviour that does not exist.** §12.2 of PROJECT.md says
   the setup script "runs after the worktree is created". It does not: it runs
   when the Build tab's button is pressed. That is the intended design — the
   sentence is what is out of date.

## Why it matters

Every new workspace starts as a bare checkout with no dependencies installed. A
setup script is the answer to that, and it currently cannot do the one thing it
most needs to do without hard-coding an absolute path — which then breaks for
every other project, since the script is per-project but the path is per-machine.

## Evidence

- `src/renderer/src/components/ScriptRunner.tsx:109` — `env={kind === 'run' ? { OCTOPUS_PORT: String(port) } : {}}`
- `src/core/scripts.ts:44-50` — the setup template, with the `cp ../../.env .env` hint
- `src/core/paths.ts:94-100` — `workspacePath`, which is what makes `../../` wrong
- `docs/PROJECT.md` §12.2 — the stale sentence

## What is already decided

Running is manual, by button. Conductor runs setup automatically on workspace
creation and blocks the workspace if it fails; we deliberately do not. Do not
reopen that — fix the sentence, not the behaviour.

## Sketch

Give the setup script the same treatment `run.sh` already gets: an environment.
At minimum the repository root, which `store.ts` knows and the renderer can
pass. Conductor's equivalent is `CONDUCTOR_ROOT_PATH`; ours would be
`OCTOPUS_ROOT_PATH`, defined next to `PORT_VARIABLE` in `scripts.ts` so the two
names stay together.

Then the template hint becomes correct and portable:

```sh
cp "$OCTOPUS_ROOT_PATH/.env" .env
```

Worth considering at the same time, but a separate decision: whether copying
gitignored files deserves to be its own feature rather than a line everyone
writes by hand. Conductor has one — `.worktreeinclude` plus a default `.env*`
pattern, described in `.claude/skills/conductor-study/references/features.md`.
Cheap for us, and it removes the most common reason to write a setup script at
all.
