#!/bin/bash
#
# Auto-format after every file edit.
#
# Invoked from PostToolUse on Edit|Write. Receives JSON on stdin, takes the
# edited file path and runs Prettier and ESLint --fix over it.
#
# Purpose: code in the repository is always formatted, and `npm run check`
# never fails over formatting trivia (§11.3 docs/PROJECT.md).

set -uo pipefail

input=$(cat)
file_path=$(jq -r '.tool_input.file_path // empty' <<<"$input")

# No path, no work (e.g. a different tool type).
[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

case "$file_path" in
  *.ts | *.tsx | *.js | *.jsx | *.json | *.css | *.md)
    npx --no-install prettier --write "$file_path" >/dev/null 2>&1
    ;;
  *)
    exit 0
    ;;
esac

# ESLint only for code; json/css/md do not need it.
case "$file_path" in
  *.ts | *.tsx | *.js | *.jsx)
    lint_output=$(npx --no-install eslint --fix "$file_path" 2>&1)
    lint_status=$?

    if [ $lint_status -ne 0 ]; then
      # Not blocking — just surface it so the problem is not lost.
      jq -n --arg ctx "ESLint could not fix everything automatically in $file_path:
$lint_output

Resolve these before finishing the task." '{
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: $ctx
        }
      }'
    fi
    ;;
esac

exit 0
