# The skills panel is not the whole list

The panel in the composer shows three groups: the two stores octopus keeps and
whatever the checkout carries in `.claude/skills`. The agent has more than that.

Claude Code ships **bundled skills** of its own, and loads the user's
`~/.claude/skills` when the Agent setting is `all`. Neither appears in the
panel, and neither can be switched off from it.

## Why it matters

The panel reads as a list of what this conversation may reach for. It is a list
of what **octopus can see**, which is a different claim, and the difference is
invisible until somebody wonders why a skill they can see the agent using is not
on it.

## Evidence

`sessionSkills` in `service.ts` reads exactly three directories. The deny-list
it produces is passed as `skillOverrides` (`agent.ts`), which can name any skill
by the key the CLI knows it by — so nothing about the mechanism prevents the
missing two, only the enumeration does.

## What is already decided

The deny-list shape stays. An allow-list would have made this worse rather than
better: it would have hidden the bundled skills outright instead of merely
omitting them from a list.

## A sketch

`Query.supportedCommands()` answers with what the session actually has, and is
already called for the command list. It is only available once a session is
running, so it cannot be the panel's only source — but it could reconcile: read
it after the first turn, and add anything the three directories did not account
for as a fourth group.
