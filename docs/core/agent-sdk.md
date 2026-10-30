# The Agent SDK

## The SDK is reached through one function

`agent.ts` takes `query` as a parameter, the same way `git.ts` takes an
executor. That is what lets the whole chat — a message sent, events mapped, a
permission answered, a session closed — be tested without a child process, a
network call or a model. `query()` is never called from a test.

The mapping itself is a pure function from `SDKMessage` to `AgentEvent[]`, kept
apart from the session for the same reason: the SDK's union has some forty
variants and grows between releases, and a variant we do not draw maps to
nothing rather than to a placeholder.

A tool's **structured output** (`tool_use_result`) is read in one place,
`toolOutput.ts`, by shape rather than by tool — the message carrying it names
only the call it answers. What it yields rides on the `tool_result` event: the
counts a summary needs, a subagent's report without the CLI's trailer, the id
of a task a call made. Only for a message holding a single result: the output
is one per message, so with two it belongs to neither for sure. Anything
unrecognised reads as nothing, so a field the SDK renames costs a summary and
never a parse.

**One message is parsed rather than read, and the reason generalises.**
`compact_boundary` is declared with `compact_metadata`, `pre_tokens` and
`post_tokens`; a live session sends `compactMetadata`, `preTokens` and
`postTokens`, and four fields the declaration does not mention. Reading the
typed shape yields `undefined` at runtime — an event of nulls that looks like it
worked. So it goes through zod like any other external data, accepting both
spellings, and a shape neither fits degrades the event to nulls instead of
dropping it: the log's line is worth drawing on the boundary alone.

**A shell command that moved the session is announced too.** `cwd_changed` is
the CLI's `CwdChanged` hook as an event — handed to the SDK as a callback by
`cwdWatch` and merged under the publish guards in `publishLocked`, which own
`PreToolUse`. It carries where the session was and where a `cd` left it, for
the main thread only; a subagent's move ends with its task. Measured on SDK
0.3.307: the hook fires on every `cd` that changed the directory and not on
`EnterWorktree` or `ExitWorktree`, which the log draws from the call — and
only beside a command hook for the same event in the session's settings. The
callback alone, with `includeHookEvents`, in every permission mode, ran not
once; with `CWD_WATCH_SETTINGS` (a `true` command, which the shell runs to no
effect) in the flag layer, on every move. No document says so, and no test
can: the suite never starts a session. `npm run probe:cwd` does, in a
throwaway repository against the CLI's own login, and is the check to run
after an SDK upgrade.

**What a compaction kept is announced the same way.** `compaction_summary` is
the CLI's `PostCompact` hook as an event — `compactionWatch`, merged beside
`cwdWatch` under the publish guards — carrying the summary the agent will work
from, for the main thread only and never empty. The session's settings carry a
`true` command hook for `PostCompact` (`COMPACTION_WATCH_SETTINGS`) on the
ground `CwdChanged` was measured on; whether this event needs it is not yet
measured.

**A model that refuses is announced, and the announcement is drawn.**
`model_refusal_fallback` is the one change of model that is neither the user's
decision nor the agent's: the primary model ends the stream with
`stop_reason: "refusal"` and the CLI retries the turn on another one. It used to
land in the `default` arm with the other three dozen subtypes, so the composer's
chip moved to a different model mid-conversation with nothing accounting for it.

`scope` is the difference between two sentences: `session` means the swap
outlives the turn and the chip has moved, `local` means only a subagent, a side
question or a background fork fell back. Absent from older CLIs, where it reads
as `session` — the SDK says so, and it is the conservative way round, since the
other would describe a lasting swap as a passing one.

`direction` is not carried. It still types as `retry | revert | sticky` and only
`retry` is emitted, the other two kept for consumer compatibility — a field
whose every value is the same value says nothing.

**And the refusal nothing was retried after is drawn too**, which for a while it
was not. `model_refusal_no_fallback` arrives when no fallback model is configured
or per-category routing declines the retry; the SDK sends exactly one of the two
and never both. It fell into the same `default` arm the fallback message was
rescued from — so the worse of the two cases wore the quieter symptom: after a
fallback the reader at least has an answer and a line naming who gave it, and
here the turn simply ended with nothing in the log to interpret.

Its own event rather than a nullable `fallbackModel` and a nullable `scope` on
the first. Those two would have to agree — null exactly when null — and a shape
that can spell a state nothing means is a shape the renderer has to answer for.
A second member of the union also leaves every transcript already on disk
untouched, since no line written before it carries that type.

