# A run folded to two steps opens on three

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`drawsNothing` returns true for an `AskUserQuestion` tool call, so the call is
swept into a run of ordinary tool calls rather than breaking it. `toolCount`
leaves it out of the total, because `isToolRow` excludes it.

But `ToolRun`'s body maps **every** entry in the block that is a `tool_use` and
draws a `ToolCall` for each — the question call included. So the summary and the
contents are counted by two different rules over the same block: the disclosure
says "2 steps" and opens on three rows, the third reading `AskUserQuestion` with
nothing beside it, because none of `describeToolInput`'s fields appear in a
question's input.

That is precisely the row `AgentRow` returns null for when the same call is not
folded, with the comment "Drawn as a tool row it was the same question twice:
once as a name with no readable arguments, and once as the thing to answer."

Reproduced: rendering with Grep, Grep, AskUserQuestion, permission_request gave a
summary reading `2 steps`, and after clicking it the document contained
`<span class="font-medium">AskUserQuestion</span>`.

**Narrower than "every turn that asks a question."** It needs a counted tool row
immediately before the question, with no prose, failure, edit, plan or permission
card between them, and two counted rows in the run altogether — the second may
come after the question, as it does in the guard test's own fixture. If the
assistant explains before asking, the `text` event flushes the run first. If the
run holds that one real call and nothing else, `flush()` sees `toolCount === 1`
and pushes an `entry` block built from the call alone; the question goes with the
rest of the run and never reaches `AgentRow`.

## Why it matters

The count on a fold is the only thing a reader has to decide whether to open it.
Opening it then shows a step that says nothing and that nobody can act on,
sitting above the card that asks the same question properly.

The rule the file states for the unfolded path is quietly not kept for the folded
one — and the test that guards the count models exactly this state (Grep,
AskUserQuestion, Read), asserts only `getByText('2 steps')` and **never opens the
disclosure**. Its own comment says a counted question "would promise a row that
nothing inside it accounts for", which is the inverse of what happens.

## Evidence

- `src/renderer/src/components/chat/ChatLog.tsx:374-394` — `toolCount(entries)`
  for the summary, then `entries.map(...)` for the body. Two rules, one block.
- `src/renderer/src/components/chat/ChatLog.tsx:203-206` — the unfolded path
  returns null, with the comment.
- `src/renderer/src/components/chat/toolRuns.ts:138-148`, `:74-82`, `:156-158`,
  `:222-228`.
- `src/renderer/src/components/chat/toolSummary.ts:13-22` — `SummarySchema` looks
  for file_path/command/pattern/path/url/description; a question's input has
  `questions`, so the folded row is a bare name.
- `src/renderer/src/components/chat/ChatLog.test.tsx:993-1008` — the guard test.
- Nothing upstream filters: `handleEvent` records the question's `tool_use` like
  any other, `config.ts` keeps `ASK_USER_QUESTION` out of standing approvals so
  the permission request always follows, and the agent's stream loop maps
  assistant blocks synchronously, so the `tool_use` is emitted before
  `canUseTool` raises the request.

## Sketch

**Do not add a `readQuestions` check inside `ToolRun`'s map** — that is a third
copy of the same rule, and the drift between the count and the body is what
caused this.

`isToolRow` is not exported. The right shape is to export one predicate (or a
`toolRows(entries)` helper) from `toolRuns.ts` and have both `toolCount` and
`ToolRun`'s body go through it, so the number and the rows cannot disagree again.

Watch the `key={index}` in the map if the list is filtered: keys should stay tied
to the entry's position in the block, not to the filtered index, since
`groupToolRuns` uses position as identity for the whole log.

Questions are the only case today — a plan call and a change call both fail
`drawsNothing`, so they break a run and can never sit inside one. But any future
entry added to `drawsNothing` that is also a `tool_use` inherits this, which is
another reason to make the two sides share one predicate.

Extend `ChatLog.test.tsx:998` to click the summary and assert the body's row
count; as written it cannot see this.
