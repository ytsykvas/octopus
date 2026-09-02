# The permission card cannot say why it is asking, and "always" is far wider than asked

**Found:** 2026-08-13, answering "why is it still asking for permission?" when
the mode said edits would not be. Both halves come from the same dropped
argument.

## What happens

`canUseTool` takes a third parameter, and `agent.ts` declares only two. Two
useful things go with it.

**`decisionReason`.** The card says "The agent wants to use Edit" over the file
path and stops there, so a request that looks identical to fifty silent ones has
no explanation. Measured against a live session: 59 edits under `acceptEdits`,
one request — for `.claude/skills/core-module/SKILL.md`. The CLI guards files
under `.claude/` separately, since they are the agent's own instructions, and it
says so plainly in a field we discard:

```
"Claude requested permissions to write to …/.claude/skills/demo/SKILL.md,
 but you haven't granted it yet."
```

Without it the mode looks broken. It is not, and the reader has no way to tell.

**`suggestions`.** "Always allow" writes the **tool name** into
`config.alwaysAllowedTools`, so answering it on one `.claude` file grants every
`Edit` in every workspace from then on. The SDK offers the narrow rule it
actually meant:

```json
[
  {
    "type": "addRules",
    "behavior": "allow",
    "destination": "session",
    "rules": [{ "toolName": "Edit", "ruleContent": "/.claude/skills/demo/**" }]
  }
]
```

A standing approval an order of magnitude wider than the question asked is the
kind that gets granted once and regretted quietly.

## Why it matters

§4 puts transparency first. The first half is the interface withholding the one
sentence that would explain itself; the second is it granting more than the
reader believes they are granting.

The `ExitPlanMode` entry that silently disabled plan mode for a whole day got
there by exactly this route. That one tool is kept out of the list now
(`config.ts:45`, `service.ts:3277-3287`); the width it demonstrates is
unchanged.

## Evidence

- `src/core/agent.ts:395` — `canUseTool: async (toolName, toolInput) => …`, two
  parameters where the SDK passes three.
- `sdk.d.ts:217-224` — `suggestions`, documented as what "should be returned as
  the `updatedPermissions` in the PermissionResult"; `decisionReason` —
  "Explains why this permission request was triggered"; also `blockedPath`. The
  same object carries `title` (`sdk.d.ts:225-230`), "the full permission prompt
  sentence rendered by the bridge", which the SDK says to use "instead of
  reconstructing from toolName+input" — which is what the card does.
- `src/renderer/src/components/chat/ChatLog.tsx:637-644` — the whole of the
  card's text: the title built from the tool name, and under it the path from
  `describeToolInput`.
- Verified live, not read off the types: a probe under `acceptEdits` edited an
  ordinary file with no question and was asked about `.claude/skills/…/SKILL.md`,
  with the reason and suggestion above.

## What is already decided

`config.alwaysAllowedTools` stays where it is — `config.ts:163-174` explains why
(`settingSources` may be `none`, leaving the SDK nowhere to keep it). That
reason has weakened since: `settingSources` defaults to `all` now and a stored
`none` is raised to it (`config.ts:290`, `:349`), and
`two-places-now-record-always-allow.md` reopens the question on exactly those
grounds — read the two together. Returning the suggestions as well would let the
running session stop asking too, without moving where the answer is kept.

## Sketch

Take the third parameter. Carry `decisionReason` on the `permission_request`
event and draw it under the tool name — one line, `text-ink-soft`, absent when
the SDK sends none. `title` is worth taking in the same pass: it is the sentence
the bridge already wrote, where the card's own is assembled from the tool name.

For "always", return the suggestions as `updatedPermissions` and store the
narrowed rule rather than the bare tool name. That is a change to what the
config holds, so it needs a shape that can express a path — and a migration for
the plain tool names already in there.

Worth splitting: the reason is small and self-contained; the narrowing is not.
