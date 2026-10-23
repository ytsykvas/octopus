# Conversations

## One writer at a time

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
otherwise leave it as readable as the copy was.

Agent events arrive from a callback nobody awaits, so a status change
from the agent and one the user asked for genuinely do land together. `commit`
serialises them, and takes a **function** of the current state rather than a
finished one: a queued write computed from a stale snapshot would silently undo
whatever landed while it waited.

`config.json` has a queue of its own of the same shape, in `applyConfig`, which
also takes a function of the current config for the same reason. It was written
unqueued until ten arrow-key nudges of the right pane's edge — each one an
update — showed both halves: the second rename failing with `ENOENT`, and a
patch built from a config the previous write had not stored yet putting that
write's field back.

The same reasoning reaches past the process boundary. **A list is never sent
whole from the window**: a list built from the copy the window last received
is a snapshot, and two switches flipped inside one round trip both started
from it — the second wrote the first one back out, and a standing permission
the core recorded while Settings removed another was dropped by the list
Settings sent. The window sends one operation instead (`ConfigEdit`,
`ProjectEdit`), applied inside the write's turn by `editedConfig` and
`editProject`, with `withMember` (`lists.ts`) as the one shape of a switch over
a list.

Transcript appends have their own line. They do not read the state, so making
them wait for a save would only slow the log down — what they need is order.

All three are a `oneAtATime` line (`parallel.ts`), not three hand-written copies
of `tail.then(apply, apply)` and a settled tail. Another file written from
handlers nobody awaits, or read, decided on and written back, takes a line of
its own; whatever has to wait for the writes to land — `settle`, a rewind
telling the windows to read the log again — asks the line's `idle()`.

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
against two conversations, and the cap would hold for neither. And the value a
change is compared with is a decision too: `changeInForce` reads the model and
effort in force inside the commit, for the reason the `pushModel` paragraph
gives.

## Opening a conversation, and creating another

`openChat` answers "the conversation to write into" and is idempotent — it is
what the pane calls when a setting is picked or a first message sent, and a
workspace nobody has spoken to gets no record from it being looked at.
`createChat` always writes one, which is the whole of what the new-tab button
asks for. A flag on the first would have made every caller say which of the two
it meant.

**Rewinding to a message** (`rewindChat`, `previewRewind`) puts back the
conversation, the files, or both (`RewindScope` in `rewind.ts`) to how they were
just before a given user message was sent. It rests on a few things. Every
message is sent with an id octopus makes (`randomUUID`, kept in the transcript
as `uuid`), since nothing in the stream says it back and the id is the only
handle on that point — and, measured, the CLI records the prompt under exactly
that id, so it is an entry of the session's own chain.

The **files** half asks the agent: sessions are started with
`enableFileCheckpointing`, because a checkpoint cannot be taken for work already
done, and `rewindFiles` restores what it tracked. It needs the **workspace**
quiet — the worktree is shared by up to three conversations, and the checkpoint
restores whatever this one tracked — checked before and again after the session
is started, since a message sent while it started began a turn. It is written to
the transcript as `files_rewound`, with the count of files a link kept it from
restoring.

The **conversation** half needs only this conversation quiet. Its cut is found
in the session's own history (`getSessionMessages`, through the injectable
`sessionMessages`): `cutBefore` names the entry just before the message, which
is the last thing the agent will remember; a message nothing precedes leaves
nothing to keep, and the conversation starts over with no session. A message
the chain no longer holds — compacted away, or renamed by a fork — is not
offered at all rather than cut approximately. The cut is stored on the record
as `resumeAt` and the session is closed, so the next one starts with
`resumeSessionAt` in the **same** session; measured against the real CLI, a
session started at the cut and closed unused leaves a plain resume remembering
everything, which is why the cut is kept until a `result` of the session that
applied it (only that cut — a later rewind may have stored another), or a new
session id, clears it. A fork taken while a cut waits passes it as
`upToMessageId`. Then our transcript is cut back through the write queue
(`truncateTranscript`, written whole and renamed into place) and the message's
text comes back for the composer; if that fails the record is put back, which
is exact, since nothing has been sent on top of the cut. A
`conversation_rewound` event, never stored, tells every window to read the log
again.

