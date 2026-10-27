# Models, effort and resets

## Which model is running, and where that is readable

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

**One `/model` argument is followed by the record: `opusplan`.** The CLI scopes
the command to the session, so the record stayed at `null` and the panel drew
Opus on both rows over a session running two models. The alias is exactly what a
split already says — Opus while planning, Sonnet otherwise — so `opusPlanSplit`
(`chats.ts`) turns the message into the two settings, and the window writes them
through `setModels` once the send has been accepted. It is the
window's job rather than the core's because nothing tells a window that a record
changed; a write made in `sendToChat` would never have reached the panel.

**A plan handed to a new chat starts out of planning.** `planHandOff` builds the
record with `planMode` off, so `sessionModel` and `effortInForce` answer with
`model` and `effort` from its first message — the executor is on the model that
writes code without anyone pushing it there, and the `opusPlan` preset leaves
it alone because that waits for a message sent while planning.

**The `opusPlan` preset puts a session on that alias by itself.** With the
setting on (`config.opusPlan`, Settings → Claude), the first message a session
gets while the chat is planning is preceded by `setModel('opusplan')`, once per
session (`opusPlanSettled`). From then on the CLI moves between Opus and Sonnet
with the mode, so `pushModel` sends nothing to a session in `onOpusPlan`: a name
sent at the moment a plan is approved is what raced. Turning the setting on also
writes the pair the alias stands for (`opusPlanPair`) into the settings, so the
panels draw what is running. A typed `/model opusplan` puts the session on the
alias the same way, and the record catching up with it in `setChatModels` is
recognised by the pair and sends nothing. A different pair chosen by hand takes
the session off the alias, and the preset does not put it back at the next
message. Both sets are keyed by the session, so a restart forgets them.

The pair is written **in one call**. Two calls, one per field, each pushed the
effective model to the running session, so a refusal of the second left half a
split behind that the session had already been told — Sonnet under both jobs,
with planning about to run on it. The same holds for the panels: a click there
can move both fields (`chooseWork` in `chats.ts`), so `setChatModels` and
`setChatEfforts` take either field or both, and nothing writes them one at a
time.

The names come from the catalogue, not from the alias: a live one holds
`opus[1m]` and no plain `opus`, and `default` resolves to the same model without
being Opus by name. If the catalogue cannot express the pair the record is left
alone, which is what happened before. The argument is matched exactly — whether
the CLI takes `OpusPlan` is not measured — and acceptance is the send's, not the
CLI's: a command it refuses in its reply still leaves the split in the panel.

## Two models, and when one replaces the other

A conversation holds two: `model` for writing the code and `planModel` for
planning. `sessionModel` folds them into the one the SDK takes — see
`docs/data/state.md` for why the two nulls mean different things — and nothing but its
return value is ever handed to `setModel` or to `SessionOptions.model`.

Which means the effective model can move without anyone naming one, at exactly
three moments: planning turned on or off, a plan approved, and the settings
changing under a chat that still holds the previous pair (`followModelSettings`,
which moves the record and hands each chat to the same push). `pushModel` handles
all three, and the guard in it is what keeps the paragraph above true — it sends
nothing unless the value actually changed, so a conversation whose two jobs
share a model is never pushed at, and a `/model` given to it still stands.
"Changed" is measured against the value in force **just before this change's
commit**, read inside it by `changeInForce`. Read before the commit, two
changes in flight both saw the same value: planning switched on and off at once
moved the session onto the plan model, and the second change, finding what it
wanted equal to what it had read, sent nothing back — the record said planning
was off over a session still on the plan model.

That is a change **this application made and knows the moment of**, which is the
whole difference from re-asserting per message: sending a message moves nothing,
so a push there would still be undoing `/model` and nothing else. On an approved
plan it goes out **before** the permission reply resolves — the reply is what
releases the tool call, and there is no `updatedModel` to ride along with the
mode the way `updatedPermissions` carries it.

## Two efforts, and one of them folded into two

