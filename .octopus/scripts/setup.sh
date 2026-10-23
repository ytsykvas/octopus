#!/bin/sh
# Dependencies only. Nothing here is shared with other workspaces: node_modules
# is installed per worktree because `postinstall` builds node-pty, and its
# spawn-helper needs the executable bit that only that build gives it.
set -e

npm ci --prefer-offline --no-audit --no-fund

# npm skips install scripts it has no `allowScripts` entry for and only warns,
# so a build that did not run surfaces later as a terminal that will not open
# with `posix_spawnp failed`. Fail here with the cause instead.
if [ ! -x node_modules/node-pty/build/Release/spawn-helper ]; then
  echo "node-pty was not built: check allowScripts in package.json, then run" >&2
  echo "  npx electron-builder install-app-deps" >&2
  exit 1
fi

# Electron has had no `postinstall` since 42: it fetches its binary the first
# time something requires it. Fetch it now, so a network failure shows up here
# rather than at Run as "Electron uninstall".
if [ ! -d node_modules/electron/dist/Electron.app ]; then
  node node_modules/electron/install.js
fi
