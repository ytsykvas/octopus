#!/usr/bin/env bash
# Gathers the current state of every Conductor source the references are built from,
# so a human can diff it against what those references claim and update them by hand.
# It deliberately rewrites nothing.

set -uo pipefail

APP="/Applications/Conductor.app"
OUT="${1:-${TMPDIR:-/tmp}/conductor-refresh}"
mkdir -p "$OUT"

echo "== Installed app =="
if [[ -d "$APP" ]]; then
  version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null)
  echo "version:   ${version:-unknown}   (references were written against 0.80.0)"
  echo "binary:    $(file -b "$APP/Contents/MacOS/conductor" 2>/dev/null)"
else
  echo "not installed — bundle sources unavailable, docs still work"
fi

echo
echo "== Bundled plain-text artefacts (the readable implementation) =="
if [[ -d "$APP/Contents/Resources" ]]; then
  find "$APP/Contents/Resources" -maxdepth 3 \( -name '*.sh' -o -name '*.md' -o -name '*.json' \) \
    -exec sh -c 'printf "%6s  %s\n" "$(wc -l < "$1" | tr -d " ")" "${1#'"$APP"'/Contents/Resources/}"' _ {} \;
  echo
  echo "compiled helpers:"
  ls "$APP/Contents/Resources/bin/.internal" 2>/dev/null | sed 's/^/  /'
fi

echo
echo "== Docs =="
docs="$OUT/conductor-docs.md"
if curl -fsSL https://www.conductor.build/llms-full.txt -o "$docs"; then
  echo "saved:     $docs ($(wc -l < "$docs" | tr -d ' ') lines)"
  echo "pages:"
  grep -c '^# ' "$docs" | sed 's/^/  /'
else
  echo "fetch failed — check the network"
fi

for schema in settings.schema.json settings.repo.schema.json settings.toml.json; do
  if curl -fsSL "https://conductor.build/schemas/$schema" -o "$OUT/$schema"; then
    echo "saved:     $OUT/$schema"
  fi
done

echo
echo "== This user's Conductor config =="
[[ -f "$HOME/.conductor/settings.toml" ]] && echo "settings:  $HOME/.conductor/settings.toml"
[[ -d "$HOME/.conductor/projects" ]] && echo "projects:  $(ls "$HOME/.conductor/projects" | wc -l | tr -d ' ') workspace entries"

cat <<EOF

== Next ==
Compare against references/, update what drifted, then move the "as of" version
in SKILL.md and at the top of each reference file.
Page titles:  grep '^# ' $docs
EOF
