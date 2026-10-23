# Skills and plugins

## The skills panel lists what the session holds, not what we can see

Three of its four groups are directories octopus reads. The fourth is the
session's own answer, and without it the panel read as a list of what a
conversation may reach for while being a list of what **octopus can see** — a
different claim, and the difference is invisible until somebody wonders why a
skill they can watch the agent using is not on it. Claude Code's bundled skills,
the user's `~/.claude/skills` and a plugin's are none of them in a directory we
look at.

`refreshSkills` is the reading, and it already existed: it calls the SDK's
`reloadSkills` and used to throw the answer away. Measured against a live
session, standing in a temporary directory with no project skills at all, that
answer carried `dataviz`, `code-review`, `commit-commands:commit` and a dozen
more. `supportedCommands()` was the obvious call and is the wrong one — it mixes
skills with built-in commands and `SlashCommand` says nothing about which is
which, 53 entries against `reloadSkills`' 25 in the same checkout.

**The reconciliation runs one way only.** Extras the directories do not account
for become the fourth group; a directory entry the session does not list is not
a problem to draw, because a skill with `paths:` in its frontmatter is offered
only where the work touches those paths and is legitimately absent. Measured:
`core-module` and `ui-component` are missing from the list while the seven
beside them are in it.

The switch works on every row but a plugin's, because `skillOverrides` names a
skill by the key the CLI knows it by and that is what the fourth group carries —
a bare name ordinarily, `plugin:skill` for a plugin's. **A plugin's skill is the
exception, and not one octopus can fix**: read out of the CLI (agent SDK
0.3.299), the function resolving a skill's override returns "on" for any command
whose source is a plugin before it reads `skillOverrides`, and a live session
kept `commit-commands:commit` with it set `off` while `dataviz` and `docx` beside
it left. A plugin goes as a whole, through `enabledPlugins` — Claude Code's
`/plugin`. So `withholdable` (`sessionSkills.ts`) says which sources a switch
works on, the panel draws a plugin's rows without one, and the service lists
them as on whatever the record says, since that is what the session does.

**What the session is told comes from the record, never from its listing.** A
session leaves a skill it withholds out of `reloadSkills()` — and out of
`supportedCommands()` too, measured — so a map built from the listing lost every
skill of the fourth group that was switched off: the start-up map had no listing
to build from at all, and the next switch of anything else dropped the rest.
`skillOverridesFor` (`skills.ts`) reads the record instead, and says `'on'` as
well as `'off'`, because a key left out does not undo a withhold the session
started with. The write therefore asks the session nothing.

**The map is built inside the commit and read back after it.** `setChatSkill`
used to spread the record it read before its write, so two switches flipped in
quick succession both started from the same map and the second wrote the
first one's key back — in the record and in what the session was told. The
key is now added to the record as the write's turn finds it, and the session is
sent the map read back from the committed state.

**Every write that can move the answer tells the running sessions, not only a
chat's own switch.** Either default list and a rename change the map just as
much, and they used to reach a conversation only on its next start — the panel
read the new record at once while the agent went on with the old one.
`pushSkillsToRunning` sends each running session its own record's map after
every config write (`updateConfig`, `editConfig`), every project write
(`commitProject`, behind both `updateProjectById` and `editProjectById`) and a
rename (`skillMapOf`, which `setChatSkill` uses for its one). Settled rather than awaited whole: the write
has landed, and one session that will not answer must not fail it for the
others.

The session's side of it (`setSkills` in `agent.ts`) does two things the
record cannot. A key it was told before and the new map no longer names is
said again — taking a skill off a default list drops its key from the map,
and a dropped key leaves the withhold standing. It is said as the settings files
the session reads say it (`skillsInFiles` in `settingsFiles.ts`), and `'on'`
only where they are silent: measured, the flag layer outranks those files, so a
plain `'on'` brought back a skill the user had switched off in their own
`settings.json` for the rest of the session. That read is an `await` between
the map a push starts from and the map it leaves, so pushes run one at a time:
side by side, a default list changed and a chat's own switch both started from
the same map, and the slower read sent the older record last. And a map that moves nothing is
not sent at all, because the flags carry the effort too and a resend would
undo an `/effort` given in the session; that check is also why the writes above
are not narrowed to the ones naming a list. A session still starting is not in
the map a push walks, so it is built from `skillMapOf` read after its last
await, like the mode and the model.

**And a withheld skill keeps its row.** Its name and description are gone from
the answer the moment the switch works, so `knownSkills` in `state.json`
remembers what sessions said of the fourth group (`rememberSkills`, merged by
name — never our directories' skills, which would turn up as the session's in a
checkout without them), and the group adds every skill the conversation itself
has switched off. Only beside an answer, since the group exists once a session
does, and only the chat's own answers: the default lists are edited in
settings, which lists our directories. A plugin's skill is left out — never
withheld, so one missing from the answer is gone, and a row with no switch could
never clear an old `false`. A key no session ever described is drawn
by name alone — a record switched off before anything was remembered, or a skill
deleted while it was off. The second is a stale row that goes the moment it is
switched on; not drawing either would leave a withhold nobody could undo.

