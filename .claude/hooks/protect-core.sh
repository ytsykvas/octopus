#!/bin/bash
#
# Protects the main architectural invariant: src/core/ knows nothing about Electron.
#
# Invoked from PreToolUse on Edit|Write. If an electron import is about to be
# written into a file under src/core/, the write is blocked.
#
# This rule is easy to break unnoticed and expensive when broken: the core stops
# being testable without Electron and can no longer be extracted into a CLI or
# daemon (§11.1 docs/PROJECT.md).

set -uo pipefail

input=$(cat)
file_path=$(jq -r '.tool_input.file_path // empty' <<<"$input")

[ -z "$file_path" ] && exit 0

# The rule applies to the core only.
case "$file_path" in
  */src/core/*) ;;
  *) exit 0 ;;
esac

# Content being written: Write has content, Edit has new_string.
content=$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$input")
[ -z "$content" ] && exit 0

if grep -qE "(from|require\()\s*['\"]electron['\"]" <<<"$content"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "src/core/ must not import electron (§11.1 docs/PROJECT.md). The core has to stay headless so it can be tested without Electron. Move the Electron work into src/main/ and leave pure logic with a typed interface in core."
    }
  }'
  exit 0
fi

exit 0
