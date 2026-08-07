#!/bin/bash
#
# Захист головного архітектурного інваріанту: src/core/ не знає про Electron.
#
# Викликається з PreToolUse на Edit|Write. Якщо у файл всередині src/core/
# намагаються записати імпорт electron — блокує запис.
#
# Це правило легко порушити непомітно, а наслідок дорогий: ядро перестає
# тестуватися без Electron і стає неможливо винести його в CLI чи демон
# (§11.1 docs/PROJECT.md).

set -uo pipefail

input=$(cat)
file_path=$(jq -r '.tool_input.file_path // empty' <<<"$input")

[ -z "$file_path" ] && exit 0

# Правило стосується лише ядра.
case "$file_path" in
  */src/core/*) ;;
  *) exit 0 ;;
esac

# Вміст, що записується: Write має content, Edit — new_string.
content=$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$input")
[ -z "$content" ] && exit 0

if grep -qE "(from|require\()\s*['\"]electron['\"]" <<<"$content"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "src/core/ не має імпортувати electron (§11.1 docs/PROJECT.md). Ядро мусить лишатися headless, щоб тестуватися без Electron. Винеси роботу з Electron у src/main/, а в core лиши чисту логіку з типізованим інтерфейсом."
    }
  }'
  exit 0
fi

exit 0
