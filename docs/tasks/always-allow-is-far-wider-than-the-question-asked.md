# "Always allow" is far wider than the question asked

**Found:** 2026-08-13. **Narrowed:** 2026-09-06, when the other half of
`the-permission-card-cannot-say-why-it-is-asking.md` landed. That half was small
and self-contained — the card now draws `decisionReason` — and this one is not,
which is why they were split.

## What happens

"Always allow" writes the **tool name** into `config.alwaysAllowedTools`. So
answering it on a question about one file under `.claude/` grants every `Edit`
in every workspace from then on.

The SDK offers the narrow rule it actually meant, in the same third argument the
reason came from:

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
kind that gets granted once and regretted quietly. §4 puts transparency first,
and this is the interface granting more than the reader believes they are
granting.

The `ExitPlanMode` entry that silently disabled plan mode for a whole day got
there by exactly this route. That one tool is kept out of the list now
(`config.ts:45`, `service.ts:3277-3287`); the width it demonstrates is
unchanged.

## Evidence

- `sdk.d.ts:207-217` — `suggestions`, documented as what "should be returned as
  the `updatedPermissions` in the PermissionResult".
- `src/core/agent.ts` — `canUseTool` now takes the third argument and reads
  `decisionReason` from it. `suggestions` sits beside it, unread.
- `src/core/service.ts` — `askPermission` returns `{ allow: true }` for anything
  in `config.alwaysAllowedTools`, matched on the bare name.

## What is already decided

`config.alwaysAllowedTools` stays where it is for now — `config.ts:163-174`
explains why (`settingSources` may be `none`, leaving the SDK nowhere to keep
an answer). That reason has weakened since: `settingSources` defaults to `all`
and a stored `none` is raised to it (`config.ts:290`, `:349`), and
`two-places-now-record-always-allow.md` reopens the question on exactly those
grounds. **Read the two together** — whoever takes either up should decide both,
because the answer to "how narrow is the rule" and the answer to "where does it
live" are one design.

Returning the suggestions as `updatedPermissions` would let the running session
stop asking without moving where the answer is kept, which is the cheap half.

## Why it is not an afternoon

Storing a narrowed rule is a change to what the config holds: it needs a shape
that can express a path beside a tool name, and a migration for the plain tool
names already in there. It also needs an answer to what Settings shows, since
the list there is currently a row per tool name and would become a row per rule.
