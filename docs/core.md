# The core

`src/core` holds every decision the application makes. It imports no Electron
and touches no DOM, so it is tested without launching anything — and could be
lifted into a CLI or a daemon without rewriting.

Coverage here is 100%, enforced. That is the floor, not the goal: see
[testing.md](testing.md) for why a fully covered function can still be untested.

## The modules

### Pure, safe to import from the renderer

Nothing but zod behind them, so a **value** can cross into the window.

| Module                                     | What it decides                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| [`branches.ts`](../src/core/branches.ts)   | how a branch name is shown — `origin/` is noise                         |
| [`colors.ts`](../src/core/colors.ts)       | the project palette, and which colour a new project gets                |
| [`initials.ts`](../src/core/initials.ts)   | the two characters on a project tab                                     |
| [`icons.ts`](../src/core/icons.ts)         | the icons a project may be marked with instead                          |
| [`chats.ts`](../src/core/chats.ts)         | what a chat is, and how much it may do without asking                   |
| [`events.ts`](../src/core/events.ts)       | `AgentEvent` — the only shape the UI sees of the SDK                    |
| [`questions.ts`](../src/core/questions.ts) | the questions the agent asks, and how an answer reaches it              |
| [`usage.ts`](../src/core/usage.ts)         | what `/usage` answers, narrowed from a response wider than its own type |
| [`names.ts`](../src/core/names.ts)         | workspace names, drawn at random from 256                               |
| [`types.ts`](../src/core/types.ts)         | shared identifiers                                                      |

### Storage

| Module                                             | What it decides                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| [`paths.ts`](../src/core/paths.ts)                 | every path under `~/.octopus`, in one place                         |
| [`persist.ts`](../src/core/persist.ts)             | atomic writes of JSON and of text, validated reads, honest failures |
| [`config.ts`](../src/core/config.ts)               | settings and their bounds                                           |
| [`store.ts`](../src/core/store.ts)                 | projects, workspaces and chats, and the migrations                  |
| [`transcript.ts`](../src/core/transcript.ts)       | chat history as append-only JSONL                                   |
| [`changeContext.ts`](../src/core/changeContext.ts) | the lines an edit landed among, read while they are still true      |

### git

| Module                                       | What it decides                                       |
| -------------------------------------------- | ----------------------------------------------------- |
| [`git.ts`](../src/core/git.ts)               | running git safely; slugs; which branch is the base   |
| [`worktree.ts`](../src/core/worktree.ts)     | worktrees and branches, and parsing what git prints   |
| [`workspaces.ts`](../src/core/workspaces.ts) | the workspace lifecycle and reconciliation            |
| [`projects.ts`](../src/core/projects.ts)     | whether a directory can be a project                  |
| [`diff.ts`](../src/core/diff.ts)             | what a workspace changed, and parsing what git prints |

### External tools and processes

| Module                                                       | What it decides                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`github.ts`](../src/core/github.ts)                         | which repositories the account can push to, and cloning one, through the `gh` CLI                                                                                                                                         |
| [`pullRequests.ts`](../src/core/pullRequests.ts)             | every `gh` command a pull request needs: reading a branch, committing, pushing, opening one, reading it in full, merging, and reading every branch of a project at once                                                   |
| [`pullRequestShapes.ts`](../src/core/pullRequestShapes.ts)   | what GitHub sends about one, and what to make of it — schemas, lowering tables and normalisation, with no executor and no Node imports, so the renderer may import its values                                             |
| [`accounts.ts`](../src/core/accounts.ts)                     | whether `claude` and `gh` are signed in                                                                                                                                                                                   |
| [`terminal.ts`](../src/core/terminal.ts)                     | what a pty should run, where, with which environment                                                                                                                                                                      |
| [`loginShell.ts`](../src/core/loginShell.ts)                 | the PATH a GUI launch never gets: how to ask the login shell for its own, and how to merge the answer with what launchd handed over. Decides only — `main/loginPath.ts` spawns and assigns                                |
| [`scripts.ts`](../src/core/scripts.ts)                       | `setup.sh`, `run.sh` and `archive.sh`: where each lives, and the template a missing one comes back as                                                                                                                     |
| [`scriptEnv.ts`](../src/core/scriptEnv.ts)                   | the variables a script is given, and the block of ports a workspace owns. No Node imports at all: the renderer needs the value, and a module reaching `node:os` behind it broke the window while every check stayed green |
| [`archive.ts`](../src/core/archive.ts)                       | running the cleanup script on the way out, without letting it block a removal                                                                                                                                             |
| [`carry.ts`](../src/core/carry.ts)                           | which of the checkout's gitignored files travel into a workspace, and copying them                                                                                                                                        |
| [`env.ts`](../src/core/env.ts)                               | the files: a project's block on disk, and writing it into a workspace                                                                                                                                                     |
| [`envBlock.ts`](../src/core/envBlock.ts)                     | the block as text — checked and filled in. No Node imports: the renderer checks a block as it is typed                                                                                                                    |
| [`ports.ts`](../src/core/ports.ts)                           | which block of ten a workspace gets, and whether anything is already answering there                                                                                                                                      |
| [`instructions.ts`](../src/core/instructions.ts)             | prose handed to the agent, per project and for the installation; `effectiveInstruction` is the order between them                                                                                                         |
| [`instructionSources.ts`](../src/core/instructionSources.ts) | what a checkout offers the agent, and which of it the current `settingSources` actually loads                                                                                                                             |
| [`repoTrust.ts`](../src/core/repoTrust.ts)                   | what a checkout can make the agent do before anybody has looked at it, as a digest of the settings and the hook scripts they name                                                                                         |
| [`agent.ts`](../src/core/agent.ts)                           | the Agent SDK: session lifecycle and event mapping                                                                                                                                                                        |

