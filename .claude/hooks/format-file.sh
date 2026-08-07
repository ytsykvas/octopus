#!/bin/bash
#
# Автоформатування після кожної правки файлу.
#
# Викликається з PostToolUse на Edit|Write. Отримує JSON на stdin,
# бере шлях до зміненого файлу і проганяє Prettier та ESLint --fix.
#
# Сенс: код у репозиторії завжди відформатований, і `npm run check`
# ніколи не падає на дрібницях форматування (§11.3 docs/PROJECT.md).

set -uo pipefail

input=$(cat)
file_path=$(jq -r '.tool_input.file_path // empty' <<<"$input")

# Нема шляху — нема роботи (наприклад, інший тип інструмента).
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

# ESLint лише для коду; на json/css/md він не потрібен.
case "$file_path" in
  *.ts | *.tsx | *.js | *.jsx)
    lint_output=$(npx --no-install eslint --fix "$file_path" 2>&1)
    lint_status=$?

    if [ $lint_status -ne 0 ]; then
      # Не блокуємо — лише повідомляємо, щоб проблема не загубилася.
      jq -n --arg ctx "ESLint не зміг виправити все автоматично у $file_path:
$lint_output

Виправ ці зауваження перед завершенням задачі." '{
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: $ctx
        }
      }'
    fi
    ;;
esac

exit 0
