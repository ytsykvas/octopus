# The GitHub check spawns the Claude CLI it has no use for

**Found:** 2026-08-12, while wiring the "Add from GitHub" button to check the
account before opening the picker.

## What happens

Clicking **Add from GitHub** calls `accounts:status`, which is the only channel
that reports account state. That channel runs `checkAccounts`, and
`checkAccounts` queries **both** services: `claude auth status` and
`gh api user`, in parallel, each with a 15-second timeout.

So a button that only cares about GitHub starts a Claude CLI process every time
it is pressed, and waits on whichever of the two answers last.

## Why it matters

Two costs, one small and one not:

- A subprocess nobody asked for, on a click that is about something else.
- `gh api user` is a network call. On a bad connection the button sits disabled,
  reading "Checking GitHub…", for up to fifteen seconds. Worse, a user whose
  `gh` is authenticated but offline is told the account is not connected and
  sent to Settings — where the same check will keep saying the same thing, and
  there is nothing there to fix.

Neither is fatal, which is why this was not done inline. Both get worse the more
places call the check.

## Evidence

- `src/core/accounts.ts:135` — `checkAccounts` runs both in `Promise.all`
- `src/core/accounts.ts:26` — the 15-second `execFile` timeout
- `src/core/accounts.ts:109` — `checkGitHubAccount`, which is the whole of what
  the button needs and is already exported and covered
- `src/renderer/src/App.tsx` — `addFromGitHub` calls `window.octopus.accounts.status()`
- `src/main/ipc.ts:99` — the handler

## What is already decided

Checking on the click rather than holding the answer in state. A cached one goes
stale exactly when the user has just fixed the problem in Settings, which is the
worst possible moment to be confidently wrong.

## Sketch

An `accounts:github` channel calling `checkGitHubAccount` alone, with a shorter
timeout than fifteen seconds — this is a button press, and a check that has not
answered in two or three seconds has told us enough to act on.

It is small but not renderer-only: `src/core` (a narrower export), `src/main/ipc.ts`,
`src/preload/index.ts`, plus `docs/ipc.md`, which lists the channels.

Worth doing together with it: telling "signed out" apart from "could not reach
GitHub". Today `checkGitHubAccount` collapses them on purpose, and for the
Settings card that is right — but for this button they deserve different
sentences, because only one of them is fixed by signing in.
