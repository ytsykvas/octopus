---
name: conductor-study
description: Answers how Conductor (conductor.build) works — its features, UI structure and observable implementation — and places each answer against what octopus already does. Use it the moment someone says "look at how Conductor did this", "how is this done in Conductor", "is there something like this in Conductor", or names Conductor at all; use it while planning or implementing any octopus feature Conductor already ships — workspaces, worktrees, checkpoints, diff review, setup/run scripts, workspace naming and ports, PR and merge flow, agent modes, todos, files-to-copy, spotlight testing, monorepo support, keyboard shortcuts, settings layers. Works in plan mode: it only reads. Conductor is octopus's stated design reference (docs/PROJECT.md §2, §10.8), so "how does Conductor do this" is worth asking even when nobody says the name.
---

# Conductor study

Conductor is the product octopus is modelled on. Its layout is copied deliberately
(§10.8), its workspace model is the same idea, and two named complaints about it are
octopus's reason to exist (§2). That makes it the most useful comparison available —
and the easiest thing in the world to be confidently wrong about, because it is a
closed-source binary.

This skill exists to keep the answers honest.

## The usual moment

Most of the time you are here because a feature is about to be built and someone said
"let's look at how Conductor did this". That shapes the answer: it is **input to a
plan**, not an essay. Lead with the mechanism and the decision it implies; leave out the
tour.

It works the same in plan mode and outside it — nothing here writes anything. It reads
files, fetches docs and reports. In plan mode the output should slot straight into the
plan as constraints and options; outside it, straight into the implementation.

Two practical habits:

- **Look before proposing, not after.** Reading `references/mechanisms.md` costs one
  file read and regularly changes the design — Conductor's checkpoint implementation, to
  take the obvious case, is a private git ref rather than a copy of the directory, and
  that is the kind of thing that is annoying to discover after the code exists.
- **Answer only what the feature needs.** If the question is checkpoints, the delta on
  monorepo sparse-checkout is noise.

## Conductor is compiled — say what you actually know

`/Applications/Conductor.app/Contents/MacOS/conductor` is a 73 MB Mach-O arm64
executable (a Tauri shell). Its source is not published, but very little of it is opaque:
the window's own code ships inside that executable, and the agent runtime is a JavaScript
bundle (see "The binary is not a wall"). Anyone who claims to know how a Conductor feature
is implemented without having read one of those is guessing.

So label every claim by how it is known. Three tiers, and the reader should always be
able to tell which one they are getting:

| Tier           | Means                                                 | How to phrase it                                    |
| -------------- | ----------------------------------------------------- | --------------------------------------------------- |
| **Documented** | Stated in Conductor's own docs or bundled files       | "Their docs say…", "their settings schema defines…" |
| **Observed**   | Read out of a plain-text file that ships with the app | "The bundled `checkpointer.sh` does X"              |
| **Inferred**   | A reasonable reading of behaviour, nothing more       | "Probably…", "the docs don't say; my guess is…"     |

Never let an inference wear the clothes of a fact. "Conductor uses a private git ref
for checkpoints" is observed and can be stated flatly. "Conductor debounces the
watcher by 300 ms" is invented — do not write it. When a question can only be answered
by inference, answer it _and say so_; a labelled guess is useful, an unlabelled one
poisons the comparison the user is about to make a decision from.

If something matters enough to be worth certainty, the user has Conductor installed —
suggest they check the behaviour in the running app.

## Check freshness before answering

The references were written against **Conductor 0.91.0**, docs fetched **2026-10-19**.
Conductor ships often. Before answering, confirm the version still matches:

```bash
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
  /Applications/Conductor.app/Contents/Info.plist
```

- Same version → the references are current; use them.
- Newer → still use them, they will mostly hold, but say plainly which version they
  describe and that the answer may have drifted. For anything load-bearing, re-check
  the live source before answering. (This is not hypothetical: 0.79.0 → 0.80.0 moved
  the checkpointer's scratch index out of `$TMPDIR` and into the git dir, and
  0.80.0 → 0.91.0 replaced its `reset --hard` restore and changed how a stopped run
  script is killed.)
