# A quit does not wait for the record it is writing

**Found:** 2026-09-07, while closing the `ENOTEMPTY` half of
`an-app-test-fails-about-once-in-five-full-runs.md`. The service now waits for
what its sessions started; the application does not wait for the service.

## What happens

`src/main/index.ts` ends the app like this:

```ts
app.on('will-quit', () => {
  terminals.disposeAll()
  void service.closeChats()
})
```

`closeChats` is now a promise worth awaiting: it abandons the questions holding
a turn open and then waits for the transcript appends and state writes those
turns had going. `void` throws that away. Electron carries on quitting, and the
process exits with the writes wherever they had got to.

## Why it matters

A transcript is append-only JSONL, so a write cut in half leaves a partial line
that the reader will refuse — and the reader is what a reopened conversation is
drawn from. `state.json` is written atomically through `persist.ts`, so it
survives this; the transcript is the exposure.

How likely is small: quitting mid-turn, with an append in flight at that
instant. But the cost is a conversation that will not reopen, and the fix is
one line of an already-correct promise.

## What is already decided

**Not `void`.** Whatever this becomes awaits the promise.

## Sketch

`will-quit` is synchronous, so waiting means the usual Electron dance:
`event.preventDefault()` on the first pass, then `app.quit()` again once the
promise settles, with a flag so the second pass falls through. That is a real
behaviour change and the reason this is a note rather than a line in the same
commit: a quit that waits is a quit that can hang, and it needs a ceiling —
`Promise.race` against a second or two, then go anyway.

The decision worth taking with it: **how long a quit may wait.** A truncated
transcript is worse than a slow quit up to about a second, and worse than
nothing after that.

Worth doing when `main` is next opened.
