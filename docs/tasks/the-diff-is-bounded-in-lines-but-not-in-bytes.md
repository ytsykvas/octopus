# The diff is bounded in lines, and a line has no length

**Found:** 2026-08-14, in the review of the diff viewer.

## What happens

`DIFF_LIMITS` counts files and lines. Nothing counts bytes, and nothing bounds
untracked files at all.

Two ways that bites:

- A minified bundle or a lockfile written on one line is two changed lines, well
  under `maxFileLines`. Two thousand such lines is 20MB of diff, and `gitIn`'s
  `maxBuffer` is 32MB — past it the whole read fails and the Changes tab shows
  git's raw error rather than a diff with one file left out.
- `chooseDrawable` skips untracked files entirely, so neither `maxFiles` nor
  `maxTotalLines` ever applies to them. Every untracked file is then read whole,
  in parallel, and only measured afterwards. A workspace where `node_modules`
  is not ignored has `git ls-files --others` list every file in it, and the pane
  opens ten thousand concurrent reads.

## Why it matters

The limits exist so that a large change degrades into "this file is too large to
draw" rather than into a failure. Both paths above skip that and fail instead —
one with an error nobody can act on, the other by exhausting the machine.

## Evidence

- `src/core/diff.ts` — `DIFF_LIMITS`, and `chooseDrawable`, which begins
  `if (file.omitted !== 'none' || file.status === 'untracked') continue`.
- `src/core/diff.ts` — `readUntracked` is called through `Promise.all` over
  every path `ls-files` returned, and reads the file before checking its size.
- `src/core/git.ts:55` — `maxBuffer: 32 * 1024 * 1024`.

## What is already decided

Counts come from `--numstat` and are always exact; only how much is _drawn_ is
bounded. That separation is the good part and should survive whatever is done
here — the summary must keep telling the truth about a diff it will not draw.

## Sketch

Add a byte ceiling beside the line one and apply it to the whole read, not per
file. For untracked files: `stat` before `readFile`, cap how many are read at
once, and let them share `maxFiles` and `maxTotalLines` like everything else.
Worth checking first whether `--numstat` output alone can bound the request, so
the byte cap never has to be discovered by overflowing a buffer.
