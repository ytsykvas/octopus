# `config.json`

Validated by `ConfigSchema` in [`config.ts`](../../src/core/config.ts).

| Field                             | Meaning                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                         | format version, for future migrations                                                                                                                                                                                                 |
| `branchPrefix`                    | branches are `<prefix>/<workspace>` — cleaned on every read and write into what git takes (`cleanBranchPrefix`), so `ytsykvas/` is read as `ytsykvas`; a project's copy is cleaned the same way                                       |
| `cloneDirectory`                  | where GitHub clones land; empty means "ask, then remember"                                                                                                                                                                            |
| `settingSources`                  | what the agent loads for itself — `all` by default, as the CLI does; `none` is available for isolation (§4)                                                                                                                           |
| `workingMode`                     | what a new chat may do before asking; planning is not one of them                                                                                                                                                                     |
| `planExecutionMode`               | what an approved plan is carried out in — `auto` (the default) or `acceptEdits`; never `default`, which would ask about every step just approved                                                                                      |
| `effort`                          | how much thinking a new chat asks for; `medium` unless changed. Five levels, never `ultracode` — see below                                                                                                                            |
| `model`, `planModel`              | the pair a new chat starts on — which model writes the code, which one plans                                                                                                                                                          |
| `alwaysAllowedTools`              | what the user answered "always" for — a tool and, where the bridge named one, the place the question was about. Listed so each can be undone                                                                                          |
| `disabledSkillDefaults`           | skills off in every conversation that does not say otherwise, running ones included, by the key the agent knows them by. A list of what is **off**, so empty means every skill is available — how Claude Code treats one it discovers |
| `dismissedTips`                   | heads-ups above the message field answered with "Knew this already", by id — not shown again in any conversation. Closing one without that answer is not stored                                                                       |
| `theme`, `language`               | appearance                                                                                                                                                                                                                            |
| `rightPanelWidth`, `sidebarWidth` | pane widths in pixels, as last dragged — a narrow **window** shows less of the right pane's width without rewriting it                                                                                                                |
| `rightPanelOpen`                  | whether the right pane is showing or folded away, kept across launches; `true` when absent                                                                                                                                            |
| `statusBarOpen`                   | whether the status bar along the foot is showing; folding it also stops what it reads. `true` when absent                                                                                                                             |
| `notificationSound`               | whether news from an agent out of sight plays a chime; `true` when absent                                                                                                                                                             |
| `notificationSoundId`             | which sound a notice plays: `chime` (the synthesised one) or a file in `assets/sounds/`; `chime` when absent, and an id the build does not ship plays the chime                                                                       |
| `diffView`                        | whether a diff is drawn in one column or two — a preference about how code is read, not a per-session mood                                                                                                                            |
| `rightPanelTab`                   | which of the right pane's tabs is showing (`files`, `terminal`, `diff`, `scripts`, `pullRequest` or `notes`); whether it is folded away is `rightPanelOpen` — `build` and `server` are still read and become `scripts`, see below     |
| `deviceId`, `installedAt`         | shown in Settings; no other reader                                                                                                                                                                                                    |

`alwaysAllowedTools` is filtered on the way in **and on the way out**, and never
holds `ExitPlanMode`. An entry there is not merely a pre-answered question — it
stops the question being asked at all. With the plan tool in it the agent's plan
was approved before anything was drawn: no dialog, no record that planning had
ended, and the toggle still lit over an agent editing files. It went unnoticed
for a day. `NEVER_STANDING` in `config.ts` is what strips it.

**An entry is a rule, not a tool name.** It used to be the name alone, so
answering "always" about one file under `.claude/` granted every `Edit` in every
workspace from then on — an approval an order of magnitude wider than the
question asked, and the kind that gets granted once and regretted quietly. The
narrow rule comes from the SDK's own suggestion, in the third argument to
`canUseTool`, so nothing here guesses at what the question was about.

A bare name is still read and still means the whole tool, which is exactly what
it always meant: a normalisation rather than a version bump, the convention
`StateSchema` states.

**The match is deliberately narrower than the rule.** `ruleContent` is a glob,
and a matcher that reads one loosely grants more than the person answering
agreed to — the failure this replaces. So only a wildcard opening a path segment
is read: `/w/docs/**` says "under `/w/docs`" and nothing else has to be
understood. `/w/src/comp*.ts` is not read at all, because truncating it to its
parent would grant the whole of `/w/src`. A call the rule cannot decide is one
the user is asked about again, which costs a click and grants nothing.

The list is **not** passed to the SDK. It was, alongside the read-only tools,
and that made it unrevokable: a name the SDK holds is approved before
`canUseTool` is consulted, so unticking a tool in Settings reached only the
sessions that had not started yet, while the one on screen kept running the
tool. `askPermission` consults the list itself now, on every call, against the
config as it stands at that moment.

The rule does go to the **session**, on the reply that releases the tool call —
without it the very next call asks the same question, since the SDK knows
nothing about a list octopus keeps itself. That is a copy the session forgets
when it ends; the config is the one that lasts and the one Settings can undo.

**Every new field carries `.default()`** — here, in `StateSchema` and in
`ChatSchema` alike. `readJsonFile` throws on a mismatch rather than falling
back, so a field without one does not lose the value: it stops the application
opening until someone edits JSON by hand. This is what happened when `language`
was introduced.

**A field that is _present and null_ is a different problem**, and a default
does not answer it — a default is for a key that is not there at all. `effort`
holds the case: it was nullable while "the agent decides" was a choice the
picker offered, and records on disk still say so. `StoredEffortSchema` in
`chats.ts` normalises it with a `transform`, which runs on the way in **and** on
the way out, since `persist.ts` writes back what the schema returned — so the
old null is cleaned off the disk the next time anything is saved. Same shape as
the `alwaysAllowedTools` filtering above. A `.catch()` would cover both cases in
fewer characters and is deliberately not used: it would also swallow a genuinely
corrupt value, which is the one thing this reader exists to shout about.

## Config version 2

Version 1 shipped `settingSources: 'none'`, and a default only ever reaches a
config being created — so every install already carrying it would keep an agent
that cannot read the project's own `CLAUDE.md`. `migrateConfig` raises `none` to
`all` on the way from 1 to 2 and writes the result back, then never touches the
value again: a config that says 2 holds a choice, isolation included.

The same split `store.ts` makes between what is on disk and what the app works
with. A version the current build no longer writes still has to **parse**, or
every other setting in the file would be unreachable because of one number.

A version this build has never heard of is refused instead: the read throws, the
app says so and quits. Deliberate — a newer build wrote that file, and starting
anyway would write it back in an older shape and silently discard whatever the
newer one had put there.