A session that will not answer costs the fourth group and nothing else. The
three above it are read from disk and still true, and a closed transport is the
ordinary way that happens.

**The fourth group says where each skill came from.** `describeSessionSkill`
(`sessionSkills.ts`) sorts a held skill into one of four sources. The checks run
from the best-founded signal to the weakest:

1. `builtin` is the SDK's documented flag for Claude Code's own.
2. A description ending in ` (claude.ai sync)` marks a skill synced from the
   account. This is observed CLI output, not documented — on all thirteen
   synced skills of a live session, and on nothing else. It comes before the
   namespace check because `anthropic-skills:deep-research` carries both.
3. A `plugin:skill` name marks a plugin's skill.
4. Anything else is the user's own.

The label the source puts in the text — the suffix, or the plugin's
`(name)` leading the description — is taken off, since the heading says it. The
key is never touched, so if the CLI changes the suffix, a skill lands under the
wrong heading and is still switchable. The session's rows are sorted by name,
because the CLI's order follows how it happened to load them.

## Plugins go through Claude Code's CLI

The SDK can reload plugins (`Query.reloadPlugins`) but has nothing that
installs, removes or switches one. The documented way to do those is
`claude plugin … --json`, so `plugins.ts` runs that — the **bundled** binary,
through `agentBinary()`, so a plugin is installed by the same version that loads
it — and never edits `settings.json` or `installed_plugins.json` itself. Those
carry trust digests, scope rules and a cache layout that are Claude Code's to
keep.

The contract, measured on 2.1.299 under a throwaway `HOME`:

- A write prints **one JSON result line, last on stdout**. A refusal prints it
  too and exits 1, so stdout is read whatever the exit code; a run with no
  stdout at all is `pluginCliUnavailable`. A run that was **killed** — the
  120-second deadline, too much output, a signal — is a failure whatever stdout
  holds: a hung clone prints `Cloning…` and nothing after it, and reading that
  as an answer reported a timeout as unreadable output. The deadline has its own
  code, `pluginTimedOut`.
- Switching a plugin to the state it is already in is a refusal with
  `alreadyInGoalState: true`, and counts as done.
- A second install of an installed plugin is `ok`.
- A plugin whose marketplace declares a command to run is refused with
  `shownCommand: { command, sha256 }`. The caller shows the command, and the
  install is repeated with `--accept-command <sha256>`. A catalog that moved in
  between makes the CLI ask again.
- `uninstall` deletes the plugin's data directory unless told `--keep-data`, and
  the caller should say so before asking.
- **`enabled` is relative to the working directory.** A `local` install that is
  on in its project lists as `enabled: false` from home. So `listInstalled` runs
  the listing again in each project a row names, once per project, and takes
  that row's state from there; a project that is gone keeps what home said.
- A missing working directory reaches `spawn` as the **binary** missing
  (`spawn …/claude ENOENT`). A project-scope action checks the directory first
  and says `pluginProjectMissing` instead.
- The listings print a whole document. `plugin list --available` also lists
  Claude Code's built-in directory, some 3,500 entries, and any marketplace
  added from a terminal; the store keeps only `claude-plugins-official`, by
  decision. Without it connected the listing is not started at all. It also
  **leaves out a plugin once it is installed for every project**, so the store
  would lose a card the moment its install worked; those come back from the marketplace's own entry, without a count.
  A plugin installed in one project only stays in the listing, and installing
  it for every project adds the user install beside the project's.
- Categories, authors and keywords are not in the listing. They come from the
  marketplace's own `.claude-plugin/marketplace.json`, read leniently: losing it
  costs the store its categories, never a plugin.

Writes go through `oneAtATime`: each CLI process reads `settings.json`, changes
it and writes it back, and two at once would put back what the other removed.

A switch or a removal names its **target** — `user`, or `project`/`local` with
the project — as one value, so a project scope without a project cannot be
said; apart, that pair ran the CLI from home and edited the user's own settings.
The target is also checked against the listing before anything is run
(`pluginNotInstalled`): its path becomes the CLI's working directory, where it
writes `.claude/settings*.json`, and only a place Claude Code already recorded
the plugin in may be named.

**What a running conversation needs after each action**, measured with an SDK
session under the same `HOME`:

| Action                      | Without a reload             | After `reloadPlugins()`                                                        |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| install, enable             | the plugin is not there      | its commands and skills are; the session sends `commands_changed` itself       |
| a plugin with an MCP server | the server is not there      | it connects (the docs say it waits for a new session; measured, it did not)    |
| disable, uninstall          | the plugin goes on answering | it is gone                                                                     |
| marketplace add or update   | —                            | nothing to reload: a marketplace changes the catalog, not what a session loads |

So the service reloads every running session after every plugin write, with no
hold for the prompt cache — a plugin switched off and still answering reads as a
switch that did not work. A session that will not reload is counted out rather
than failing a write that has landed, and the count goes back to the caller.
Each reload is bounded (ten seconds): it runs inside the write queue, and one
session that never answered would hold every later write behind it.
Since the session announces its new commands itself, `useCommands` hears about
them through the stream it already listens to.