### The façade

[`service.ts`](../src/core/service.ts) is the single entry point. It holds state
in memory, persists after every change, and exists so that `main/` can be a
proxy — an IPC handler should only have to forward the call.

## How a module is written

**Dependencies are parameters with defaults.** This is what makes the layer
testable without mocking modules.

```ts
export function rootDir(home: string = homedir()): string
export async function listWorktrees(exec: GitExec): Promise<Worktree[]>
export function nextWorkspaceName(taken: readonly string[], random: Random = Math.random): string
```

The clock and randomness are parameters too. Without that, a test either asserts
nothing useful or becomes flaky.

**Parsing is separate from running.** `parseWorktrees` takes a string, so it can
be tested against output no real repository would produce — a bare worktree, a
locked one, CRLF line endings.

**Failures carry a code.** `ProjectValidationError`, `WorkspaceError` and
`GitHubError` each hold a machine-readable `code` the UI turns into a localised
message. The English text on the error is a fallback for logs.

## The invariants

These are the rules that have been broken, each costing a bug.

### Uniqueness has a scope

Before rejecting a duplicate, ask what it is unique **within**. A workspace name
and its branch are unique per project; the id is unique across the app. See the
table in [data.md](data.md).

### git is asked about git

A branch outlives the worktree it was made for — removal keeps it unless asked
otherwise. So a name free in `state.json` may still be taken in the repository,
and `worktree add` will refuse. `takenByBranches` in `workspaces.ts` exists for
exactly this.

### An operation that fails cleans up after itself

Creating a workspace makes a directory, a branch and a record. If the record
cannot be written, `rollbackWorkspace` undoes the first two. Debris left in git
is invisible to the app but still holds its name, so one failure would otherwise
become permanent.

Rollback is best-effort and never throws: it runs while another failure is being
handled, and a second must not replace the first.

### An update applies every field it carries

`updateProject` lists fields explicitly, which protects against writing back a
stale value — and silently drops any field added to the type but not to the
update. That is why the colour picker did nothing for a while. A test per field
is the only thing that catches it.

### The SDK is reached through one function

`agent.ts` takes `query` as a parameter, the same way `git.ts` takes an
executor. That is what lets the whole chat — a message sent, events mapped, a
permission answered, a session closed — be tested without a child process, a
network call or a model. `query()` is never called from a test.

The mapping itself is a pure function from `SDKMessage` to `AgentEvent[]`, kept
apart from the session for the same reason: the SDK's union has some forty
variants and grows between releases, and a variant we do not draw maps to
nothing rather than to a placeholder.

### What the types leave unsaid is measured, not guessed

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
and the composer's strip asks for it at the end of every turn. Against a live
session with 845 transcript files and 608MB behind them, the first call takes
about 250ms and every call after it **under 40ms** — the CLI works the scan out
once and keeps it. `readSubscriptionUsage` was never the expensive half.

`getContextUsage` is, at **600–700ms**, every time, with nothing cached — and it
is the one that looked cheap because it never leaves the machine. `sessionUsage`
asks for both at once, so a turn's end costs the slower of the two rather than
their sum. Loading a project's own settings does not move either figure: the
same numbers come back from an empty directory and from this repository, with
its `CLAUDE.md`, skills, hooks and MCP servers.

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
  for the allowlist of windows. It is the one command the CLI never sees.

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
bug is worth recognising as the agent's own answer. The compaction itself is
announced on `compact_boundary`, which is dropped — see
[the two open tasks](tasks/) on what that costs.

