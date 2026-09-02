# A repository's Conductor file list is read and never carried

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`readConductorConfig` produces four fields no caller reads. `files`, `carried`,
`patterns` and `otherRuns` are built in `normalise` and consumed nowhere: the
module's only two call sites touch `scripts`, `prompts` and `promptsPath` alone.

Three written statements promise otherwise:

- the doc comment at `conductorConfig.ts:138` points the reader at `carriedNote`,
  **a symbol that does not exist in the repository**;
- `conductorConfig.ts:185` says the unchosen run entries are "written into the
  script as comments", and nothing writes them;
- `docs/core.md:50` lists "the files to carry" among what the module supplies, as
  does the module's own header.

## Why it matters

Not as a lost-secrets bug — two things already cover the common cases. An
unconverted checkout keeps the `cp` at the top of its Conductor `setup.sh`, and
that script runs here as written with `CONDUCTOR_ROOT_PATH` set, so the files
arrive exactly as they do under Conductor. A converted checkout is told by row
one of the migration table and by the `workspace-scripts` skill to write
`file_include_globs` into the carry list _before_ it is told to delete the `cp`
lines.

The residue is a repository that declares its gitignored files through
`file_include_globs` alone, with no `cp` in its setup script, opened here without
converting: those files never arrive, and nothing says the repository declared
them — even though the parser had the list in hand.

So what is worth fixing is the dead parse output and the three claims about it. A
promise in `docs/core.md` that the module can use something it discards is the
kind of thing a reader plans around.

## Evidence

- `src/core/conductorConfig.ts:377-385` — `normalise` returns all four; no caller
  reads any of them.
- `src/core/repoSource.ts:123,239,245` — the only reads off a `ConductorConfig`
  anywhere outside tests.
- `src/core/conductorConfig.ts:138` — "See `carriedNote`"; a repo-wide grep hits
  this comment and nothing else.
- `src/core/conductorConfig.ts:185-186`; `docs/core.md:50`;
  `src/core/conductorConfig.ts:4-8` — the three claims.
- `src/core/conductorConfig.test.ts:203-215` — the split is asserted with a
  rationale about `copyFile` swallowing a glob, **a call these values never
  reach**: a test that passes for a reason the system does not have.
- `src/core/scriptEnv.ts:136` — `CONDUCTOR_ROOT_PATH`, which is how an
  unconverted repository's own `cp` still finds the originals.
- `docs/repo-config.md:261` and `:27`; `.claude/skills/workspace-scripts/references/conversion.md:9,19,39-41`.

## What is already decided

**The carry list is deliberately not live** — `docs/repo-config.md:27` says so
explicitly, in contrast to the scripts and instructions which are, and
`docs/PROJECT.md:494,534` scope the live `.conductor` read to scripts and prompts
only. So feeding `carried` into `carryInto` contradicts a decision already
written down, and it would silently start copying paths a `git pull` can change
into a worktree — the class of thing `repoSource.ts`'s header argues has to be
shown and approved.

**`patterns` cannot be honoured at all as things stand.** `carriedFiles` yields
literal paths and `carryInto` hands each to `copyFile`, so a glob would fail and
be swallowed. Any UI surfacing `carried` has to surface `patterns` as "declared
but not followed".

## Sketch

Two honest options, and picking one is the work:

- **Show it.** A note beside the carry list naming what `.conductor` declares and
  which of it octopus cannot follow, plus a one-click "add these to the carry
  list". That is evidently what `carriedNote` was meant to be, and it fits the
  existing design where an automatic copy does not.
- **Delete it.** `files`, `carried`, `patterns` and `otherRuns` off
  `ConductorConfig`, both comments, the `docs/core.md` row, and the assertions at
  `conductorConfig.test.ts:49,83-86`.

If it is the first: `docs/tasks/a-carried-file-that-was-not-found-says-nothing.md`
asks for the difference between what the carry list names and what `carryInto`
actually wrote to be shown in the Build header. That is the same surface, and the
two are worth designing together rather than as two notices in different places.
