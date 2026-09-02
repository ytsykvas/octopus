# A tool failure loses its line breaks; the note beside it keeps them

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`ToolFailure` and `PlanNote` sit twenty lines apart in `ChatLog.tsx` and draw the
output of the same helper, `readFailure`. `PlanNote` carries
`whitespace-pre-wrap`; `ToolFailure` does not, so the browser's default
`white-space: normal` collapses every newline into a space.

Nothing upstream flattens them: `describeToolResult` passes a string result
through verbatim and joins text blocks with `'\n'`, and `readFailure` only trims
the ends and splices the middle. The newlines survive all the way into the JSX
and die at the CSS.

Nothing supplies the class from elsewhere either — `styles.css` is the renderer's
only stylesheet and sets no `white-space` anywhere, Tailwind v4 preflight does
not set it on `p`, and no ancestor carries a `whitespace-*` class.

## Why it matters

`toolFailure.ts` states the intent plainly — a failure is "one of the few things
drawn in full, because it is the one the user has to act on" — and shortens from
the middle specifically so the first line naming what failed and the last
sentence saying what to do both survive. **Both of those are lines**, and the
rendering destroys the line structure the shortening was designed to preserve.

The project's own written rule says the same thing one file away:
`Markdown.tsx:84-90` enables `remarkBreaks` so a single newline stays a line
break, arguing that Markdown's paragraph rule "is wrong for everything that
arrives here… joined into a paragraph the numbers run into the sentence that
follows them and the reading order stops being obvious. The agent writes to the
same expectation, since every other surface its output is read on breaks on a
newline." The failure row is agent output on the same surface, and it is the one
place that rule is not applied.

Low, because `MAX_LENGTH = 400` bounds the damage to roughly two to four wrapped
lines rather than a wall of text, and the full text is still on disk in the
transcript. `ToolFailure` has no `title` attribute, though, so there is currently
no in-app way to see the original structure at all.

## Evidence

- `src/renderer/src/components/chat/ChatLog.tsx:594` — the failure paragraph,
  `... font-mono text-[11px] break-all`, no whitespace class; `:615` — `PlanNote`,
  the sibling, with `whitespace-pre-wrap`; `:214-222` — the case that routes to
  one or the other.
- `src/core/agent.ts:691-700`; `src/renderer/src/components/chat/toolFailure.ts:22`
  with `toolFailure.test.ts:43-47`.
- `src/renderer/src/components/chat/Markdown.tsx:84-90` — the stated rule.
- `src/renderer/src/styles.css:160-210` — the whole `@layer base`, no whitespace
  rule.
- `src/renderer/src/components/chat/ChatLog.tsx:325` — `wrap-anywhere`, the class
  already chosen in this file for exactly this wrapping problem.
- No test touches whitespace on either paragraph.

## What is already decided

**`whitespace-pre-wrap` alone half-solves it.** `break-all` is
`word-break: break-all`, which is what makes a long unbreakable path wrap at all
— but on a `white-space: normal` paragraph it also chops ordinary words
mid-character. The pair wanted here is `whitespace-pre-wrap` plus
`wrap-anywhere`, not `whitespace-pre-wrap` plus the existing `break-all`.

**The class must not be `whitespace-pre`.** The pane it sits in is
`overflow-auto`, which is precisely how
`an-unbroken-line-from-the-agent-scrolls-the-log-sideways.md` describes a
paragraph turning into a sideways scroll of the whole conversation.

**Do not "fix" `ToolCall` at `ChatLog.tsx:517-521`.** It draws the same
`describeToolInput` output with `truncate` and a tooltip, and that single line is
deliberate — the `Plan` component's own comment contrasts "the tool row's single
line" with the frame a plan gets.

Nothing here touches i18n: both paragraphs render model output, not interface
text.

## Sketch

**A second place has the same defect and it is sharper.** `PermissionCard` draws
its target at `ChatLog.tsx:643` with the same `break-all` and no whitespace
class, and `describeToolInput`'s second-priority field is `command`. A multi-line
Bash command — a heredoc, a chain broken across lines — is shown as one run,
broken mid-word, on the card asking whether to allow it. Approving a command you
cannot read the shape of is worse than reading a failure. Fix both in one change.

That card is also the subject of
`a-command-can-read-one-way-on-the-permission-card-and-run-another.md`, so the
two want doing together.
