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

## The third obstacle, which is the expensive one

**2026-09-06.** Looked at while working through these notes, and the reason this
one was left: the two questions above have answers, and a third question the
note does not raise does not.

Both of the above are settled by **a unix socket outside the data root, named
after it**. Bind it; on `EADDRINUSE`, try to connect — a live holder accepts and
we quit, a stale one refuses with `ECONNREFUSED` and we unlink and rebind. That
is the classic algorithm and it cannot lock anybody out, which was the fear
worth having. The path goes in `os.tmpdir()` as `octopus-<hash of root>.sock`,
which is about 80 characters under `/var/folders/…/T/` and well inside 104 — and
being outside the root is right rather than a compromise, since what is locked
is the root and the lock is not part of it.

What is not settled: **nothing releases it.** `createService` has no counterpart
— there is a `closeChats`, and no `close`. So a claim taken at creation is held
for the life of the process with no defined moment to give it back, and the
suite makes 49 services. A socket dies with its process, so production is
survivable; the tests are not, because two services on one root inside one
process would be the second one refused.

So the shape of the work is: give the service a `close`, thread it through
`main`'s lifecycle and 49 call sites, **then** the lock is ten lines on top. The
lock is not the job; the lifecycle is.
