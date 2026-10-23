#!/bin/sh
# Formats the file an Edit or Write just touched, so `npm run format:check`
# never fails on an agent's change. Runs as a PostToolUse hook; its stdin is
# the hook's JSON. It never blocks: every early exit is a quiet 0.
#
# A hook turns the right to write a file into the right to run code, so the
# surface is kept small: the path is canonicalised and must sit inside the
# project, no configuration is read from the tree (a `.prettierrc` an agent
# has just written could name a plugin, and a plugin is code — the options
# below mirror `.prettierrc` and `format:check` fails when they drift), and
# only the prettier this project installed is used: the same binary
# `npm run check` runs, so the hook adds no code path the gate lacks.
#
# The prettier it runs lives in node_modules, which an agent could replace;
# that is accepted. `Edit(node_modules/**)` is denied in settings.json, and
# an agent that can run Bash can run that binary itself — the deny guards the
# file tools, which is the path an agent without Bash has.
set -eu

command -v jq >/dev/null 2>&1 || exit 0
command -v realpath >/dev/null 2>&1 || exit 0
file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] || exit 0

root=$(realpath "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null) || exit 0
file=$(realpath "$file" 2>/dev/null) || exit 0
case "$file" in
  "$root"/vendor/* | "$root"/node_modules/* | "$root"/.git/* | "$root"/.claude/*) exit 0 ;;
  "$root"/*) ;;
  *) exit 0 ;;
esac

# A fresh worktree has no node_modules until setup.sh has run; `npx` would
# try to download prettier instead, so only the installed one is used.
prettier="$root/node_modules/.bin/prettier"
[ -x "$prettier" ] || exit 0

cd "$root"
"$prettier" --no-config --no-editorconfig --write --ignore-unknown --log-level warn \
  --no-semi --single-quote --trailing-comma none --print-width 100 --tab-width 2 \
  --arrow-parens always --end-of-line lf "$file" >/dev/null 2>&1 || true
exit 0
