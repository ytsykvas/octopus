# A command can read one way on the permission card and run another

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`PermissionCard` computes `target = describeToolInput(input)` — for a Bash
request that is the `command` field, taken straight off the model's tool input —
and prints it as a bare text node. `ToolCall` does the same for every folded tool
row.

Neither passes it through `shown()`, the function this very file imports and uses
two functions away for the change block's path and lines, whose comment names the
reason: "a bidi override reorders what is read without changing what runs".

So the browser applies the Unicode bidirectional algorithm to that text node, and
U+202A–U+202E reorder the command on screen while the string handed back to the
agent is untouched. `invisible.ts:31` already holds the regexp that catches
exactly these characters.

Verified by rendering `ChatLog` twice. A `permission_request` for Bash with
`command: "echo safe # ‮rm -rf /"` came back `{ raw: true, marker: false }` — the
override still in the DOM, no `U+202E` chip. The same character in an `Edit`'s
`file_path`, which routes to `ChangeBlock`, came back `{ raw: false, marker: true }`.
**Two surfaces in one file, one defended and one not, and the undefended one is
the one with the Allow button.**

## Why it matters

The permission card is the one place in the app where a person authorises a
command to run against their working tree, and the only place the command is read
before it runs. The diff pane, which authorises nothing, is defended; the card
that authorises everything is not.

**"Always allow" is wider than it looks.** `service.ts:3283-3285` writes
`request.toolName` into `config.alwaysAllowedTools`, and `askPermission`'s first
line is `if (config.alwaysAllowedTools.includes(toolName)) return { allow: true }`.
So answering "Always allow" on a misread Bash command does not widen approval for
that command — it silently approves **every future Bash call in every
workspace**, unasked. The misread text is the pretext for a grant that has
nothing to do with it.

`title={target}` on the folded row is not a fallback a careful user could check:
a tooltip's text is laid out by the same bidirectional algorithm. There is
currently no surface in the app that displays the true bytes of a command before
it runs.

## Evidence

- `src/renderer/src/components/chat/ChatLog.tsx:633` and `:643` — the target,
  drawn raw; `:512`, `:519-520` — the same in `ToolCall`.
- `src/renderer/src/components/chat/ChatLog.tsx:466-469` — the comment naming
  bidi as the reason; `:471` and `:502` — the two `shown()` calls, both inside
  `ChangeBlock`; `:21` — the import.
- `src/renderer/src/components/diff/shown.tsx:19-20` — `shown` returns the text
  unchanged when `hasInvisible` is false, so calling it costs nothing on ordinary
  commands.
- `src/renderer/src/components/chat/toolSummary.ts:71-81` — the zod schema is
  `z.string().optional()`: it constrains the type, not the code points, and
  `.trim()` does not touch U+202E.
- `src/core/service.ts:1602-1621` and `:1607`, `:3283-3285`.
- No `dir`, `unicode-bidi` or `isolate` anywhere in the renderer; `index.html`
  carries only `lang="uk"`, and `dir=ltr` does not neutralise an explicit
  override. `break-all` and `truncate` are word-breaking and overflow, not bidi.
- `docs/ui.md:1089-1108` — the Trojan Source section, which scopes the defence to
  the diff pane and the chat's change block and does not mention this card.

## What is already decided

**The obvious fix has a type trap.** `shown` returns `React.ReactNode`, not
`string`. Wrapping the card's target is a one-liner, but doing the same in
`ToolCall` breaks `title={target}`, since `title` takes a string — and keeping
the raw string in `title` is not a fix, because the tooltip reorders identically.
That row needs the title dropped, or set from a separately-computed plain-text
replacement. `describeToolInput` returns `string | null`, so the null check stays
outside the call.

`docs/ui.md:1106-1108` goes stale with the fix: it says "`shown` … is the one
place this is decided, and the chat's change block calls it too", and that
enumeration becomes wrong the moment the card joins. `docs-check` reads it.

## Sketch

**Four more undefended surfaces in the same pane**, all drawing model-authored
text and none calling `shown`:

- `Plan` / `Markdown.tsx` and `PlanDialog.tsx` — a plan is agent-written prose
  the user reads and then approves for execution. Same authorising gesture, same
  exposure.
- `QuestionCard.tsx` — the questions and their options come from the agent.
- `PlanNote` (`ChatLog.tsx:613`) and `ToolFailure` (`:592`), drawing
  `readFailure(content)`.

So the narrowest correct fix is probably not "add `shown` to the card" but "the
chat pane draws agent-authored text through `shown` everywhere", with the card as
the urgent case.

Worth doing alongside `a-tool-failure-loses-its-line-breaks.md`, which touches the
same two paragraphs for a different reason.
