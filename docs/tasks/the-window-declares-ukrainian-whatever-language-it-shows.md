# The window declares Ukrainian whatever language it is showing

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`src/renderer/index.html:2` says `<html lang="uk">`, and it survives the build
unchanged — `out/renderer/index.html:2` is byte-identical, and `main/index.ts:61`
loads exactly that file.

The interface inside it is English **by schema**, not by accident:
`DEFAULT_LANGUAGE = 'en'`, i18next is initialised with `lng: DEFAULT_LANGUAGE`,
and `config.ts:203` declares `language: LanguageSchema.default('en')` which
`createDefaultConfig` also writes.

Nothing corrects it in either direction. `App.tsx:195-197` writes to the root
element once, for the theme class only; `App.tsx:223-227` moves i18next when the
config language changes and does not touch the attribute. A grep for
`documentElement` over `src/` finds no `lang` assignment at all — so switching to
Ukrainian leaves `lang="uk"` correct only by coincidence, and switching back
leaves it wrong again.

`git log --reverse` shows `lang="uk"` arriving in the very first scaffold commit
`9c6ebca`, when the project was named maestro and written in Ukrainian. It
predates `DEFAULT_LANGUAGE = 'en'` and the whole en/uk split. A leftover, not a
decision.

## Why it matters

`lang` is the document language macOS VoiceOver reads to pick its voice and
pronunciation rules, so the default English interface is spoken with Ukrainian
phonetics. It also makes `:lang()` unusable as a styling hook, and quietly
contradicts the stated rule that English is the default.

Low: nothing is lost or corrupted, and the fix is one attribute plus one effect.

## Evidence

- `src/renderer/index.html:2`; `out/renderer/index.html:2`;
  `src/main/index.ts:61`.
- `src/renderer/src/i18n/index.ts:15` and `:24`; `src/core/config.ts:203` and
  `:301`, asserted at `config.test.ts:60` and `:112`.
- `src/renderer/src/App.tsx:195-197` and `:223-227`.
- `grep -rn documentElement src/` — six non-test hits, none a `lang` write; no
  `i18n.on('languageChanged')` handler anywhere.
- `git 9c6ebca`.

## What is already decided

**The spellcheck rationale does not hold here — leave it out.**
`src/main/index.ts:34-39` never sets `webPreferences.spellcheck`, and nothing
calls `session.setSpellCheckerLanguages`. Electron's spellchecker languages come
from the session, defaulting to the system locale, **not** from the document's
`lang`. Justify the fix on the screen-reader and `:lang()` grounds, which are
real.

(For the same reason, do not repeat the claim that the composer is the one field
with spellchecking on. There are 27 `<textarea>`/`<input>` elements in non-test
renderer code and only 11 `spellCheck={false}` attributes — the prose fields in
`PlanDialog`, `QuestionCard`, `CommentedRow` and `NewPullRequestForm` all leave
it on.)

**Editing `index.html` to `lang="en"` is only half the fix, and the wrong half
alone.** The language is switchable at runtime from Settings, so the attribute
has to follow `i18n.language`, not be hardcoded to either value.

## Sketch

An effect beside the theme one at `App.tsx:195-197`, driven by the same
`config`/`i18n` dependency as `:223-227`. Start `index.html` at `lang="en"` so
the pre-config paint agrees with `DEFAULT_LANGUAGE`.

Two constraints: coverage is 100% and enforced, so the effect needs an assertion
in `App.test.tsx` alongside the existing theme assertions at `:658`, `:671`,
`:706`; and the suite's `afterEach` at `App.test.tsx:248-252` already resets both
module-level singletons that outlive a render — a `document.documentElement.lang`
reset belongs in that same block, or the attribute leaks between tests exactly as
the comment above it warns.
