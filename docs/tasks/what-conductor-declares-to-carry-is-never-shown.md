# What `.conductor` declares to carry is never shown

**Found:** 2026-09-05, split off from
`the-conductor-file-list-is-read-and-never-carried.md` when that one landed. The
dead parse and the three claims about it are gone; this is the feature they were
standing in for.

## What happens

A repository set up for Conductor declares its gitignored files in
`settings.toml` under `file_include_globs`. octopus reads that file for its
scripts and its prompts and says nothing about the list.

Two things already cover the common cases, which is why this is an improvement
rather than a bug. An **unconverted** checkout keeps the `cp` at the top of its
Conductor `setup.sh`, and that script runs here as written with
`CONDUCTOR_ROOT_PATH` set, so the files arrive exactly as they do under
Conductor. A **converted** one is told by row one of the migration table in
`docs/repo-config.md`, and by the `workspace-scripts` skill, to write the globs
into `.octopus/carry` before deleting the `cp` lines.

The residue is a repository that declares its files through `file_include_globs`
**alone**, with no `cp` in its setup script, opened here without converting.
Those files never arrive, and nothing says the repository declared them.

## Why it matters

It is the one case where the app has the answer on disk and does not use it —
and the symptom is the one `a-carried-file-that-was-not-found-says-nothing.md`
described before it landed: a workspace comes up unable to run, and the first
complaint arrives from a script reading a variable nobody wrote.

## What is already decided

**Not an automatic copy.** `docs/repo-config.md` keeps the carry list
deliberately not live, in contrast to the scripts and prompts which are, and
`docs/PROJECT.md` scopes the live `.conductor` read to scripts and prompts only.
Feeding the list into `carryInto` would start copying paths a `git pull` can
change into a worktree, which is the class of thing `repoSource.ts`'s header
argues has to be shown and approved.

**Patterns cannot be followed at all.** `carriedFiles` yields literal paths and
`carryInto` hands each to `copyFile`, so a glob fails and the failure is
swallowed. Anything surfacing the list has to mark its patterns as declared and
not followed, rather than implying they will be honoured.

**The parse was deleted rather than left standing.** Re-adding it is a few lines
of the TOML reader — `file_include_globs` off the winning layer, split on
newlines, comments dropped — and that was judged cheaper than keeping four
fields alive that nothing read, beside a test asserting a split for a reason the
system did not have.

## Sketch

Beside the carry list, in the Files section of project settings: what
`.conductor` declares, which of it the carry list already names, and which of it
is a pattern octopus will not follow — with a one-click "add these". That is
evidently what the deleted `carriedNote` comment was pointing at.

The surface now exists on the other side too: the Build header reports the files
the carry list named and did not get (`scripts.carryMissing`). A declaration
that was never added and a file that was named and never arrived are two halves
of one question, and they are worth designing together rather than as two
notices in different places.