- Not installed → the bundle sources are unavailable. Docs still work. Say which half
  of the evidence you lost.

## Where to look

In descending order of authority. Prefer the specific over the general.

| Source                                                    | Holds                                                                  | Access                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| `references/*.md` here                                    | Distilled from everything below                                        | Read first                        |
| `https://www.conductor.build/llms-full.txt`               | **Every docs page as one markdown file** (~6.7k lines)                 | `curl`, then grep for the section |
| `/Applications/Conductor.app/Contents/Resources/bin/*.sh` | Real implementation of checkpoints, spotlight sync, git-busy detection | Read directly                     |
| `.../Resources/conductor-skill/skills/conductor/SKILL.md` | The skill Conductor injects into agent sessions                        | Read directly                     |
| `https://conductor.build/schemas/settings.schema.json`    | Full user-settings surface (also `settings.repo.schema.json`)          | `curl`                            |
| `~/.conductor/settings.toml`, `~/.conductor/projects/`    | This user's own Conductor configuration                                | Read directly                     |
| `.../bin/.internal/conductor-runtime`                     | A Bun-compiled JS bundle — `strings` yields near-source minified code  | `strings -a … \| grep`            |
| `Contents/MacOS/conductor`, embedded assets               | The window's own code (`assets/main-*.js`), brotli-compressed          | Extract by path, `brotli -d`      |

`llms-full.txt` is the single best source and it is one fetch. When the references
don't cover a question, go there before anything else — grep it for `^# ` to see every
page title, then read the section.

### The binary is not a wall

`conductor-runtime` is compiled, but it is a Bun bundle, so names — and most of the
minified code — survive. Grepping its strings is how you learn that the four harnesses
are `ClaudeAgentRunner`, `CodexAgentRunner`, `CursorAgentRunner` and `AcpAgentRunner`
behind an `agentType` discriminator, or which Agent SDK options the Claude runner
passes. That is real evidence and it belongs in an answer — described in our own
words, like everything else under "The boundary".

**The window's code is in the main executable, compressed.** Tauri embeds the whole front
end — about 1,950 files of the React app, `assets/main-*.js` among them — in
`Contents/MacOS/conductor`, each file brotli-compressed and indexed by its path. A plain
`strings` pass lists the paths and none of the code, so grepping the runtime and finding
nothing is not evidence that the app does not do it. Once a file is out, what the window
does is readable: which button starts what, and logic the docs only summarise. The
run-mode check that stops other workspaces' run scripts lives there, not in the runtime.

Getting one out, as done against 0.91.0:

1. `otool -l` on the executable gives the `__DATA_CONST` segment's `fileoff` and
   `filesize`; the asset table is in there.
2. The table is a run of 8-byte little-endian words, four to an entry: a pointer to the
   path, the path's length, a pointer to the data, the data's length. Each path is an
   `/assets/…` or `/index.html` string elsewhere in the file.
3. A pointer is a virtual address; subtract the `0x100000000` base for the file offset.
4. `brotli -d` the data. About 1,940 of the 1,990 paths came out this way.

Extract into `$TMPDIR`, never into the repository.

Read it carefully, though. A symbol name is **observed**; what the type _does_ is
**inferred**, and a string in a binary may be dead code, a stale experiment, or a
feature flag that never shipped. So: quote the name, say where it came from, and keep
the interpretation clearly separate from the string itself.

```bash
strings -a /Applications/Conductor.app/Contents/Resources/bin/.internal/conductor-runtime \
  | grep -iE 'checkpoint|worktree|Runner' | sort -u | head -50
```

## The references

Read the one that fits; don't load all four.

| File                          | Read it when                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `references/features.md`      | "What does Conductor have?", "is there an X in Conductor?", scoping a feature |
| `references/mechanisms.md`    | "How is X implemented?" — the parts that are actually knowable                |
| `references/ui.md`            | Layout, panes, naming, shortcuts, anything visual                             |
| `references/octopus-delta.md` | Always, for the comparison half of the answer                                 |