### An answer travels as the tool's own arguments

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

### Which model is running, and where that is readable

Two readings claim to answer it and only one is current — measured, and the
difference costs a turn:

- the **init message** carries a `model`, and init arrives after every slash
  command, so it looks like the push channel. It is not: after `/model haiku`
  the init of that same turn still names the old model. The new one appears an
  init later, which is a turn too late for the footer.
- **`getContextUsage()`** answers correctly the moment the turn ends. It is a
  non-cached round trip, and it is one the pane already makes: `useSessionUsage`
  reads it on every `result`. So the running model rides along with the context
  gauge and needs no channel of its own.

`supportedModels()` answers neither — it is a catalogue, and the runtime freezes
it at the first `initialize`. Nor does `initializationResult()`, whose response
has no model in it at all.

This is also why `sendToChat` re-asserts the permission mode but **not** the
model. It briefly did both, on the belief that a `/model` could not be detected;
once it could, the re-assertion stopped guarding against drift and became an
undo of an explicit instruction.

### Two models, and when one replaces the other

A conversation holds two: `model` for writing the code and `planModel` for
planning. `sessionModel` folds them into the one the SDK takes — see
`docs/data.md` for why the two nulls mean different things — and nothing but its
return value is ever handed to `setModel` or to `SessionOptions.model`.

Which means the effective model can move without anyone naming one, at exactly
two moments: planning turned on or off, and a plan approved. `pushModel` handles
both, and the guard in it is what keeps the paragraph above true — it sends
nothing unless the value actually changed, so a conversation whose two jobs
share a model is never pushed at, and a `/model` given to it still stands.

That is a change **this application made and knows the moment of**, which is the
whole difference from re-asserting per message: sending a message moves nothing,
so a push there would still be undoing `/model` and nothing else. On an approved
plan it goes out **before** the permission reply resolves — the reply is what
releases the tool call, and there is no `updatedModel` to ride along with the
mode the way `updatedPermissions` carries it.

### One effort, folded into two

`sessionEffort` is the third of these folds, and the odd one: the two answers it
produces are not two stored fields. A chat holds a single choice, five levels
wide plus `ultracode`, and the SDK asks about that choice twice — for a level,
and for a flag that turns dynamic-workflow orchestration on. `ultracode` sets
both, `xhigh` and `true`.

Which is why it is stored as one value. A level beside a boolean would admit
`ultracode` with `low`, a state nothing can run, and both halves would then have
to agree everywhere they were read.

The flag goes out with the level in **one** call, at both moments it can move:
`Options.settings` at start-up, and `applyFlagSettings` on a running session.
That is not tidiness — `applyFlagSettings` shallow-merges top-level keys, so a
flag sent after a level would replace it rather than join it. Both are always
said, `false` included: `settingSources` is empty, so nothing else is loaded
that could turn `ultracode` back off, and silence would leave the last session's
answer standing.

### A reset is not consent

`conversation_reset` is emitted by `/clear`, by leaving plan mode, and by
fresh-session flows. Only the first should empty the log, so the intent is
recorded where it is known — `sendToChat` notes that the message was a clearing
command, aliases included — and consumed by the event it caused. Read off the
event alone, approving a plan would erase the conversation that produced it.

**The clearing turn outlives its own reset by one event.** The transcript is
discarded the moment the reset says it was asked for, and the command's own
`result` arrives a tick later — recreating the file it had just removed, to hold
the footer of a turn nobody can see. An emptied conversation reopened as one row
reading `0.1s · 0 tokens`, and clearing again only replaced it.

So the request is consumed in two steps rather than one: `clearRequests` ends at
the reset, `clearedTurns` at the result that follows it. Only the **writing** is
skipped — the result is still announced, being what stops the composer offering
to stop.

Both sets are also emptied with the chat when its workspace is removed, which is
bookkeeping rather than a guard. Neither can strand a flag that matters: a
`/clear` whose result never arrives means the session stopped answering, and
`closeChatsOf` — the only thing that drops a session — runs on workspace
removal, not on an agent error. A session that dies is kept in `sessions`, so
there is no later turn for a stale flag to swallow.

The log has the matching rule, because the transcripts written before this did
not get one: a footer at the head of the log closes no turn, so `groupToolRuns`
does not draw it.

### One writer at a time

`persist.ts` writes to a fixed temporary path and renames it, so two saves in
flight race for that one file — the first rename wins and the second fails with
`ENOENT`.

