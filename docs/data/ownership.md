# One process owns this directory

Writes to `state.json` and `config.json` are serialised — `commit` and
`applyConfig` in [`service.ts`](../../src/core/service.ts) chain them — and each
one is written to a temp file and renamed, so a crash cannot leave a truncated
file behind. Both are about **one** process. Neither is exclusive. A change
that hands `commit` the state back as it was writes nothing: a status set to
what it already is, a session id announced again by a slash command — several
a turn — used to serialise and write the whole file to the same bytes.

Two copies of the app open the same file, hold it in memory and write it whole,
so the last writer wins: what the other window did is not merged and not
refused, just absent the next time it saves. That was observed rather than
feared — one window created a workspace while the other still held one it had
removed, and removing that stale record then failed on a worktree already gone.
Losing a record is worse than failing to write one, because the worktree and the
branch survive on disk, invisible to the app that made them.

So `src/main/index.ts` takes Electron's single-instance lock before the app is
ready. A second launch quits and brings the window already open forward, and
never builds a service at all. The lock is keyed on Electron's userData
directory rather than on `~/.octopus`, and those are not the same scope: two
builds resolving that name differently each take their own and both start.

**So the data root has a lock of its own**, keyed on `~/.octopus` itself and
taken in `main` before the service is built — losing it must mean never having
opened `state.json` at all. It is a unix socket in `os.tmpdir()`, named after a
hash of the root: outside what it locks, because the lock is not part of it, and
short enough for the 104 characters a socket name may have.

A socket rather than a pid file, and that is the whole design. A pid file left
by a crash locks the user out of their own data until they find and delete it,
and a pid can be reused by something else entirely. A socket cannot be stale in
a way that refuses anybody: bind, and if the address is taken, **connect** to
it — a live holder accepts, a dead one's socket refuses, and the refused one is
removed and rebound. Nothing has to decide whether a process is alive by looking
at a number.

It is also the layer a CLI or a daemon would get for free, having no Electron
and therefore no lock at all.

**A copy can be given a root of its own.** With `OCTOPUS_DATA_DIR` set to an
absolute path, `rootDir()` returns it instead of `~/.octopus`, and `main` moves
Electron's userData inside it before asking for the lock. Both locks are then
keyed on a place the real app never uses, so a development copy runs beside it
and neither can overwrite the other's `state.json`. The copy starts empty — no
projects, no global skills, default settings — which is also what makes it safe
to reproduce a bug in. A relative path throws at startup: ignoring it would put
the copy back on the real data. The packaged app never sets it. The Scripts
tab's `run.sh` for this repository sets it per workspace, under
`~/.octopus-dev/<slug>`, and `archive.sh` removes it.

Editing these files from outside while the app runs is the same hazard reached
another way: the app keeps its own copy in memory and will happily write over
anything changed underneath it.
