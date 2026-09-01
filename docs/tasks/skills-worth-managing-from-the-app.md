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
settings dialogs, and two stores of the user's own reaching a session as local
plugins. `Query.supportedAgents()` (`sdk.d.ts:2465`, still never called) is the
same move for subagents and has not been made.

**Import commands and subagents into a project.** Skills now arrive from a
folder, from pasted text and from a link — but into `~/.octopus`, never into the
repository. A catalogue that writes into a checkout's `.claude/commands/` or
`.claude/agents/` is the part still ahead, so a project gains a reviewer
subagent or a `/ship` command without anybody copying files by hand.

The obvious trap, unchanged: anything written there lands in a tracked
directory, so the same approval question that guards `.octopus/` applies — and
`repoConfig.ts`'s export is the only write octopus makes inside a checkout
today, which that feature would be the second of.
