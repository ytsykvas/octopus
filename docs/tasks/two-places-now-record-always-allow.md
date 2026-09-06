# Two places now record "always allow"

`config.alwaysAllowedTools` exists because of a constraint that has mostly gone.
The commit that added it said so plainly:

> An answer of "always" is stored in the config, where it can be taken back,
> because with `settingSources: none` the SDK has nowhere to write one.

Settings sources are loaded now, so the SDK has somewhere: `.claude/settings.local.json`,
which is where the plain CLI keeps exactly this answer. So a user who says
"always" in octopus writes it to one place, and the same user saying it in a
terminal writes it to another. Only one of those directions flows: an "always"
the CLI wrote does silence the question inside octopus, because a bare name the
SDK holds is approved before `canUseTool` is consulted — `agent.ts:42-44` and
`agent.ts:52-54`, `docs/data.md:71-73`. What octopus cannot do is show that
answer or take it back. The other direction does not flow at all: nothing
leaves the config.

The constraint is weakened rather than void. `none` is still a mode the user
can choose — `config.ts:116`, `Settings.tsx:263-283` — and the migration to
version 2 leaves a deliberate `none` alone (`config.ts:344`). And `sourcesIn`
(`service.ts:1834-1841`) narrows the sources to `user` while a worktree's
capability files are unapproved, so the repository's own
`.claude/settings.local.json` is not loaded at all until the trust digest is
approved.

## What has been decided since

**2026-09-06.** The width half landed: an entry is a rule now, carrying the
place the question was about, and `always-allow-is-far-wider-than-the-question-asked.md`
is gone. The choice made there was **keep the config as the home**, so of the
three below the second is the one to build — the first is ruled out and the
third was only ever a description of today.

What is left is one direction of flow: octopus does not read
`.claude/settings.local.json`, so an "always" given in a terminal is honoured by
the session (the SDK approves it before `canUseTool`) and is invisible here —
it cannot be shown and it cannot be taken back.

Three ways out:

- **Write to `.claude/settings.local.json`**, as the CLI does. One home, shared
  with the terminal. Costs octopus the ability to show and revoke the list in
  its own Settings screen unless it also reads and edits that file. That exact
  path is one of `repoTrust.ts:42`'s `FILES`, so writing an answer into it
  changes the worktree's trust digest and puts the project back to unapproved —
  which narrows `settingSources` to `user` and, by `service.ts:1896`, empties
  the skill listing with it. Whoever takes this up solves that as part of it.
- **Keep the config and read theirs too** — `askPermission` consults both. No
  migration, no surprise, but "where do I take this back" now has two answers.
- **Leave it.** Defensible only while the two lists rarely disagree, which is a
  guess rather than a design.

Worth deciding when permissions are next touched, alongside
`the-permission-card-cannot-say-why-it-is-asking.md`, which already names
`alwaysAllowedTools` as staying put "because `settingSources` may be `none`" — a
reason the config comment still gives, at `config.ts:164-174`, and one that now
holds only in the two narrow cases above.
