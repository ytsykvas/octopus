# Three locale keys have no caller

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

Three keys in `en.ts`/`uk.ts` are reached by nothing, each orphaned by an
identifiable commit that removed its last `t()` call and left the key behind:

- **`scripts.placeholder`** (`en.ts:311` / `uk.ts:281`) — commit `470b177`
  replaced `placeholder={t('scripts.placeholder')}` with an inline
  `placeholder="#!/bin/sh"`, now the single occurrence at
  `ProjectSettings.tsx:542`.
- **`sidebar.projects`** (`en.ts:13` / `uk.ts:15`) — commit `ec37bb6` removed
  `<span className="section-label">{t('sidebar.projects')}</span>` when the
  project list became a vertical tab strip.
- **`project.env`** (`en.ts:200` / `uk.ts:189`) — commit `295bfc7` removed
  `label={t('project.env')}` when a project gained named variable sets;
  `ProjectSettings.tsx:663-664` now uses `project.envOf`/`project.envHint`.

Found by flattening `en.ts` to its leaf paths and matching each against every
quote-delimited dotted literal in `src/renderer/src` — not just `t()` calls,
since keys travel through constant maps like `SECTIONS` and `STATUS_LABELS`.

## Why it matters

`docs/ui.md:1436` names this exactly: "Delete a key when its last caller goes…
it survives every check: `en.ts` types `uk.ts`, but nothing types either against
the code."

That is what happened three times, and no check can see it. The cost lands on
whoever translates next: three strings to render into a third language that will
never appear on screen.

Low — dead code plus a documented-convention violation, not a failure a user can
hit.

## Evidence

- `src/renderer/src/i18n/locales/en.ts:13`, `:200`, `:311` and `uk.ts:15`,
  `:189`, `:281`.
- `src/renderer/src/components/ProjectSettings.tsx:542`, `:663-664`.
- `git 470b177`, `git ec37bb6`, `git 295bfc7`.
- `docs/ui.md:1432` and `:1436` — the two rules.
- `FileEditor.test.tsx:193-195` asserts the placeholder prop renders but passes
  the literal itself, so it constrains nothing about `ProjectSettings`.

## What is already decided

**Do not wire `t('scripts.placeholder')` back in.** Every other placeholder in
the renderer is an inline literal with no locale key at all —
`ProjectSettings.tsx:570` (`'.env\nconfig/master.key'`), `:665`
(`'MYSQL_HOST=dev.example…'`), `settings/SkillImport.tsx:159` (`"https://"`). The
working convention is that a placeholder which is a literal code example is code,
not prose, and `uk.ts:281` confirms it by "translating" `#!/bin/sh` to itself.
Restoring the key would make one of four sibling placeholders localised and leave
three inline, which is worse than the current state.

**Delete all three from both locale files.** That satisfies `docs/ui.md:1436` and
leaves the inline example placeholders consistent with each other.

Note `uk.ts:255` also defines `env: 'Env'` under a different block — that one is
live. Only the `project:` one is dead.

## Sketch

Two traps for whoever does this:

- a naive flatten-and-grep reports a fourth dead key, `panel.it`. It is a false
  positive scraped from the comment at `en.ts:319-320`; a leaf-key parser has to
  skip comment bodies.
- `project.env` is invisible to substring matching, because `project.envOf`,
  `project.envHint` and `project.envFile` all contain it. The search has to be
  quote-delimited or it reports only two dead keys and misses this one.

**Nothing enforces the rule**, which is how three separate commits each left a
key behind with no check complaining. A renderer test that flattens `en.ts` and
asserts every leaf key appears somewhere in `src/renderer/src` would close the
class rather than the instance, and would have caught all three.