`writeTextFile` shares that mechanism, and the env block is written through it
with no queue in front. The race is bounded rather than prevented, which is
deliberate: writing the block is idempotent and convergent — every run strips any
block of ours and appends a fresh one — so two of them land the same file, and
the only cost of losing the race is one spurious `ENOENT`. A queue would buy
nothing here, and a lock file would live inside somebody's repository.

That function also **re-asserts the mode** rather than passing it to `writeFile`,
whose `mode` option reaches `open(2)` and is ignored unless the call creates the
file. Appending credentials to a `.env` carried in from a checkout would
otherwise leave it as readable as the copy was. Agent events arrive from a callback nobody awaits, so a status change
from the agent and one the user asked for genuinely do land together. `commit`
serialises them, and takes a **function** of the current state rather than a
finished one: a queued write computed from a stale snapshot would silently undo
whatever landed while it waited.

Transcript appends have their own chain. They do not read the state, so making
them wait for a save would only slow the log down — what they need is order.

Nothing inside a `commit` may call `commit` again: it would queue behind the
write it is already part of, and wait for itself. That deadlock cost an
afternoon.

**A decision that depends on the state belongs inside the callback, not before
it.** `openChat` used to look for an existing record and then await `commit`;
the renderer has two ways in — a setting picked in the composer, and a message
sent — and both callers saw none and both wrote one. The reply and its whole
transcript then went to the second while `listChats` answered with the first, so
the conversation reopened empty and the transcript that held it was filed under
an id nothing pointed at. Serialising the write is worth nothing if the question
it answers was asked outside the queue.

`createChat` counts against the cap inside its own callback for exactly that
reason: two presses of the new-tab button landing together would both see room
against two conversations, and the cap would hold for neither.

### Opening a conversation, and creating another

`openChat` answers "the conversation to write into" and is idempotent — it is
what the pane calls when a setting is picked or a first message sent, and a
workspace nobody has spoken to gets no record from it being looked at.
`createChat` always writes one, which is the whole of what the new-tab button
asks for. A flag on the first would have made every caller say which of the two
it meant.

`closeChat` ends a conversation and discards it, and refuses the last one of a
workspace: emptying the only conversation is `/clear`, which does it without
leaving the pane with nothing to draw — and does it with a confirmation, which a
second route through the tab's menu would not have carried.

The sequence a closing conversation goes through — abandon its questions and its
edits in flight, drop its `clearRequests` and `clearedTurns`, close the session,
remove the transcript — lives in `closeOneChat`, and `closeChatsOf` is a loop
over it. Written out twice it would drift, which is what `removeProjectById`
did before its own cascade was factored out.

`renameChat` trims what it is handed and stores null for an empty name. Trimmed
in the service rather than at the boundary, because what reaches the record is
what the strip will draw, and a name of three spaces draws as a gap nothing
explains.

### A workspace's status is derived, not written

`Workspace.status` used to be written by whichever conversation last had an
event. With three per workspace that is wrong in the ordinary case: the tab that
finished marked the two still working as idle, and the composer's stop button
went with it.

The status now sits on the **chat**, and the workspace's is computed from its
conversations by `workspaceStatusFrom` — `waiting_permission` first, because
that turn has stopped and is waiting on the user; then `running`, because the
dot says what is happening now; then `error`, which is a record of something
that already happened; then `idle`. The workspace's own status is not consulted:
every value the enum holds is something a conversation is doing.

Both move in one `commit` (`commitChats`), because two would leave a moment in
which the chats say one thing and the workspace derived from them says another —
and that moment is when the file gets written. Each of the two streams fires
only when its own value actually changed: a second conversation finishing does
not move a workspace whose first is still running, and announcing it anyway
would redraw the whole list for nothing.

`settleStatuses` follows the same shape on load: the conversations are put down
first, and the workspaces derived from the settled list rather than settled
alongside it by a rule that would drift the first time one of them changed.

`reconcile` puts one more fact on each conversation than its status: `started`,
which is `sessionId !== null`. The list draws a conversation that ran and
finished differently from one nobody has written in, and both of those are
`idle` — so the status alone cannot say which, and this is what does. Note the
order it becomes true in: a turn is under way before the session it runs in has
announced itself, so a conversation is `running` and not yet `started`, which is
the honest reading of both.

### Forking a conversation

A plain `resume` continues a session **in place and keeps its id** — which is
what the SDK's own `forkSession` option exists to opt out of, and what the guard
in `handleEvent` that skips an unchanged `sessionId` had already shown. So
copying the id onto a second record is not a cosmetic clash but two agent
processes appending to one session file, each reading the other's turns as part
of its own conversation.

