#!/bin/sh
# No set -e: this cannot stop the removal, so a failed line must not
# skip the lines after it.
#
# Gives back the data root run.sh made for this workspace's dev copy.
# node_modules sits inside the worktree and goes with it.
: "${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"
rm -rf "$HOME/.octopus-dev/$OCTOPUS_WORKSPACE_SLUG"
