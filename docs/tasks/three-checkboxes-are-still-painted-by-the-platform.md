# Three checkboxes are still painted by the platform, not by the theme

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`styles.css` carries a `.choice` class written specifically to take checkboxes
and radios away from the platform — `appearance: none` plus a border, a fill and
a drawn tick from the tokens — and its comment says why: "`accent-color` was the
cheap version and it showed: the platform paints its own shape and its own
blue… the wrong blue on the dark theme."

There are exactly six checkbox/radio inputs in the renderer, though a grep for
`type="checkbox"` finds only four: QuestionCard's two are
`type={question.multiSelect ? 'checkbox' : 'radio'}` (`QuestionCard.tsx:165`,
`:201`). Three carry `choice` (`NewPullRequestForm.tsx:196`,
`QuestionCard.tsx:178`, `:208`) and three do not.

**They are not equally wrong**, and the difference decides the fix:

- `RepoConfig.tsx:210` is fully platform-painted — no `.choice`, no
  `accent-color` — so its checked fill is Chromium's own accent, which on macOS
  is the system highlight colour the user may have set to anything.
- `RepoConfig.tsx:334` (`accent-accent`) and `useConfirm.tsx:125`
  (`accent-danger`) do emit `accent-color`, since `--color-accent` and
  `--color-danger` are in the `@theme` block, so their _checked_ fill is drawn
  from a token. Their defect is the **unchecked** state — with no `color-scheme`
  opt-in Chromium's used colour scheme is light, so the empty box is a white
  square with a grey border on the `#0f1115` canvas — plus the size and corner
  radius, which `.choice` fixes at 0.875rem / 4px and the platform does not.

## Why it matters

In the dark theme the repository-settings list and every destructive
confirmation dialog show bright white boxes on a dark canvas — the exact symptom
`.choice` was written to kill. The confirmation checkbox is the one that carries
"also delete the branch", a control people are asked to read carefully.

The project's own stylesheet names this defect twice — once for controls, once
for scrollbars ("Left to the platform they are painted for a light page… the one
piece of chrome that ignored the palette") — which is the same repaint-by-hand
pattern these three were left out of.

Nothing malfunctions and no state is lost, so it is a rough edge rather than a
failure.

## Evidence

- `src/renderer/src/styles.css:282-289` — the comment rejecting `accent-color` by
  name; `:290-300` and `:318-339` — the rule.
- `src/renderer/src/components/RepoConfig.tsx:204-211` and `:330-335`;
  `src/renderer/src/hooks/useConfirm.tsx:119-125`.
- `src/renderer/src/App.tsx:196` and `styles.css:71-72` — the `.dark` ground the
  white box lands on.
- `color-scheme` appears nowhere in `src/`, nowhere in `index.html`, and nowhere
  in Tailwind v4's shipped `preflight.css` or `theme.css`.
- `src/renderer/src/components/pr/PullRequestPanel.test.tsx:450-457` — the one
  input that is styled has a test pinning `toHaveClass('choice')`; the three that
  are not have none.

## What is already decided

**The cause is that `.choice` is in neither list a component author consults.**
The "Ready-made classes" line at `docs/ui.md:1347` lists `.panel`, `.row`,
`.input`, `.section-label`, `.focus-ring`, `.titlebar-drag`, `.project-tinted`,
`.bubble-sent`, `.tab-selected` — no `.choice`. The same omission is in
`.claude/skills/ui-component/SKILL.md:70-79`, the skill that loads automatically
on every `src/renderer` change. Unless both lists gain the class, the next
checkbox written repeats this exactly. `Switch.tsx` was written since and says
its colours are `.choice`'s exactly (`Switch.tsx:21-23`) — a `button` cannot
take a class written for an input, so it repaints them by hand. That is a third
place carrying this look while the class itself is in neither list.

**A straight swap is wrong for `useConfirm`.** `.choice`'s checked fill is
hardcoded `var(--accent)` with the tick in `var(--on-accent)`. Dropping `choice`
onto `useConfirm.tsx:125` turns the "also delete the branch" tick from danger red
to accent blue inside a destructive dialog — a deliberate-looking signal removed.
That control needs a `.choice-danger` modifier, not a swap. `docs/ui.md:1384-1388`
treats that checkbox as a considered case, so the colour is unlikely to be
accidental.

**`color-scheme` is not a one-liner here.** `color-scheme: light` on `:root` and
`dark` in `.dark` would fix all three plus every future native control, but the
project already paints scrollbars by hand at `styles.css:201-208`, and an opt-in
would hand Chromium its own dark scrollbars on top of that. It would also change
caret and autofill painting in every `.input`. Better long-term, but it needs
reconciling in the same change.

## Sketch

`PullRequestPanel.test.tsx:450-457` is the worked example of the regression
test. The argument for why a class assertion earns its place for exactly this
class — jsdom computes no layout, so nothing else catches it — is at `:307-320`,
which is not next to it: the comment sits above an unrelated test at `:326`.
Copy that shape rather than inventing one.
