# Agent prose drawn as markdown is still drawn raw

**Found:** 2026-09-02, split off from
`a-command-can-read-one-way-on-the-permission-card-and-run-another.md` when that
one landed. The plain-string half closed there; this half did not.

## What happens

Every plain string the agent writes now goes through `shown`, so a bidi override
is named where it stands instead of reordering the line. Five surfaces still do
not, and they are the ones rendering markdown:

- `Prose` and `Thinking` (`ChatLog.tsx`) — every agent message;
- `Plan` (`ChatLog.tsx`) and `PlanDialog.tsx` — the same plan twice, and the
  dialog is where it is approved for execution;
- `QuestionCard.tsx`'s option previews.

All five go through `Markdown.tsx`, and `<ReactMarkdown>` has no hook for text
nodes — `components` maps element types, not text. So this is not "call `shown`
in five more places": it needs a rehype pass that walks the text nodes of the
rendered tree and substitutes there.

## Why it matters

`PlanDialog` is an authorising surface. Somebody reads a plan and approves it,
and an override reorders what they read while the plan the agent holds is
untouched — the same shape as the permission card, one gesture removed.

The other four are lower: a message is read, not answered. But they are the bulk
of what the pane draws, and `docs/ui.md` now says plainly that markdown does not
have this, which is honest and is also a promise to come back.

## What is already decided

A chip inside rendered markdown is a design question the plain surfaces did not
have to answer: the `shown` chip is an inline `<span>` with a background, and
inside a heading, a code fence or a table cell it has to not break the block it
sits in. `CodeBlock.tsx:60` copies `textContent` to the clipboard, so whatever is
substituted becomes what is copied — `DiffPanel.tsx:112` already records that
trade-off for the diff pane and is the precedent to follow or to depart from
deliberately.

## Evidence

- `src/renderer/src/components/chat/Markdown.tsx` — the choke point; a
  `COMPONENTS` map and no text-node hook.
- `src/renderer/src/components/chat/PlanDialog.tsx` — `<Markdown text={plan} />`
  inside the dialog that authorises it.
- `docs/ui.md` — the Trojan Source section, which now names this gap.