Everything that can refuse is asked before anything changes; then the files go
first, while the session that checkpointed them is alive, and their row is
written after the cut so the cut cannot take it. A message, or a second rewind,
arriving mid-way is refused with `rewindInProgress`: a send writes its line
outside the write queue and starts a session, and either would land in the
history being cut. The preview answers each half for itself — the conversation
as a yes or no, the files as the agent's dry run, `canRewind` false included,
or null while another conversation of the workspace works — and changes
nothing.

A session is built from the record **as it is by the time it is registered**,
not from the snapshot its starter held: starting takes several awaits, and a
mode, an effort or a model changed while they ran went to a session that was not
registered yet, so it reached nothing and the conversation began on what it had
been.

`sessionFor` is the one way a session is started: a message being sent and a
rewind that needs a session both reach for one, and without it each would start
its own, the second registered over the first and the first's child process left
running with nothing holding it. `requireOpenChat` is what sending, rewinding
and `startFor` — just before it registers — ask for instead of `requireChat`,
since a closed conversation has no tab and no status to show a session at it; and `setChatStatus` skips a closed one, so the
late `result` of the session that has just ended cannot leave it `error`. It
asks inside its commit, not before: the close is written before the session
ends, and a status queued while that write was on its way would otherwise land
on the closed record. Whether the status moved, and so whether the window is
told, is decided there too — read before, a question withdrawn before its wait
was written announced the wait and never its end.

`closeChat` ends a conversation's session and **keeps** it: the record gets a
`closedAt` and its `status` goes back to `idle`, and the transcript stays where
it is. It refuses the last open conversation of a workspace: emptying the only
conversation is `/clear`, which does it without leaving the pane with nothing to
draw — and does it with a confirmation, which a second route through the tab's
menu would not have carried. The refusal is decided inside the commit — asked
before it, two closes of the last two tabs each saw the other still open and
left none — and the session is closed only after the commit, so a close it
refuses leaves the session running. A tab closed twice at once, from two
windows, is closed once and refused never: the second finds it closed already.

The order matters a second time for a session still starting, which the close
cannot see: `startFor` re-reads the record with `requireOpenChat` just before it
registers, so a start either registered in time to be ended or reads the close
and refuses. One registered on a closed conversation would never be ended —
`closeChatsOf` walks the open ones.

A closed conversation is invisible to everything that means "the tabs of this
workspace" — `chatsOfWorkspace` skips it, so the cap, the strip, the workspace's
status and `openChat` never see it. Whatever has to reach the history as well —
removing a workspace or a project, which must discard the transcripts — asks
`allChatsOfWorkspace`; using the first there would have left every closed
conversation's file behind with nothing pointing at it. `reopenChat` checks the
cap inside the commit, as `addChatCapped` does. Past
`MAX_CLOSED_CHATS_PER_WORKSPACE` the oldest are removed, record and transcript,
after the commit and swallowing their own failure, for the reason
`discardHistories` gives.

The sequence a closing conversation goes through — abandon its questions and its
edits in flight, drop its `clearRequests` and `clearedTurns`, close the session —
lives in `closeOneChat`, and `closeChatsOf` is a loop over it. Written out twice
it would drift, which is what `removeProjectById` did before its own cascade was
factored out.

The transcript is **not** among them, and the omission is deliberate. Everything
`closeOneChat` does is memory and a child process, and it runs early — before
the cleanup script, before the worktree goes. A transcript deleted there is
deleted before the steps that can still fail, and a removal that then refuses
leaves a record whose history is gone: the pane draws the conversation empty
above an agent that remembers all of it. So `discardHistories` takes the
transcripts after the state commit instead, and each of the three callers that
wants them gone calls it — the same order, and the same reasoning, as
`removeProjectData`. A file nothing points at is litter; a record without its
history is a lie.

