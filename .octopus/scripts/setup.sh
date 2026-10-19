#!/bin/sh
# Dependencies only. Nothing here is shared with other workspaces: node_modules
# is installed per worktree because `postinstall` builds node-pty, and its
# spawn-helper needs the executable bit that only that build gives it.
set -e

npm ci --prefer-offline --no-audit --no-fund

# `postinstall` can fail to fetch the Electron binary without failing the
# install; fail here with the cause rather than at Run with "Electron uninstall".
if [ ! -d node_modules/electron/dist/Electron.app ]; then
  node node_modules/electron/install.js
fi