`forkChat` therefore calls the SDK's standalone `forkSession(sessionId, { dir })`
**before** any record exists, and stores what comes back. `dir` is the
workspace's path and is not optional in practice: without it the SDK searches
every project directory for the id. Injected like `query`, so a test reaches no
CLI and no conversation that happened on the machine running it.

That copies what the _model_ remembers. Our own transcript is copied beside it
(`copyTranscript`, queued behind the appends), because that is what the _screen_
draws — without it the new tab opens empty above an agent that remembers all of
it. A fork the SDK refuses writes no record at all: a tab that says it continues
a conversation and does not is worse than a refusal.

### What the renderer holds is what the core last said

A patch arriving over IPC is external data like any other. `applyConfig` merged
one straight into memory while `saveConfig` parsed before writing, so the file
was always valid and the copy the application ran on was whatever came — and the
two could disagree until the next restart, which is the kind of bug that
survives a screenshot. The parse now happens on the way in as well, which is the
same parse a moment earlier.

### A question nobody can answer is withdrawn

`canUseTool` blocks the agent on a promise, so an open permission request is a
turn held open. Every way a turn can end withdraws the chat's questions:
stopping it, the session closing with its workspace, and the `result` or `error`
that ends it on its own. `abandonPermissions` resolves each as a refusal and
drops it — resolving rather than dropping, because the promise is what holds the
tool call, and a refusal is the only answer that cannot start work nobody
approved. It carries `ABANDONED` rather than `DENIED`: the agent reads a
refusal's message as instruction, and nobody declined anything.

Only an answer used to remove one, which let the map outlive the sessions in it.
That was invisible until `pendingPermission` began handing the first entry it
finds for a chat to whatever window opens the conversation — at which point a
question the user had stopped instead of answering came back with live buttons
on it.

The other half of the same rule: the entry is removed where the answer is
**given**, after the writes that can fail. Removing it first meant a config
write that failed left the agent blocked on a question nothing could ask again —
the window had dropped its copy, and `pendingPermission` had none.

Only the session's own stream reaches `handleEvent`; a background write that
failed is reported straight to the listeners by `report`. That is what makes the
`error` case safe to withdraw on.

### What a diff counts is exact; what it draws is bounded

The counts come from `git diff --numstat` and are always right, whatever else
happens. Only how much of a change is **drawn** is limited, and a file left out
says so rather than quietly appearing unchanged. Keeping those two apart is what
lets a pane degrade into "this file is too large to draw" instead of into a
failure.

The ceilings used to count files and lines only, and a line has no length: a
source map or a minified bundle is two changed lines and passes every one of
them, then puts megabytes through a buffer that holds 32MB. So there is a byte
ceiling beside the line one, applied by handing git `core.bigFileThreshold` —
past it git reports a file as binary rather than writing its content out. That
flag goes **only** on the call carrying the lines: under the same setting
`--numstat` answers `-`, and the counts are the half that must not move.

Two consequences worth keeping:

- **The pathspec has to be built from what was drawable, not from what is left.**
  Comparing the drawn files against an already-marked list compares two numbers
  that are equal by construction, so git is asked for the whole diff whatever the
  ceilings said — and the file the ceiling excluded arrives in full anyway.
- **Untracked files are not a special case.** They are measured before they are
  read, read one at a time, and share the same budget as everything else.
  Reading them all at once and measuring afterwards means a workspace whose
  build output is not ignored opens a read per file in the tree.

### What a stopped turn was holding goes with it

`editsInFlight` records an edit the agent announced so the lines around it can
be read once the result says it worked. A turn stopped mid-edit produces no
result, so the entry stayed for ever — against the map's own promise that it
cannot grow, and the same shape as the question above. `abandonEdits` is called
wherever a turn stops being answered for: with the session, and with an
interrupt.

The same omission is worth watching for one level up. `removeWorkspaceById`
closed the chats of the workspace it removed and `removeProjectById` did not, so
every agent in a removed project stayed alive with its working directory deleted
underneath it, reachable from nothing but a quit. A test asserting that the
records are gone will not notice: the records were the part that worked.

### Errors are not swallowed

If git fails, stderr reaches the user. A `catch` is justified when the fallback
is genuinely correct — not to make a coverage gap disappear. If the alternative
is a clearer error one line later, let it through.

Two failures in one chain are two decisions. Asking the agent for its model list
is fire-and-forget: a list that cannot be **read** is swallowed, since it is a
convenience for the picker and failing a message over it would report the wrong
problem — but a list that cannot be **written** is a failed write like any
other, and goes into the chat through `background`. Handling only the first left
the second uncaught in the main process, where Electron answers with a modal
about a JavaScript error over an application that is otherwise fine.