`renameChat` trims what it is handed and stores null for an empty name. Trimmed
in the service rather than at the boundary, because what reaches the record is
what the strip will draw, and a name of three spaces draws as a gap nothing
explains.

## A workspace's status is derived, not written

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
and that moment is when the file gets written. Every stream that leaves this
funnel fires only when its own reading actually changed: a second conversation
finishing does not move a workspace whose first is still running, and announcing
it anyway would redraw the whole list for nothing.

**A conversation is working while its background agents are.** Once its turn
is over it rests at `restingStatus`: `waiting_permission` while an agent's
question is open, `running` while any task is live, and `idle` only after — and
it moves between those as the agents do, whenever no turn is open and no message
is queued behind one. A turn is open from a message sent or taken from the
queue, or from the main agent speaking unprompted — the CLI starts a turn of its
own to hand a finished agent's report over — until its result
(`taskRegistry.ts`). An agent ending takes its open question with it, and the
window is told (`permission_withdrawn`).

A conversation that has stayed at `idle` for a moment (`FINISHED_AFTER_MS`) is
announced as `finished`, which is what the window's "done" is read from. Not at
the result: the CLI hands a finished agent's report over in a turn of its own,
so one piece of work can end in several results, and whether another is coming
cannot be read from anything before it starts. Measured, that turn opens with an
init 0.2 to 0.5 seconds after the agent's end or the result, and a turn opening
cancels the "done" waiting.

Not every task announces its end. A task that drops off the CLI's own list of
what is alive (`background_tasks_changed`) is ended as completed — a workflow is
counted as background work whatever its flag says, since its call returns at
once — and a foreground subagent of the main agent ends with the turn, which it
holds. Either way the end is written to the transcript, so a reopened
conversation reads how it ended. A frame from an earlier run of a resumed task
(`run_id`) ends nothing. A conversation's Stop leaves its agents running
(`perTaskStopAffordance`), so it rests the same way.

**Which conversations a workspace has leaves here too**, as `chats:changed`, and
its reading is the ordered ids and titles — not the statuses. Every status move
comes through this same funnel, so a reading that included them would tell every
window to re-read its tab strip several times a turn, which is the reason the
status stream is a status. Announced here rather than from the five writers that
change the set — open, create, fork, rename, close — because a hand-kept list of
call sites is what a sixth writer falls off; `openChat` and `renameChat` were
routed through the funnel to reach it.

`settleStatuses` follows the same shape on load: the conversations are put down
first, and the workspaces derived from the settled list rather than settled
alongside it by a rule that would drift the first time one of them changed. A
conversation it puts down from `running` or `waiting_permission` is marked
`interrupted` as well: no session survives the process, so the turn was cut off,
and `idle` alone is drawn as finished. `setChatStatus` clears the flag on every
move and `chats:status` says so, so the window copies it rather than keeping
the rule a second time.

`reconcile` puts one more fact on each conversation than its status: `started`,
which is `sessionId !== null`. The list draws a conversation that ran and
finished differently from one nobody has written in, and both of those are
`idle` — so the status alone cannot say which, and this is what does. Note the
order it becomes true in: a turn is under way before the session it runs in has
announced itself, so a conversation is `running` and not yet `started`, which is
the honest reading of both.

## Forking a conversation

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

A fork can also start from a side answer (`forkChat(chatId, aside)`), which is
the CLI's `f to fork` on a `/btw`. The CLI writes the question and its answer
into the forked session file as a turn of its own. That file's format is the
CLI's and undocumented, and nothing here writes it. The exchange goes to the end
of our transcript (the question without a `uuid`, since the agent has no point
to rewind to), the new record carries it as `aside`, and the tab is named
`btw: <question>`. The first message that reaches the agent as a prompt has the
exchange put in front of it (`formatAside`), and `aside` is cleared. A command
is sent as typed, because text in front would stop it being one: `/clear` drops
the exchange, and any other listed command leaves it for the next message.

## What the renderer holds is what the core last said

