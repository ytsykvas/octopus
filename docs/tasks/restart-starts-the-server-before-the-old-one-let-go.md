# Restart starts the server before the old one has let go

**Found:** 2026-08-19, while making a session's shutdown reach the whole process
group.

## What happens

`Restart` ends the running session and starts a new one in the same commit.
Ending it is now polite — SIGTERM to the process group, so the server runs its
shutdown handler and removes its pid file — and politeness takes time. A Rails
server needs a moment to close its listener; the new `run.sh` does not wait for
it.

So the second server binds while the first still holds the port, and the press
fails with the very message the group-signalling was meant to end:

```
A server is already running (pid: …, file: …/tmp/pids/server.pid).
Exiting
```

or, once the pid file has gone but the socket has not:

```
Address already in use - bind(2) for "127.0.0.1" port 3000 (Errno::EADDRINUSE)
```

Stop-then-Run does not hit it: two presses put a person's own reaction time
between the two halves, which is longer than the shutdown.

## Why it matters

`Restart` exists for the one thing people do most while working — the code
changed under a running server and needs picking up. Failing intermittently, and
failing with a message about somebody else's server, is worse than not offering
it: the reader goes looking at their own script.

It also undoes the fix above it. The whole point of SIGTERM over SIGHUP was that
the server gets to clean up; racing it means the cleanup it was given time for
has not finished when the next start looks.

## Evidence

- `src/main/terminals.ts` — `dispose` signals and returns; nothing reports when
  the group is actually gone.
- `src/renderer/src/components/Terminal.tsx` — the cleanup calls
  `terminal.dispose` on unmount and cannot await it.
- `src/renderer/src/components/ScriptRunner.tsx` — `start` bumps `run`, which
  remounts `Terminal`: the old one's cleanup and the new one's `create` are one
  commit apart, with no exit in between.
- `src/renderer/src/hooks/useRunSequence.ts` — `restart` bumps the server token
  and nothing else; the sequence has no state for "stopping".

## Sketch

Make the restart two steps that the sequence sequences, rather than one that
hopes. A `stopping` stage: `restart` stops the half and waits, and the server
token is bumped only when the half reports it has gone.

That needs a half to say so. `Runner` already reports through `onOutcome` when a
process exits; the stop path sets `started` false and reports nothing, so the
smallest honest version is for it to report there too, and for `finished` to
carry the sequence from `stopping` to the next start.

Worth deciding at the same time: whether `dispose` should answer when the group
has actually ended rather than when it has been signalled. `main` knows — the
pty's `onExit` is right there — and a channel that resolves on the exit would
let the renderer stop guessing. It is the same knowledge
[the-renderer-forgets-what-is-running-but-it-keeps-running.md](the-renderer-forgets-what-is-running-but-it-keeps-running.md)
asks for, from the other end.

Do not answer it with a delay before the new start. A timer long enough for
Rails is long enough to feel broken, and still too short for whatever is slower.
