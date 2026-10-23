# Running a development copy

What `npm run dev` does that a first run does not expect, and how to get out
of each case. Most of this was learned by an agent restarting the app and
seeing the old build come back.

## Two copies cannot share a data root

Only one copy of the app runs on `~/.octopus`: it takes Electron's
single-instance lock, and two copies writing `state.json` whole would each win
in turn. The packaged `/Applications/Octopus.app` holds the same lock. While
either is open, `npm run dev` builds, prints `DevTools listening` and exits 0
with no window — that is the lock, not a failure.

Give the copy a data directory of its own and the two never meet:

```bash
OCTOPUS_DATA_DIR=/some/absolute/dir npm run dev
```

It starts empty — no projects, no settings — and keeps everything there, which
also makes it the only safe place to reproduce a bug. The path must be
absolute. If octopus is the project open in octopus, the Scripts tab's Run
sets this for you (`.octopus/scripts/run.sh`).

## Only the renderer hot-reloads

A change under `src/main/`, `src/preload/` or any core module they import
reaches the app only after `npm run dev` is restarted. A fix that looks
ineffective may simply not be loaded.

## Stopping the old copy

`pkill -f "electron-vite dev"` kills the dev server but not the Electron
process it spawned, and the next `npm run dev` then loses the lock and quits —
with the old build focused and no error at all. Kill the app by its path:

```bash
pkill -f "octopus/node_modules/electron/dist"
until ! pgrep -f "octopus/node_modules/electron/dist" >/dev/null; do sleep 1; done
```

Never `pkill Electron`: that matches every Electron app on the machine, the
editor included. Wait for `pgrep` to come back empty before starting again —
it takes a few seconds, and a fixed `sleep 2` was not enough.

An agent run by a dev copy inherits `ELECTRON_EXEC_PATH`, so a copy it starts
from a workspace runs the main checkout's binary and matches the maintainer's
own copy by path. Stop that one by pid instead (`lsof -a -d cwd -p <pid>`
names the worktree).

## The environment an agent inherits

An agent run by a dev copy also inherits `ELECTRON_RENDERER_URL`. Anything it
launches — a built app, a Playwright driver — then loads the _running_ dev
server's renderer: the main checkout's window over this worktree's core, every
change to `src/renderer` invisible and nothing reporting why. Strip the
`ELECTRON_*` variables from the environment of anything you launch.

## The running app holds the state in memory

Editing `~/.octopus/state.json` from outside while the app runs makes the two
disagree, and the app will happily act on its stale copy. Never reproduce a
bug against the real data root; point the copy at a temporary one as above.

## Native modules and the Electron binary

`node-pty` is native, and `postinstall` builds it with
`electron-builder install-app-deps` — the same tool that packages the app, so
installing and packaging cannot disagree about the binding. It is built
through Node-API, so the binary is **not** tied to Electron's ABI; the same
file loads in plain Node and in Electron. If the terminal will not open, the
build is the first thing to suspect:

```bash
npx electron-builder install-app-deps
```

The shipped prebuild cannot replace that build, and the reason is not the ABI:
npm does not preserve the executable bit on the `spawn-helper` beside
`pty.node`, so `pty.fork` fails with `posix_spawnp failed`. That message means
"the build did not run", and the command above is the fix.

Since npm 11.20 a dependency's install scripts run only if `allowScripts` in
`package.json` names it; anything else is skipped with an
`npm warn install-scripts` line at the end of the install, and the install
still succeeds. The field is the reviewed list: `node-pty` and `esbuild` are
allowed, `electron-winstaller` (Windows packaging only) and `fsevents` (it
ships its binary) are denied. Entries are by name, not version, so a version
bump does not bring the skip back. After adding a dependency,
`npm install-scripts ls` shows what is still unreviewed, and
`npm install-scripts approve <pkg> --no-allow-scripts-pin` or
`npm install-scripts deny <pkg>` records the decision. The project's own
`postinstall` is not a dependency's and always runs.

Electron is not among them: since 42 it has no install script and fetches its
binary the first time something requires it. When that fetch has not happened
or failed, a successful build is followed by `npm run dev` failing with
`Error: Electron uninstall`, or with `spawn .../Electron.app/... ENOENT` when
`dist/` survived holding only `LICENSE` and `version`. Check for the app
itself, not the directory:

```bash
ls node_modules/electron/dist/Electron.app   # must exist
node node_modules/electron/install.js
```

`.octopus/scripts/setup.sh` checks for a workspace that `spawn-helper` is
executable and that the app is there, and fetches the app when it is not.
