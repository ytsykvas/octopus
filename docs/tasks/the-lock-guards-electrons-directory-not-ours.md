# The single-instance lock guards Electron's directory, not ours

**Found:** 2026-08-15, while adding the lock that closed
`two-windows-overwrite-one-state-file.md`.

## What happens

`app.requestSingleInstanceLock()` is keyed on Electron's **userData** directory.
What two processes actually share is `~/.octopus`, and the two are not the same
scope. Two builds with different userData paths each take their own lock, both
succeed, and both then write `state.json` whole — the original failure, reached
by a route the lock does not watch.

How wide the gap is depends on the build. A dev run was checked and uses
`--user-data-dir=~/Library/Application Support/octopus`, which a packaged build
of the same name shares — so those two do lock against each other today. What
does not is anything that resolves the name differently: this machine also has
`~/Library/Application Support/Electron` from an earlier run, and two builds
sitting either side of that split would both start.

## Why it matters

A guarantee that holds for the builds we happen to run today, for a reason
nobody stated, is the kind that fails the first time the reason changes — and
this one fails silently, into the same lost records as before.

The certain half is a future CLI or daemon, which `docs/PROJECT.md` §11.1 keeps
`src/core/` extractable for. It has no Electron and therefore no lock at all,
while writing to exactly the same `state.json`.

## Evidence

- `src/main/index.ts:216-233` — `requestSingleInstanceLock`, and the comment
  above it saying what it does not reach.
- `src/core/paths.ts:19` — `rootDir` is `~/.octopus`, nothing to do with
  userData.
- `src/core/service.ts:998` — `commit` serialises writes within one process
  only.

## What is already decided

The Electron lock stays: it is the friendly half, quitting silently and bringing
the open window forward, and nothing here should turn a second launch into an
error dialog.

## Sketch

A claim on the data root in `src/core/`, taken by `createService` before the
state is read and released when it closes — testable, and the layer a CLI would
get for free. Two things make it more than a one-liner, and both should be
settled before starting:

- **Staleness.** A pid file is simple and can lock the user out after a crash if
  the pid has been reused. A unix socket has no such problem — a stale one
  refuses connections — but `node:net` binds it to a path.
- **That path.** A socket path is limited to 104 characters on macOS, and the
  service's own tests point at `mkdtemp` directories under `/var/folders/...`
  which come close. Whatever is chosen has to survive the test suite, not only
  `~/.octopus`.