A conversation holds a pair here as well: `effort` for writing the code and
`planEffort` for planning, folded by `effortInForce`. The argument is the model
pair's word for word and arguably harder — somebody who has one model think an
approach through and another carry it out wants **more** thinking in the first
half and less in the second, which is one judgement of which half used to be
expressible. It also costs money in the direction nobody wants: effort left
where planning needed it is what every file edit after the plan is paid for.

Two cases rather than `sessionModel`'s three. There is no "the agent's own
default" here, because effort is always a level and `null` can mean nothing but
"no split".

`pushEffort` is `pushModel`'s twin, at the same two moments and with the same
guard: a conversation whose two jobs share an effort is never pushed at, so
`/effort` given to one still stands for its turn. It also runs on the setter,
which the model pair does not need — setting the working level while a
plan is being made must move nothing, and the guard is what says so.

`planEffort` starts null and is never copied from the settings: there is no
application-wide effort for planning, and there should not be. It does come
along on a fork, unlike `planMode` — it is a statement about how this task
should be approached, and a fork is another go at the same one.

## One effort, folded into two

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
said, `false` included, and the reason is that same shallow merge rather than
anything about what else is loaded: a key left out is a key left standing, so
silence would keep the last session's answer. That used to be argued from
`settingSources` being empty. It is not empty — the default loads `user`,
`project` and `local`, so a settings file can carry the flag too, which is one
more reason to state it outright instead of hoping nothing else does.

## A reset is not consent

`conversation_reset` is emitted by `/clear`, by leaving plan mode, and by
fresh-session flows. Only the first should empty the log. A newer CLI names the
cause in `trigger`, and `mapMessage` reads `clear` as asked for and anything
else as not. An older one sends no `trigger`, so the intent is also recorded
where it is known — `sendToChat` notes that the message was a clearing command,
aliases included — and consumed by the event it caused. Read off an untagged
event alone, approving a plan would erase the conversation that produced it. A
named cause outranks the note: a reset tagged as another flow's leaves a waiting
`/clear` for its own reset.

**The clearing turn outlives its own reset by one event.** The transcript is
discarded the moment the reset says it was asked for, and the command's own
`result` arrives a tick later — recreating the file it had just removed, to hold
the footer of a turn nobody can see. An emptied conversation reopened as one row
reading `0.1s · 0 tokens`, and clearing again only replaced it.

So the request is consumed in two steps rather than one: `clearRequests` ends at
the reset, `clearedTurns` at the result that follows it. Only the **writing** is
skipped — the result is still announced, being what stops the composer offering
to stop.

A request is added only as the message goes to the session, and only while that
session is still the chat's. Added earlier, a start that failed or was refused,
or a session a close or a rewind ended while the mode was being set, left it with
no reset coming, and the next reset the agent sent of its own accord was read as
the clear. A `/clear` that also restarted the session for a new compaction
window was lost the other way: the restart emptied the set first.

Both sets are also emptied with the chat when its workspace is removed, which is
bookkeeping rather than a guard. Neither can strand a flag that matters: a
`/clear` whose result never arrives means the session stopped answering, and
every session dropped — a tab closed, a workspace removed, a rewind, a new
compaction window — goes through `closeOneChat`, which empties both; none is
dropped on an agent error. A session that dies is kept in `sessions`, so there
is no later turn for a stale flag to swallow.

A session also goes when its conversation has been **at rest for ten minutes**
(`IDLE_RELEASE_MS`, swept once a minute): a CLI process of a hundred megabytes
and more, plus the MCP servers it started, held for as long as its tab was
open — a conversation that answered once in the morning kept its process all
day. `releaseSession` takes only what belongs to the process (`sessions`,
`compaction`, the activity clock) and leaves the record, the tasks' history and
the last context reading, which `sessionUsage` goes on answering so the strip
above the composer does not blank; the next message starts a session again from
the same id, as a restart does. "At rest" is `atRest`: idle or errored, no turn
open, no agent live, no question waiting, nothing held in the CLI's queue, no
edit announced and unfinished, no `/clear`, rewind or push pending, no session
on its way up, and the account not being read. Rest is measured from the last
event heard or the last time the session was asked for.

The log has the matching rule, because the transcripts written before this did
not get one: a footer at the head of the log closes no turn, so `buildBlocks`
does not draw it.
