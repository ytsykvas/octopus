# The build result is thrown away, so "built successfully" cannot be shown

**Found:** 2026-08-12, while designing the Build → Server flow.

## What happens

The Build tab runs `setup.sh` and shows its output. When the process ends, the
button returns to "Run again" — whether the script succeeded or failed with a
compile error twenty lines up.

Nothing in the app knows a build succeeded, so nothing can act on it.

## Why it matters

The intended flow is: build the project, then switch to the Server tab and start
the server. That sequence only reads as a sequence if the first step has a
visible outcome. Today both tabs look identical before and after a successful
build, and a failed build looks the same as a successful one unless you read the
terminal output yourself.

It also means a server started on top of a broken build fails in a way that
points at the server rather than at the build that actually broke.

## Evidence

- `src/renderer/src/components/Terminal.tsx:35` — `onExit?: (exitCode: number | null) => void`. The code is already delivered to the caller.
- `src/renderer/src/components/ScriptRunner.tsx:110-112` — the handler takes no argument and only clears `running`. The exit code is discarded one line before it becomes useful.

## What is already decided

Running is manual, by button, on both tabs — not automatic on workspace
creation. See [setup-script-cannot-find-the-repository.md](setup-script-cannot-find-the-repository.md)
for the part of that decision that still contradicts §12.2.

## Sketch

Keep the last exit code in `ScriptRunner` and show it: succeeded, failed with a
code, or never run. Colour it with the `success` / `danger` tokens on the text,
not as a filled background — §10.7.

Open, and worth deciding before building: whether the Server tab should _block_
on a missing or failed build, or merely say so. Blocking is tempting and
probably wrong — restarting a server without rebuilding is an ordinary thing to
want, and §4 says no step is mandatory. A line of text on the Server tab saying
the last build failed is likely the whole feature.

Note the state cannot survive today anyway: `ScriptRunner` is remounted on every
tab switch. [right-panel-kills-running-scripts.md](right-panel-kills-running-scripts.md)
has to land first, or the exit code is forgotten the moment you leave the tab.
