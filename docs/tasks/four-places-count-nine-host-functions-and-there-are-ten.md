# Four places count nine host functions on an interface that has ten

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`IpcHost` declares ten members — `handle`, `showOpenDialog`, `windowFor`,
`prefersDark`, `broadcastTheme`, `broadcastChatEvent`, `broadcastWorkspaceStatus`,
`broadcastUsageWindows`, `broadcastChatStatus`, `openPath` — and the test bench
supplies all ten.

Four places say nine: `docs/architecture.md:31`, `docs/testing.md:250`,
`docs/ipc.md:258`, and **the interface's own doc comment at `src/main/ipc.ts:81`**,
three lines above the members it miscounts.

The origin is precise: at `eb79498` the interface genuinely had nine members and
"nine" was correct; `713d623` added `broadcastUsageWindows` as the tenth and
updated none of the four.

The seven-name enumeration at `docs/ipc.md:256-257` is a **separate and older**
defect, not a consequence of that commit: at `eb79498` it already listed seven of
the then-nine members, omitting `broadcastWorkspaceStatus` and
`broadcastChatStatus`. That paragraph has been internally inconsistent — a list
of seven introduced by the word "nine" — since the day it was written.

## Why it matters

Nothing at runtime depends on the number, so this is low. But it is the exact
trap the project has already been bitten by and written a rule about, five lines
below one of the wrong counts: `docs/testing.md:255` — "A number written into
prose here does not: this said 49 for long enough to be wrong by half, which is
why neither document counts them any more."

Nothing typechecks a number in prose, and nothing can. `EXPECTED` and `CALLS`
guard channel names, not host arity.

## Evidence

- `src/main/ipc.ts:85-131` — the ten members, at lines 86, 90, 95, 96, 98, 106,
  113, 115, 123, 130; `:81` — the wrong count in code.
- `src/main/ipc.test.ts:95-114` — the bench's `host` literal supplies all ten, so
  the suite is the proof of the count.
- `docs/architecture.md:31`; `docs/testing.md:250`; `docs/ipc.md:256-258`;
  `docs/testing.md:255`.
- `eb79498` and `713d623`.

## What is already decided

**Writing "ten" in four places re-arms the same trap**, and `docs/testing.md:255`
already says so in the project's own words. The right edit is to stop counting:
"it takes `IpcHost` — a named set of functions — rather than importing
`ipcMain`, `dialog`, `BrowserWindow` and `nativeTheme`" in architecture.md,
"supplies the host as small functions" in testing.md, and in ipc.md either the
full ten names or none.

`src/main/ipc.ts:81` must be fixed in the same pass, or the count is stale again
on the next broadcast. It is the one site a reader is most likely to trust.

**The "someone reinvents the push pattern" worry does not survive reading the
rest of ipc.md.** The four broadcast streams are documented at length at
`docs/ipc.md:155-183`, each with its own paragraph, closing with "None of the
four is a `handle`, so none is counted among the channels above." A contributor
adding a fifth reads that, not the injection rationale. The `IpcHost` enumeration
is a throwaway list in a paragraph about why Electron is injected. This is doc
drift worth fixing, not a trap that misteaches.

## Sketch

There is a real gap one paragraph over, and it is the part worth acting on:
`docs/ipc.md:243-252`'s "Adding a channel" checklist has four steps and none of
them is "add the `IpcHost` member and the `webContents.send`". A push stream has
no checklist at all — it needs a new host member, a `webContents.send` in
`main/index.ts`, and a subscribe/unsubscribe pair in preload. Adding that
sequence is worth more than correcting the number.