**Auto mode leaves three events behind, and two of them are drawn.**
`permission_denied` maps the SDK's message of that name — a call refused with
no prompt, usually by auto mode's classifier (`byClassifier`), sometimes by a
deny rule — so a blocked call reads as a decision rather than a tool that
failed. `mode_reported` is ephemeral: the mode `init` and `status` say the
session is in. It exists because the CLI turns a request to start in `auto`
down silently and runs `default`; the service, seeing `default` under a record
that says auto, asks for auto again (`assertMode`) rather than believing the
report, which can be a moment behind a switch still on its way. Only a refusal
of that ask falls back. `auto_mode_unavailable` is the service's own line for
the fall back, carrying where it went — `acceptEdits` when auto came from
carrying out a plan (`autoFromPlan`, held in memory), `default` otherwise — and
it is the only word of the change a window gets. A switch to auto that someone
has just made is not a fall back: the record goes back and the refusal returns
as `autoModeUnavailable`.

**And what the fallback took back is taken back here too.** The refused model
had usually already said something — a half-answer, and any tool results that
went with it — and the CLI evicts those from its own state when it retries. They
were kept here, so a reopened conversation showed the abandoned work above its
own replacement and the transcript disagreed with what the agent held.

Two signals name the same thing and both are read. `supersedes` rides on the
replacement message itself, so the retraction is settled while the event that
caused it is in hand; `retracted_message_uuids` says it again at the end of the
turn and is the complete audit record, carrying results that no replacement
frame was attached to. The SDK calls the two idempotent.

The ids are **opaque**, and that is a decision rather than laziness. The CLI
splits a multi-block message before emitting it and derives a per-block id for
each part; the ids in a retraction are the ones it handed us. Computing that
derivation here would be encoding an implementation that `sdk.d.ts` does not
document — so they are matched by equality and an unmatched one is a no-op,
which is what the SDK promises and what its own reader does. A message naming
itself is dropped: it would strike out its own replacement.

**Marked, not removed.** The retraction is appended like any other event, and
the rows it names are struck through. Removing them would break the append-only
promise the transcript is built on — the log's React keys are positions in it,
so a deletion renumbers every row below — and it would lose the thing the
retraction is evidence of: the agent started down a road and abandoned it.

One case still has no line, and it is the SDK's rather than ours: a user who
**declines the retry dialog** gets neither message. octopus does not draw that
dialog either — `supportedDialogKinds` is undeclared, and the CLI fails closed
on a kind that is not declared — so nothing is inconsistent, and it is worth knowing which silence is whose.

## What the types leave unsaid is measured, not guessed

Two fields on the way in carry no unit in the SDK's types, and both were checked
against a real session rather than assumed:

- `rate_limit_info.resetsAt` is a bare number. It arrives in **seconds**.
  `toIsoTimestamp` still accepts either, because seconds and milliseconds differ
  by three orders of magnitude and telling them apart is a check, not a guess.
- `usage.input_tokens` counts only what was **not** cached. A measured turn
  reported 2 beside 17,392 read from cache and 7,825 written to it, so
  `promptTokens` sums all three. The bare field would have understated the
  prompt by four orders of magnitude — a number that looks fine and is wrong.

The same session showed `utilization` absent from the event entirely, which is
why the header is built to say nothing rather than to hold space for it.

**What the two readings cost was guessed wrong, and then measured.** The suspect
was `get_usage`: its response carries a scan of every transcript on the machine,
and something asks for it at the end of every turn. Against a live session with
845 transcript files and 608MB behind them, the first call takes about 250ms and
every call after it **under 40ms** — the CLI works the scan out once and keeps
it. It was never the expensive half.

`getContextUsage` is, at **600–700ms**, every time, with nothing cached — and it
is the one that looked cheap because it never leaves the machine. The two used
to be asked for together, so a turn's end cost the slower of them; they are
asked for separately now, by the two things that want them. Loading a project's
own settings does not move either figure: the same numbers come back from an
empty directory and from a repository with a `CLAUDE.md`, skills, hooks and
MCP servers. Its reply also names `autoCompactThreshold` and
`isAutoCompactEnabled`, which is where the gauge learns the point it counts to
(see [the composer](../ui/composer.md)).

**And the whole of a read was measured later**, when the account block turned
out to be lagging: `query()` to answer, including spawning the CLI, is
**720–850ms** cold and about **260ms** against a session already running
(SDK 0.3.224). That is what makes reading it on a timer reasonable, and it is
written down here because the block was built on the opposite assumption. It is
the speed of the control request, though, not a promise about the figures: the
account's endpoint behind it refuses most requests and the CLI answers from a
fallback without saying so — see "The account's endpoint refuses most requests"
in [ui/account-and-status.md](../ui/account-and-status.md). On 0.3.299 a read with the transcript scan is ~515ms and one
without it 2–16ms; the sidebar asks without, and that file has the
measurement.

