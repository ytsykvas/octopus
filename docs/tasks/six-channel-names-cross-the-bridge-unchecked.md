# Six channel names cross the bridge unchecked

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

The preload suite guards channel names in `CALLS`, which calls a method and
asserts the exact channel. A second list, `REMAINING`, covers the six methods
`CALLS` leaves out — `accounts.signOut`, `terminal.write`, `terminal.resize`,
`terminal.dispose`, `projects.saveInstruction`, `projects.addFromGitHub` — and
asserts only `expect(invoke).toHaveBeenCalled()`. **No channel string appears in
its loop at all**, so it passes for any name whatsoever.

Its own comment claims the opposite: "Every method is a channel name that must
match main/ipc.ts. Calling each one is the only way to find a name that drifted."

Checked mechanically: `preload/index.ts` issues 96 distinct invoke channel names,
`CALLS` asserts 90, and the six-name difference is exactly those.

The main-side list cannot cover for it — `EXPECTED` is read only against
`bench.handlers`, which `registerIpc` filled; that file never touches
`preload/index.ts`. There is no shared channel-name constant and no union type:
every channel is a bare string literal on both sides, so the compiler contributes
nothing.

Reproduced rather than reasoned: with `'instructions:save'` typo'd at
`src/preload/index.ts:666`, the preload suite reports 112 passed, `ipc.test.ts`
125 passed, and both `tsc --noEmit` projects are clean.

## Why it matters

`docs/ipc.md:247-250` tells the next person that `EXPECTED` and `CALLS` "are what
catch a name that drifts between the sides — a mismatch otherwise appears only at
runtime, and says only 'no handler registered'". For these six that protection
does not exist.

A typo in any of them ships with a fully green `npm run check`, and surfaces as a
dead Sign out button, an instruction that never saves, a clone that never starts,
or a terminal that takes no keystrokes.

`terminal.write` and `terminal.resize` are the worst two: they are
`void ipcRenderer.invoke(...)`, so a drifted name produces an unhandled rejection
nobody observes — no toast, no console path a user would look at, keystrokes
simply vanish. The other four return the promise, so at least a rejection
surfaces somewhere.

## Evidence

- `src/preload/index.test.ts:497-513` — `REMAINING`, the six entries; `:515-520`
  — the loop; `:495-496` — the comment that claims otherwise.
- `src/preload/index.test.ts:399` — the real guard `CALLS` performs.
- `src/main/ipc.test.ts:276-373` and `:375-383` — `EXPECTED`, read only against
  `bench.handlers`.
- `src/preload/index.ts:107-113` — `terminal.write`/`resize` as fire-and-forget.
- All six names are correct **today** (`main/ipc.ts:182, 192, 196, 202, 383, 707`
  register exactly those), so nothing is broken right now. The finding is that a
  guard the suite advertises does not exist.

## What is already decided

`REMAINING` is not entirely inert — the `method()` helper throws "the bridge
exposes no X.Y" if a method vanishes, and `toHaveBeenCalled()` catches a method
that stops calling main at all. What it cannot catch is the one thing its comment
says it exists to catch.

**The subscription side has no equivalent hole on the listening half**, so the
fix here is narrow: all eight `ipcRenderer.on` channels are asserted by name. But
their **send** half is a separate hole — see
[every-broadcast-is-sent-from-the-file-the-suite-calls-bootstrap.md](every-broadcast-is-sent-from-the-file-the-suite-calls-bootstrap.md),
which is why that sentence must not be read as "the subscriptions are covered".

**This is not a broken process.** `docs/ipc.md:245-250` step 3 already instructs
that a new channel goes into both `EXPECTED` and `CALLS`; the gap is six
historical ones that predate or slipped past that rule.

## Sketch

Move all six into `CALLS` as `[name, call, channel]` and delete the `REMAINING`
array and its loop. It is referenced nowhere else. The enclosing
`describe('the rest of the surface')` keeps its other tests, which stand alone.
`terminal.write`/`resize` returning void is not an obstacle: the `CALLS` tuple
types the call as `() => unknown`.

**The durable half is deleting the misleading comment**, not just adding entries —
otherwise the next person reads it and trusts a guard that is gone again the next
time somebody parks a method in a second list.

A stronger fix if it is wanted: the two lists are still maintained
independently, so `CALLS` and `EXPECTED` can drift as a pair. Sharing one
channel-name fixture between the two test files would close that, but it is a
larger change than this finding needs.
