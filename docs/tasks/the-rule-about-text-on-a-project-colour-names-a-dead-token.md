# The one rule about text on a project colour names a token nothing can reach

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`docs/ui.md:1221` and `.claude/skills/ui-component/SKILL.md:160` both promote, as
one of "two rules that are easy to get wrong":

> **Text on a filled colour uses `--project-ink`**, not `#fff`. The dark theme
> uses brighter values on purpose, where white is barely legible.

`--project-ink` is declared twice in `styles.css` (`:53`, `:101`) and referenced
by nothing. It is also outside the `@theme inline` block, so no
`text-project-ink` utility exists.

Git settles it: `git log -S 'var(--project-ink)' --all` returns two commits
besides `08a4cdf`, which added this note — `8335b40` added the token, and
`4e03d08` ("the active tab flows into the sidebar") deleted its only consumer,
replacing
`{ backgroundColor: 'var(--project-color)', color: 'var(--project-ink)' }` with
the 18% wash now at `ProjectTabs.tsx:175-176`.

So the rule, the token, and the `styles.css:99-100` comment explaining the dark
value by "text on a filled tab goes dark rather than white" all survived the
treatment they were written for. The same document describes the replacement wash
forty lines later, so `ui.md` carries both the current design and the rule the
design retired.

## Why it matters

The docs promote this to a rule precisely because it is easy to get wrong, and
the rule as written cannot be followed: the utility name does not exist and
produces nothing rather than an error.

Low, though — nothing renders wrongly today. The harm needs someone to draw a
saturated project fill, reach for a named utility instead of the inline idiom
every other project-colour site uses, and not look at the result.

## Evidence

- `src/renderer/src/styles.css:53` and `:101` — declared in plain `:root` and
  `.dark`, outside `@theme inline` (`:119-158`).
- `src/renderer/src/styles.css:99-100` — the comment justifying the dark value by
  a treatment deleted in a commit.
- `git 4e03d08` and `git 8335b40`.
- `.claude/skills/ui-component/SKILL.md:158-161` — the same rule word for word,
  in the skill that auto-loads on every `src/renderer/**` change.
- `src/renderer/src/components/chat/ChatTabs.tsx:171` —
  `after:bg-[var(--project-color)]`, the codebase's actual idiom: an arbitrary
  value, not a named utility. `text-[var(--project-ink)]` would compile today.
- `src/renderer/src/components/ProjectSettings.tsx:429-431` — the one saturated
  project fill left, the colour-picker swatch. It carries no content (selection
  is a ring), so the rule has no consumer there either.
- No Tailwind ESLint plugin is wired in, so nothing would flag an unknown utility
  class.

## What is already decided

Three corrections to how this first read, all of which change the fix:

1. **The dark-theme symptom is the other way round.** In `.dark`,
   `--project-ink` is dark `#0f1115` and `--ink` is light `#e7eaee`, so a class
   that emits nothing gives _light_ text on a _bright_ project colour — the
   "white is barely legible" outcome the rule exists to prevent.
2. **The token's values are not stale, only unreferenced.** They remain correct
   for a saturated fill.
3. **`text-project-ink` is not "the natural way to obey".** No `--project-*`
   token is in `@theme`, the same `ui.md` paragraph says these are "applied by
   setting `--project-color` inline on a container", and the codebase's idiom is
   an arbitrary value or an inline style — both of which work with
   `--project-ink` unchanged.

**The wrong fix is easy to identify:** adding `--color-project-ink` to
`@theme inline` so `text-project-ink` resolves, while leaving the rule as
written. That creates a utility no code exercises and no coverage can catch, on a
token whose only correct use is over a fill the design deliberately abandoned.

**Deleting the token is not free.** `.claude/skills/docs-check/SKILL.md:63`
documents a palette check reasoning "counting `--project-` in the stylesheet
gives 32 … `--project-ink` is a text colour, not one of them". Removing the token
changes that arithmetic. Worth noting separately: that grep already returns 42,
not 32, because `--project-color` now appears on ten lines of the wash rules,
three of them comments — so the skill's guidance is independently stale, and a
fix here is the natural moment to correct it. The skill's own advice applies to
itself: "verify the check before believing what it says about the document."

## Sketch

Either keep the token and rewrite the rule to say when a fill is still drawn (the
swatch) and that it is applied inline like every other `--project-*` value, or
drop token, rule and comment together and let `ui.md`'s wash section stand as the
whole story.

**The rule text lives in two files that must move together** — `docs/ui.md:1221`
and the skill. Editing only the doc leaves the copy a future session actually
reads still teaching it. The `styles.css:99-100` comment is a third site: its
brightness rationale is still valid on its own ("the light values read as mud
here") and only the trailing clause is dead.
