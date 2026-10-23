# Colour

Tokens only, declared twice — `:root` and `.dark` — in
[`styles.css`](../../src/renderer/src/styles.css). **Never a raw hex in a
component**, or the dark theme breaks.

Scrollbars are themed from `:root` with `scrollbar-color`, which inherits and so
reaches every scrolling box including xterm's viewport. Left to the platform they
are painted for a light page, and a pale bar down the side of a dark chat was the
one piece of chrome ignoring the palette.

Surfaces: `canvas` → `surface` → `muted`, separated by `line` and `line-strong`.
Text: `ink` → `ink-soft` → `ink-faint`. Status colours apply to text and icons;
only the paired `*-bg` is used as a background.

Two places put one on a surface anyway, and the test for both is the same: the
colour is the thing rather than a mark on it. `Button`'s `destructive` variant
fills with `danger`, because a button that deletes something is the warning. The
filled part of a `UsageBar` drawn as a `limit` is the other — a bar in the ink
colour beside a number in `danger` would be one gauge contradicting itself, and
both readings come from `usageLevel` in `chat/format.ts`, the only place the
thresholds live. Anywhere the colour would merely _label_ a row, it goes on the
text or the icon and the `*-bg` goes behind it; the status dot beside a
conversation is the icon case, not a third exception.

A `share` bar — which skill used the most of a week — stays neutral however high
it goes. It is a proportion of something that is not running out, and drawing it
in red would be the interface raising an alarm about a fact.

## Project colours

Fifteen, `--project-<name>`, one pair per theme. The colour is **stored on the
project**, not derived from its name — a hash would repaint a project the moment
it was renamed, and constancy is what makes it recognisable.

Applied by setting `--project-color` inline on a container. That inline style is
the sanctioned exception: the value is dynamic, but still resolves to a token.

The colour is one half of a project's mark; the other is what sits inside the
tab. By default that is two initials, which collide readily — two repositories
starting the same way give the same pair — so a project can be given an icon
instead, chosen in its settings dialog. The ids live in
[`icons.ts`](../../src/core/icons.ts) and the renderer maps each to a drawing in
`ProjectGlyph`, typed as a full `Record` so an id with nothing to draw fails the
type check rather than leaving a hole in the strip.

**The letters are the project's colour a quarter of the way towards the ink**,
whether the tab is chosen or not. They were the colour alone on the chosen tab
and the colour mixed with `--ink-faint` on the rest, and measured over the
fifteen colours in both themes the worst case on the idle tile was 3.3:1 in the
light theme (lime) — under the 4.5:1 text needs, and these are letters. With the
ink in the mix every colour is at least 5.2:1 on an idle tile and 4.8:1 on the
chosen one in the light theme, 6.1:1 and 5.7:1 in the dark one. A quarter, not
more: the tab is how a project is recognised, and the further the mix goes towards
the ink, the more the fifteen look alike. One constant, `LETTERS`, serves both
states.

Two rules that are easy to get wrong:

- **There is no `project-` utility class.** No `--project-*` token is in
  `@theme`, so `text-project-blue` compiles to nothing at all — no error, no
  colour, and no Tailwind lint wired in to say so. Reach for the value the way
  the rest of the code does: an arbitrary value like
  `after:bg-[var(--project-color)]`, or an inline style.
- **Measure contrast, do not judge it.** Five colours looked fine and sat
  between 3.3:1 and 4.1:1 against white — under the 4.5:1 body text needs.