## The references are a floor, not a ceiling

A good reference file has one failure mode: it feels like the answer, so the reading
stops there. Measured against runs with no skill at all, that is the only way this skill
makes things _worse_. Two habits keep it from happening.

**Check what we already have before proposing to build it.** Conductor built its
file checkpoints on raw git because one snapshot has to serve four harnesses and
Spotlight; even its Claude runner, which does sit on the Agent SDK, shows no call that
turns the SDK's file checkpointing on — weak evidence, an absence in a minified bundle.
We have one harness, and we already use what the SDK gives: `enableFileCheckpointing`
and `rewindFiles` in `src/core/agent.ts`, the cut point in `src/core/rewind.ts`,
`forkSession` and `resumeSessionAt` from `src/core/service.ts`. Read those, and grep
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for what is still unused, before
recommending we reimplement anything Conductor had to build from scratch. Their
constraints are not ours, and copying a workaround for a problem we don't have is the
expensive kind of mistake.

**Verify anything that will become code.** Git plumbing especially: run the sequence in
a throwaway repo under `$TMPDIR` and look at the result. A restore path that only adds
files silently resurrects deleted ones — the sort of thing that reads fine and is wrong.
Never reproduce a bug against `~/.octopus` or the user's real Conductor state.

## Answer shape

Three parts, in this order. Keep them short — the user is deciding something, not
reading a report.

**What Conductor does.** The feature as a user meets it.

**How it works.** Tier-labelled. If it is only inferable, one line saying so beats a
paragraph of confident fiction.

**Where octopus stands.** One of: we already have this (name the file); we have it
differently (name the difference); we don't have it; **it is a declared non-goal**.

That last case matters more than it looks. Conductor's Cloud, Multiplayer, teams, the
public API, Codex/Cursor/OpenCode harnesses and the mobile app are all outside octopus
by decision, not by oversight (§5, §12.3). Which of two situations you are in decides
what to do about it:

- **Nobody asked — you were about to suggest it.** Don't. Volunteering a non-goal is
  not insight, it is having failed to read the project. Note it is out of scope and
  move on.
- **The user asked for it directly.** Then do it. Say in a sentence or two that it
  contradicts a recorded decision, name the section, give the honest cost — and then
  deliver the thing that was asked for. Refusing to plan something the user explicitly
  requested is not principled, it is obstructive; the decision to revise §5 is theirs
  to make, and they cannot weigh it against a cost you declined to work out.

The second case is the common one, and it is easy to get wrong in the stubborn
direction. "This is a non-goal, so here is the cost, the staged approach, and the one
line in `docs/PROJECT.md` you would have to change" is a complete answer. "This is a
non-goal, so no" is not.

**Worth taking?** Only when there is something real to say. If the honest answer is
"we already have it" or "this conflicts with §4 transparency", say that in one line and
stop. A suggestion section that always suggests something trains the reader to skip it.

## The boundary

Reading files that shipped with an app the user legitimately installed, to understand
how a problem was solved, is ordinary engineering. Copying Conductor's code or prose
into this repository is not — it is someone else's copyrighted work, and octopus is
MIT-licensed and public, so whatever lands in the repository is published.

So: describe mechanisms in your own words, implement them our own way, and never paste
their source, their skill text, or their docs prose into `src/` or `docs/`. Quoting a
short line to identify what you are talking about is fine; transplanting an
implementation is not.

The same applies in reverse to their design: copying the _structure_ of the layout is a
decision already taken and recorded (§10.8). Copying their visual style was explicitly
rejected. Don't relitigate either.

## Refreshing after a Conductor update

`scripts/refresh.sh` prints the installed version, inventories the bundle, and
downloads the current docs to a temp file for diffing. It gathers; it does not rewrite
the references — read what changed and update them by hand, then move the "as of"
version at the top of each reference and in this file.
