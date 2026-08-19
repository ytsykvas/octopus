# Skills worth managing from the app

Asked for directly on 2026-08-19, while deciding that octopus is a harness over
Claude Code rather than a filter on it: _"пізніше реалізуємо імпорт скілів в
додаток й зручне вмикання та вимикання. Заготовані команди та промпти та інші
цікаві штуки."_

Three features, in the order they build on each other.

**See what is loaded.** Done — the project settings dialog lists what the agent
picks up on its own (`instructionSources.ts`). Everything below turns that list
into controls.

**Switch skills on and off, per project.** The SDK already takes it:
`skills?: string[] | 'all'` (`sdk.d.ts:1964`). Read the doc comment before
designing around it — omitting the option is **not** "skills off", and the
option is described as a context filter rather than a sandbox: unlisted skills
are hidden from the model and refused by the Skill tool, but their files stay on
disk and are reachable through Read and Bash. So this is a way to keep the
listing short, not a security boundary, and the UI must not imply otherwise.
`Query.supportedAgents()` (`sdk.d.ts:2465`, never called) is the same move for
subagents.

**Import skills, commands and prompts into a project.** A catalogue in the app
that writes into the repository's `.claude/`, so a project gains a reviewer
subagent or a `/ship` command without anybody copying files by hand. This is
where octopus stops being a window onto Claude Code and starts being worth
opening for its own sake — and it is additive, which the withdrawn "load
nothing" principle would have made awkward and this one does not.

The obvious trap: anything imported lands in a tracked directory, so the same
approval question that guards `.octopus/` applies here.
