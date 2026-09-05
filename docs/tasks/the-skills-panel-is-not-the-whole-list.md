# The skills panel is not the whole list

The panel in the composer shows three groups: the two stores octopus keeps and
whatever the checkout carries in `.claude/skills`. The agent has more than that.

Claude Code ships **bundled skills** of its own, loads the user's
`~/.claude/skills`, and loads any plugin's. None appears in the panel, and none
can be switched off from it.

## Why it matters

The panel reads as a list of what this conversation may reach for. It is a list
of what **octopus can see**, which is a different claim, and the difference is
invisible until somebody wonders why a skill they can see the agent using is not
on it.

## Evidence

`sessionSkills` (`service.ts:2060`) reads exactly three directories
(`service.ts:2076-2080`), and only when `settingSources` includes `project`
(`service.ts:2074`) — so under "load nothing" the panel is empty while the
agent may still be holding the bundled skills. The deny-list it produces is
passed as `skillOverrides` at the call site, which can name any skill by the key
the CLI knows it by — so nothing about the mechanism prevents the missing ones,
only the enumeration does.

## What is already decided

The deny-list shape stays. An allow-list would have made this worse rather than
better: it would have hidden the bundled skills outright instead of merely
omitting them from a list.

## Measured, 2026-09-06 — the source is `reloadSkills`, not `supportedCommands`

This note used to suggest reconciling against `Query.supportedCommands()`. A
probe against a live session says that is the wrong call, and names the right
one.

**`conversation.reloadSkills()` answers with the list.** Its response is
`{ skills: SlashCommand[] }` (`sdk.d.ts:3852`), and standing in a temporary
directory with no project skills at all it came back with the bundled and plugin
ones by name — `dataviz`, `update-config`, `keybindings-help`, `code-review`,
`loop`, `run`, `init`, `security-review`, `pr-review-toolkit:review-pr`,
`commit-commands:commit`, `frontend-design:frontend-design` — with a description
and an `argumentHint` each. Standing in this checkout it came back with 25,
including this repository's own by bare name.

**`supportedCommands()` is the wrong one** because it mixes skills with built-in
commands and nothing in `SlashCommand` tells them apart: 53 entries in the same
checkout where `reloadSkills` gave 25.

**`refreshSkills()` already makes this call and throws the answer away**
(`agent.ts:518-523`). That is the whole of the plumbing that is missing.

**A path-scoped skill is legitimately absent.** `core-module` and
`ui-component` carry `paths:` in their frontmatter and are **not** in the
session's list, while the seven skills beside them in `.claude/skills` are. So
the reconciliation runs one way only: extras the directories do not account for
are a fourth group, and a directory entry missing from the session list is not
an error and must not be drawn as one.

## What is left, and why it is not an afternoon

`SkillListing extends SkillEntry`, which demands `folder` and `path`
(`skills.ts:71-141`). A session skill has neither — we do not know where it
lives — and both are what every read, edit and delete in the Settings screens is
addressed by. So the listing needs a shape where those are absent rather than
empty, and the screens need to stop offering to edit a row that has no folder.

The other half is timing. The list exists only once a session is running, so the
fourth group appears after the first message and not before. That is honest and
it is what the panel should say, but it is a state the panel does not have
today.

Enabling and disabling should work unchanged: `skillOverrides` names a skill by
the key the CLI knows it by, and the probe shows that key is the bare name for
an ordinary skill and `plugin:skill` for a plugin's.
