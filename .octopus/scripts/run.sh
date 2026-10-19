#!/bin/sh
# The dev server. Vite picks the first free renderer port by itself and
# electron-vite has no flag to pin one, so $OCTOPUS_PORT is not used.
#
# The copy gets a data root of its own. Two copies of the app on one
# ~/.octopus overwrite each other's state.json, which is why the app refuses to
# start a second one; a separate root is what lets this run beside the real
# Octopus without touching its data. It starts empty, and archive.sh removes it.
set -e

: "${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"
export OCTOPUS_DATA_DIR="$HOME/.octopus-dev/$OCTOPUS_WORKSPACE_SLUG"

exec npm run dev
