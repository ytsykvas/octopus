# A finished check says how long it took instead of whether it passed

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`ChecksList` renders one span for two different facts: `{took ?? t(state.labelKey)}`.
`duration` returns null when one of the two stamps is null, and also when the
span between them is not finite or is negative — and a GitHub Actions job is
mapped with both stamps present, because a `CheckRun` only reaches a finished
state through `status === 'COMPLETED'`, which carries a completion stamp.

So for every finished Actions check the duration wins and `passed` / `failed` /
`skipped` is never drawn. The visible row reads `test  ✕  1m4s`.

Two narrow escapes leave the word on screen: a completion stamp that arrives
empty or as Go's zero time becomes null in `moment()`, and two stamps that came
back out of order make the span negative. Neither happens to a run that finished
normally.

It is confined to Actions rows: `statusContext()` hardcodes `completedAt: null`,
so `duration` returns null for every Commit Status API row and the word always
renders there.

Three independent sources say that is not the intent:

- the module's own docstring — "Both, always. A colour and a glyph reach nobody
  using a screen reader, and the row is also the only handle a test has on which
  state a check is in";
- the inline comment **two lines above the bug** — "The word carries the state
  for anything not looking at colour; the duration is **beside** it";
- `docs/ui.md:815` — "**A check's state is a word as well as a mark**, and so is
  the review's verdict." The verdict half is kept
  (`PullRequestSummary.tsx:87-89`); the checks half is not.

## Why it matters

The checks list is what the pane is read for before merging, and for the common
case a red cross and `1m4s` is the whole of what a failure says.

The state usually still reaches a screen reader through the link's
`aria-label={`${check.name} — ${t(state.labelKey)}`}`, drawn whenever
`check.url !== null`. A row that carries the state nowhere at all needs a
finished CheckRun with an empty `detailsUrl` — the schema permits it, but it is
the rare case.

**The test that claims to cover this is why nobody noticed.** "Draws each check
with the word for its state, not only a colour" builds its failed row as
`{ workflow: 'Lint', state: 'failed', completedAt: null }` — a shape the mapper
**cannot produce at all**: a non-null `workflow` means a CheckRun, and a CheckRun
is only `failed` when completed, which brings a stamp. Meanwhile the `failing()`
fixture sets both stamps and is rendered by five panel tests that assert nothing
about the row's text. So the branch that actually ships is unasserted while
coverage stays at 100%.

## Evidence

- `src/renderer/src/components/pr/ChecksList.tsx:89-94` — the comment and the JSX
  that contradicts it; `:74` — `took`; `:8-14` — the docstring; `:102` — the
  `aria-label`.
- `src/core/pullRequestShapes.ts:141-143`, `:161-169` and `:177,183`.
- `src/renderer/src/components/pr/time.ts:56-62` and `time.test.ts:34-64` —
  `duration` behaves exactly as specified; the fault is at the call site.
- `src/renderer/src/components/pr/PullRequestPanel.test.tsx:550-577`, `:57-66`,
  and `:826, 834, 849, 869, 884`.
- `docs/ui.md:815`; `src/renderer/src/components/pr/PullRequestSummary.tsx:87-89`.

## What is already decided

**"Passed and failed differ only by colour" is not true for a sighted reader.**
`aria-hidden` removes the glyph from the accessibility tree, not from the screen,
and `Check`, `X`, `Minus` and a spinning `CircleDashed` are four different
shapes. `aria-hidden` on a decorative icon that has a text equivalent is the
right call — the defect is that the text equivalent is displaced.

**The row's layout is what the `??` was buying off.** It is `flex items-center
gap-2` with a truncating name in `min-w-0 flex-1` and this fixed-width
`shrink-0 font-mono text-[11px]` column; two readings widen it on every row. A
visually-hidden span carrying `t(state.labelKey)` is cheaper and satisfies the
docstring, but **not** `docs/ui.md:815`, which promises a visible word. Pick one
and make the doc and the code agree, rather than fixing only the code.

The failure is still detectable by other means: `PullRequestActions` raises "Fix
the checks" only when a check is failed, so a red suite announces itself with a
button as well as a colour.

## Sketch

They are two facts and want two spans: the word always, the duration beside it
when there is one.

**The test must be rewritten, not supplemented**, or the hole reopens.
`PullRequestPanel.test.tsx:550-577` must build its failed row from a shape the
mapper can produce — `failing()` already is one. While rewriting it, the `lint`
fixture's `workflow: 'Lint'` + `state: 'failed'` + `completedAt: null`
combination should go: it is unreachable through either half of the rollup union,
and a fixture modelling a state the system never produces is itself a finding
under the house rules.

The duration column is untested end to end — no renderer test asserts `1m4s` or
the link's `aria-label` anywhere in the panel suite — so whatever is written
should assert both readings, not only the one that regressed.