A patch arriving over IPC is external data like any other. `applyConfig` merged
one straight into memory while `saveConfig` parsed before writing, so the file
was always valid and the copy the application ran on was whatever came — and the
two could disagree until the next restart, which is the kind of bug that
survives a screenshot. The parse now happens on the way in as well, which is the
same parse a moment earlier.

## A refusal does not end the turn

The SDK's deny carries an `interrupt` flag and `agent.ts` leaves it off on
purpose: the refusal reaches the model as a tool result, and the same turn
carries on. That is the whole of deny-with-feedback — "not quite, do this
instead" reaching the agent without costing a turn — and it is what the plan
dialog's "keep planning" is, Escape and the close button included.

So `answerPermission` writes `running` on a refusal, symmetric with the allow
arm. It shipped writing `idle`, on the premise that declining ends the turn, and
the workspace then sat grey for the whole remainder of every steered turn — at
the moment the agent is doing the most work, and with nothing to put it back,
since no agent event writes `running`.

Not `interrupt: true`, which would make the write honest by destroying the
feature. Not leaving it unwritten either: the chat would stay
`waiting_permission`, which outranks `running`, so the list would show the amber
"come and answer this" mark against a question nobody can answer any more.

Self-correcting rather than a second thing to remember — the turn always ends in
a `result`, which writes `idle` or `error`, and `settleStatuses` clears a
`running` left by a crash.

**Back to `running` only when nothing else is asked** (`carryOn`). An MCP
server's form sets `waiting_permission` as a permission does, and two tool calls
can wait at once — a form and a permission, or two permissions. Every answer,
withdrawal and refusal therefore goes through one function that writes
`running` only when no other question of that conversation is still open, and
leaves it waiting otherwise; writing `running` unconditionally put the amber
mark out over a question still on the screen. A message the CLI takes from its
queue (`message_queue` with `started`) goes through it too: after a turn's
result, that is a turn of its own starting.

## A question nobody can answer is withdrawn

`canUseTool` blocks the agent on a promise, so an open permission request is a
turn held open. Every way a turn can end withdraws the chat's questions:
stopping it, the session closing with its workspace, and the `result` or `error`
that ends it on its own. `abandonPermissions` resolves each as a refusal and
drops it — resolving rather than dropping, because the promise is what holds the
tool call, and a refusal is the only answer that cannot start work nobody
approved. It carries `ABANDONED` rather than `DENIED`: the agent reads a
refusal's message as instruction, and nobody declined anything.

Only an answer used to remove one, which let the map outlive the sessions in it.
That was invisible until `pendingPermissions` began handing the first entry it
finds for a chat to whatever window opens the conversation — at which point a
question the user had stopped instead of answering came back with live buttons
on it.

**The bridge can withdraw one too.** `canUseTool`'s third argument carries a
`signal`, aborted when the CLI no longer wants the answer. `askPermission`
listens on it: a question still in `pending` is released as `ABANDONED`, a
`permission_withdrawn` event tells every window to take its buttons down, and
the chat goes back to `running` for the reason the deny path gives — the turn
carries on. Unheard, the card kept live buttons until the turn ended and
pressing them reached nothing. An abort after the answer finds nothing to take
back.

## "Always" is not offered where the bridge forbids it

The same argument carries `suppressAlwaysAllowRule`, set when the rule "always"
would write grants more than the question's own action. On exactly those asks
the suggestion names no narrow rule, so `standingFrom` would fall back to the
whole tool — every `Bash` command, for one `ls`. The flag rides on the
`permission_request` event, where the card reads it and draws no "Always", and
on the pending request, where `answerPermission` reads it and stores nothing:
an "always" that arrives anyway, from a card drawn before, approves the one call.

The other half of the same rule: the entry is removed where the answer is
**given**, after the writes that can fail. Removing it first meant a config
write that failed left the agent blocked on a question nothing could ask again —
the window had dropped its copy, and `pendingPermissions` had none.

Only the session's own stream reaches `handleEvent`; a background write that
failed is reported straight to the listeners by `report`. That is what makes the
`error` case safe to withdraw on.

## What a stopped turn was holding goes with it

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
