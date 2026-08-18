# The build result is thrown away, so "built successfully" cannot be shown

**Found:** 2026-08-12, while designing the Build → Server flow.

## What happens

The build half of the Scripts tab runs `setup.sh` and shows its output. When the
process ends, the header goes back to offering the sequence — whether the script
succeeded or failed with a compile error twenty lines up.

Nothing in the app knows a build succeeded, so nothing can act on it.

## Why it matters

The intended flow is: build the project, then switch to the Server tab and start
the server. That sequence only reads as a sequence if the first step has a
visible outcome. Today both tabs look identical before and after a successful
build, and a failed build looks the same as a successful one unless you read the
terminal output yourself.

It also means a server started on top of a broken build fails in a way that
points at the server rather than at the build that actually broke.

## What has since changed

The code is no longer discarded. `Runner` in `ScriptRunner.tsx` reports it
upwards as `onOutcome(exitCode === 0)`, and `useRunSequence` uses that to decide
whether the `Run` button goes on to the server — a failed build now stops the
sequence and says so above both halves.

What is still missing is the standing answer. Outside a sequence, and after one
has finished, both halves look identical whether the last build succeeded, fell
over, or never happened. The sequence knows for the length of one run; nothing
remembers.

## Evidence

- `src/renderer/src/components/Terminal.tsx:35` — `onExit?: (exitCode: number | null) => void`.
- `src/renderer/src/components/ScriptRunner.tsx` — `onOutcome` narrows it to a boolean and keeps none of it.

## What is already decided

Running is manual, by button, on both tabs — not automatic on workspace
creation. See [setup-script-cannot-find-the-repository.md](setup-script-cannot-find-the-repository.md)
for the part of that decision that still contradicts §12.2.

## Sketch

Keep the last exit code in `Runner` and show it: succeeded, failed with a code,
or never run. Colour it with the `success` / `danger` tokens on the text, not as
a filled background — §10.7. `onOutcome` already narrows the code to a boolean
for the sequence, so it is the number itself that has to survive alongside it.

That question is settled: nothing blocks. `Run` refuses to go on after a failed
build and says so, which is the whole of it. The server half no longer has a
Start of its own — every control moved to the tab's header — so "start the
server without rebuilding" is now `Run` from an idle stage, and `Restart` once
one is up.

The obstacle this used to name is gone: `WorkspaceScripts` now keeps a runner
per workspace mounted, so state held in `ScriptRunner` survives a tab switch and
an exit code kept there would still be there when you come back.
