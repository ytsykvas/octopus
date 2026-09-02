# Every broadcast to the window is sent from the one file the suite calls bootstrap

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`src/main/index.ts` is on `bootstrapOnly`, so both configs exclude it from
coverage and it has no test file. Nothing in `src` imports it, so no test can
reach it whatever the coverage config says.

It holds the **only** send-side occurrence of six channel names: `settings:open`
(`:86`), `theme:changed` (`:110`), `chats:event` (`:116`), `workspaces:status`
(`:122`), `usage:windows` (`:128`), `chats:status` (`:134`).

Electron types the call `send(channel: string, ...args: any[])`, so neither the
name nor the payload is checked by tsc.

Reproduced: with `usage:windows` changed to `usage:window` at `:128`,
`npm run typecheck` passed both projects clean and `npx vitest run` reported 54
files / 2099 tests passed. The file appears nowhere in the coverage table.

Their listening halves are each asserted by name in `preload/index.test.ts`.
**That asymmetry is the whole finding**: because preload holds an independently
written second copy, a send-side assertion would catch a one-sided rename, the
way `EXPECTED`/`CALLS` do for the invoke channels.

`ipc.test.ts` cannot help — it asserts that `registerIpc` calls the injected
`host.broadcast*` array-pushers, which is a different fact from what string those
functions send.

`terminals.ts` is the counter-example that shows this is fixable: it pushes
through the same API from a covered module, and `terminals.test.ts:178` and
`:223` pin both its names on the send side.

## Why it matters

A channel name changed or mistyped there is invisible to the whole gate — a
second window never learns a turn ended, the sidebar's account block never moves,
⌘, opens nothing — and there is no error anywhere, because `webContents.send` to
a channel nobody listens on is a no-op.

`broadcastUsageWindows` is the newest of the five and has **never been executed
by a test**. `713d623` is the sharpest illustration: it added tests to
`service.test.ts`, `ipc.test.ts` and `preload/index.test.ts`, and the one hunk it
left untested is the `main/index.ts` one.

This is not the excluded "this line is untested" category — the 100% threshold
does not apply to this file, so the guarantee that normally makes that a
non-finding is exactly what is absent.

**`settings:open` is worse off than the other five.** It is absent from
`docs/ipc.md` entirely — the table documents four streams and closes "None of the
four is a `handle`" — so it has no send-side test _and_ no documentation. It is
also the only one sent via `getFocusedWindow()?.webContents.send` rather than a
loop, so it is not a broadcast at all and would not be found by anyone grepping
for the broadcast pattern.

`docs/testing.md:38-41` describes the exclusion as files "each a line that mounts
something". That was true of `main/index.ts` once; it is 248 lines now.

## Evidence

- `vitest.shared.ts:18`; `src/main/index.ts:86, 110, 116, 122, 128, 134` — each
  the only occurrence of its name in the repository.
- `node_modules/electron/electron.d.ts:18339` — `WebContents.send`.
- `src/main/ipc.test.ts:105-109`, `:1959`, `:1976` — the bench asserts the arrays,
  never a channel string.
- `src/preload/index.test.ts:422, 473, 488, 564, 587, 605` and
  `src/preload/index.ts:72, 276, 293, 310, 329, 540` — the independently written
  second copy that makes a send-side assertion able to catch drift.
- `docs/testing.md:38-41`.

## What is already decided

**Do not write a `main/index.test.ts` that mocks `electron` and asserts the whole
file.** `main/index.ts` is the composition root, and `IpcHost` exists precisely so
`ipc.ts` is testable without Electron. A test that re-mocks `app`,
`BrowserWindow`, `Menu`, `nativeTheme`, `dialog` and `shell` to assert that
`createWindow` calls `loadURL` restates the code and constrains nothing — the
failure mode `docs/testing.md:72` exists to warn about.

So the startup-failure dialog, the `did-start-loading` teardown and the
`window-all-closed` platform branch stay out of scope: they are wiring.
`watchSystemTheme`'s `theme !== 'system'` guard (`:146`) is the one borderline
case — a real behavioural branch with a stated intent, "an explicit choice must
not be overridden when macOS switches" — but it is second in line behind the
names.

**One existing task file still needs touching in the same pass.**
`six-channel-names-cross-the-bridge-unchecked.md` has been amended already: it
now says "The subscription side has no equivalent hole on the listening half"
and sends the reader here for the send half, so the two no longer contradict
each other. `four-places-count-nine-host-functions-and-there-are-ten.md` is
untouched, and already identified the process gap this sits in: `docs/ipc.md`'s
"Adding a channel" checklist has four steps and none covers a push stream.
**That checklist is where the durable fix lives** — adding a test without adding
the step means the seventh channel repeats this.

## Sketch

Lift the five `broadcast*` functions, the menu's `settings:open` send and
`watchSystemTheme` into a small module beside `terminals.ts` that takes its
window list as a parameter, the way `focusExisting` already does. `terminals.ts`
demonstrates the pattern: a `WebContents` seam a test fills with an object
collecting `sent` pairs.

Then `index.ts` really is the line that mounts something, the channel names get
asserted on both sides, and the `bootstrapOnly` entry and the
`docs/testing.md:38` sentence become true again.

`the-clone-destination-is-never-told-to-the-window.md` refers to
`src/main/index.ts:110,116,122,128,134`, so its line references need updating if
they move.
