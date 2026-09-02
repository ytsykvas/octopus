# A file whose only change is its mode shows a row with nothing in it

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

git renders a permission change as a `diff --git` block carrying `old mode 100644`
/ `new mode 100755` and no hunks at all. Under this project's own flags the whole
block is three lines: no `---`, no `+++`, no `@@`.

`parseUnifiedDiff` matches none of the lines it looks for — `Binary files`,
`rename to`, `+++`, `HUNK_HEADER` — and flushes a file with `hunks: []`.
`FileDiff` has no field a mode could live in, so nothing survives. Verified by
running `readWorkspaceDiff` against a temporary repository:

    { path: 'run.sh', oldPath: null, status: 'modified',
      added: 0, removed: 0, omitted: 'none', hunks: [] }

In the pane, no counts are drawn (`added > 0` and `removed > 0` are both false)
and `DiffBody` returns null on an empty hunk list. What is left is a chevron, an
`M`, a path — and, beside them, the revert control. So it reads as a live,
revertable file that changed nothing, which is more confusing than a truly empty
row.

**A mode change is also lost when the file has content changes**, and that case is
worse. Editing the file _and_ chmod'ing it puts the two mode lines above
`index`/`---`/`+++`/`@@`; the parser ignores both and keeps the hunks, so the row
draws `+1 −1` and a normal body and looks completely explained. Nothing invites a
second look.

## Why it matters

Making a file executable is one of the few changes in a diff worth stopping on: a
setup or run script, a git hook, anything the app itself then executes.

It is load-bearing in this app's own data model — `scripts.ts:138` and
`repoConfig.ts:471` chmod scripts to 0755 because octopus _executes_ them, and
`docs/data.md:512` records that a script without the bit fails outright. So a
diff pane that cannot show it changing is blind to a class of change the app then
acts on. `.octopus/` scripts and `.claude/hooks/` shell scripts are exactly the
files an agent makes executable here.

There is a workaround — `git diff` in a terminal in the worktree — which is why
this is medium rather than high. But it means leaving the review pane to review.

## Evidence

- `src/core/diff.ts:418` — `flush()` pushes with `hunks` still empty; `:435`,
  `:443`, `:448`, `:453` are the four patterns that do not match.
- `src/core/diff.ts:72-82` — `FileDiff` has no field for a mode.
- `src/core/diff.ts:299`, `:781`, `:900-903`, `:989-991` — the record survives
  every stage as 0/0 with an empty hunk list.
- `src/renderer/src/components/diff/DiffFile.tsx:197-199` — counts drawn only
  when non-zero; `:300` — `DiffBody` returns null on an empty hunk list.
- `src/renderer/src/components/diff/DiffFile.tsx:266-270` — **the precedent**:
  a rename-only file is never bare, because a sibling paragraph renders "moved
  from a.ts" above the body. The pane already has a pattern for "no lines, but
  here is what happened"; a mode change is the one shape of change that falls
  into the same empty branch with no such line.
- `src/renderer/src/components/diff/DiffPanel.test.tsx:310-321` — the only test
  pinning that branch, written for a rename, where the case explains itself.

## What is already decided

**Reading the mode out of the unified diff is wrong on its own.** `attachHunks`
is skipped entirely when nothing is drawable (`diff.ts:716-718`), and inside it a
file not in `asked` is returned untouched (`:986`). A mode-only change is cheap
so it usually wins the budget race, but in a diff that has already spent
`maxFiles` it is marked `tooLarge` and never gets a block. A mode carried only by
the unified-diff parser would appear or vanish depending on how many other files
changed — intermittent behaviour, which is worse than the silence.

`--numstat` and `--name-status` do not report modes. **`git diff --raw -z` does**,
and the exact output for this case is `:100644 100755 4163036 0000000 M` followed
by the path as its own NUL-terminated field. One more command alongside the two
already in the same `Promise.all` (`diff.ts:680-684`), exact for every file
whatever the drawing budget, and the same `-z` record shape the existing parsers
handle. It would also make `typeChanged` self-describing (100644 → 120000), which
the pane currently reports as a bare `T`.

**Do not key the note off "no hunks".** An added empty file has the identical
shape — `--name-status` says `A`, the block is `new file mode 100644` with no
`@@`. That row is honest as it stands, and inferring a mode change there would
put a wrong line under it. The mode has to be read, not inferred.

## Sketch

A `chmod(join(dir, 'x'), 0o755)` case drops straight in beside the symlink test
at `diff.test.ts:742`, which already drives real git in a temp repo.

The string is user-facing: a key in `en.ts` beside `renamedFrom` (`en.ts:501`)
and its match in `uk.ts` (`uk.ts:425`). TypeScript will demand the second once
the first exists.
