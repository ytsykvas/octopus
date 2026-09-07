# Skills worth managing from the app

Asked for directly on 2026-08-19, while deciding that octopus is a harness over
Claude Code rather than a filter on it: _"пізніше реалізуємо імпорт скілів в
додаток й зручне вмикання та вимикання. Заготовані команди та промпти та інші
цікаві штуки."_

Three features, in the order they build on each other. **The first two have
shipped**; what is left is the third.

**See what is loaded.** Done — the project settings dialog lists what the agent
picks up on its own (`instructionSources.ts`).

**Switch skills on and off, per project.** Done, and per conversation rather
than per project: a Skills panel in the composer's attic, default marks in both
settings dialogs, and two stores of the user's own reaching a session as extra
working-directory roots (`agent.ts:82`). The checkout's own `.claude/skills` is
a third scope (`skillNames.ts:19`): read and switchable, never written.
`Query.supportedAgents()` (`sdk.d.ts:2470`, still never called) is the same move
for subagents and has not been made.

**Import commands and subagents into a project.** Skills now arrive from a
folder, from pasted text and from a link — but into `~/.octopus`, never into the
repository. A catalogue that writes into a checkout's `.claude/commands/` or
`.claude/agents/` is the part still ahead, so a project gains a reviewer
subagent or a `/ship` command without anybody copying files by hand.

## Measured, 2026-09-07 — the checkout does not come into it

The paragraph above assumed a catalogue must write into `.claude/commands/` or
`.claude/agents/` inside the repository, and therefore inherit the approval
question that guards `.octopus/`. A probe against a live session says otherwise.

A command and a subagent placed under an **additional root** — the same
mechanism the two skill stores already reach a session by — are both picked up:
`supportedCommands()` listed the command, and `supportedAgents()` listed the
subagent beside the built-in ones. So a catalogue writes where skills already go,
`~/.octopus`, and octopus goes on making exactly one kind of write inside a
checkout: `repoConfig.ts`'s export.

Which leaves the feature much smaller than it looked, and shaped like the skill
import that already exists — a folder, pasted text or a link, landing in a store
rather than in somebody's repository. The approval question does not arise.

**`supportedAgents()` is real and answers.** The note above called it "still
never called"; it is still never called, but it is no longer unverified — it
returns the subagents a session holds, by name, which is the same reconciliation
the skills panel now does.

What is left to decide is only what a catalogue _is_: a list somebody browses, a
paste box, or a link — and whether commands and subagents get panels of their
own or ride the skills one.