Slash commands were measured the same way, and three of the four answers were
not what the types suggested:

- a **local command answers as ordinary assistant text**. An unknown command
  replies "Unknown command: …", and it arrives as an `assistant` message. There
  is no separate event to map, and none is mapped.

  `/usage` was the same until it stopped being sent at all. Its prose table has
  a structured original — `usage_EXPERIMENTAL_…`, "the structured data behind
  the `/usage` command" — so `sendToChat` recognises the command (aliases and
  all, through `isUsageCommand`), reads the report and emits a `usage` event
  instead of forwarding the message. `readUsageReport` narrows the response;
  `toUsageReport` in `usage.ts` is the pure half of that and holds the reasons
  for the allowlist of windows. It is one of two commands the CLI never sees.

  `/btw` is the other, and it never reaches `sendToChat` at all — the window
  routes it to `askSideQuestion`, and `sendToChat` refuses one that slipped
  through with a plain error, since no window can reach that state. Sent as
  text it queued behind the turn and came back as a turn of its own, with
  tools: the CLI only answers a side question through its control channel.
  That channel is `Query.askSideQuestion`, which is in the SDK's runtime and
  missing from `sdk.d.ts` — the same call the VS Code extension's panel makes.
  The CLI forks the conversation as it stands, denies every tool, takes one
  reply and writes none of it to the transcript; the main turn goes on
  untouched. `askSideQuestion` in `agent.ts` declares the method as narrowly as
  it is used and checks the reply with a schema; a CLI without it is
  `sideQuestionUnsupported`. An abort rejects rather than answering null, so
  the service's own deadline (`sideQuestionTimeoutMs`, five minutes) becomes
  `sideQuestionTimedOut`, and a chat being rewound is refused with
  `rewindInProgress`, as a message is. The earlier exchanges are the window's
  to keep and send back (`history`, twenty at most, as the CLI replays) —
  nothing about the thread is stored.

- a local command **does produce a `result`**, with `terminal_reason` unset. The
  chat therefore stops looking busy on its own, and no special case decides that
  a turn has ended.
- `conversation_reset` carries two ids and **neither resumes the conversation it
  opened**. `new_conversation_id` fails outright — "No conversation found with
  session ID" — and the id that works arrives a moment later in an `init` of its
  own. So the event carries no id at all, and `session_started` stays the only
  thing that records one.
- that `init` now arrives **after every command**, not once per session, which is
  why the branch that stores the id first checks whether it changed.

A fourth, measured later on a real `/compact` (CLI 2.1.224): the command runs a
**model call the `result` does not account for**. The turn took 66 seconds and
cost a dollar, and its `result` reported `input_tokens: 0` and
`output_tokens: 0` — so the footer read `65.9s · 0 tokens` under a turn that was
neither idle nor free. Nothing reads those figures for anything but display, so
this costs only the reading; it is written down because a zero that looks like a
bug is worth recognising as the agent's own answer. The compaction itself
arrives apart from that `result`, on `compact_boundary`, which `mapMessage` turns
into `conversation_compacted` (read through zod, above): that is what draws the
compaction row in the log and moves the context gauge to its `postTokens`.

## An answer travels as the tool's own arguments

`AskUserQuestion` is an ordinary tool, so the agent's questions arrive as a
permission request and nothing else. What is not ordinary is the reply: the tool
reads the user's choices off its own input, so the answer goes back as a
modified copy of the arguments — `PermissionOutcome.updatedInput`. There is no
message to send and no other way in.

Three details of that were measured against the real CLI rather than read off
the types, and each one is a way to lose a day:

- **free text belongs in `answers`**, beside the chosen labels, not in the
  separate `response` field the tool's _output_ has. The CLI's branch for
  `response` discards the list answers entirely, so anything ticked would vanish
  the moment something was also typed;
- **several answers are joined with `', '`** — the separator the CLI splits them
  back on;
- **approving without touching the arguments is "skip"**, and the agent reads it
  as `The user did not answer the questions`. Which is what every question did
  before this existed.

`config.ts` keeps the tool out of any standing approval for the same reason it
keeps `ExitPlanMode` out: `askPermission` answers a standing tool before it
emits anything, so an "always" here does not grant a permission — it deletes the
question.
