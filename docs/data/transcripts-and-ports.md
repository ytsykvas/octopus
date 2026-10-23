# Transcripts, ports, and what is not stored

## Transcripts

The SDK's `resume` restores what the _model_ remembers, which is not what the
screen has to draw. Without a record of our own a chat comes back empty after a
restart while its session is very much alive.

One JSONL file per chat, appended to as events arrive. Append-only because the
alternative is rewriting a growing document on every event — an hour-old chat
would spend most of its time serialising its own past. A line that does not
parse is skipped rather than thrown on: a crash mid-write leaves a truncated
last line, and losing the conversation over a partial byte is worse.

Streaming fragments are **not** stored. The finished block follows immediately
after, and keeping both would replay every answer twice on the next launch.

One kind of entry arrives **after** the one it describes. The lines around a
change are read from the file once the edit succeeds, and a file read is not
something the event handler can wait for without letting later events overtake
earlier ones — so `change_context` is written whenever the read returns, and
carries the `toolUseId` it belongs to. Whatever draws the log pairs them up by
that id rather than by position, and treats the entry as invisible where it
lands: it may fall in the middle of a run of later tool calls, and a break the
reader cannot see is worse than none.

The filename is the chat id, a uuid, and the directory is flat. A chat outlives
the name its workspace had when it started, so filing it under that name would
either strand the file on a rename or require moving it.

## What is deliberately not stored

The subscription's rate limit lives in the service's memory and never reaches
`state.json`. It describes the account at this moment and expires on its own, so
a reading restored from disk after a night is worse than none: it would be drawn
with full confidence and be wrong. It is re-learned from the first turn that runs.

**The context share is not kept at all**, not even in memory: it describes a
live child process, and once that process ends the next one rebuilds a context
we never observed.

**A successful tool result keeps only its head**, 2000 characters, marked
`truncated` so a reader can tell a cut output from one that simply ended. A
`Read` of three thousand lines, a `Bash` printing a build log and a `Grep`
across the repository were once each written whole and parsed back on every
open. The transcript is append-only and never trimmed, so the cost of opening a
conversation grew with everything the agent had **read** rather than with what
it said.

The head is what the log draws — the first lines under a call's row, and the
start of its output when the row is opened — so it is what is kept, with
**`lineCount`** saying how long the whole was. Without it "1 210 lines" read live
would read "57 lines" after a restart. The opened row says that only the start
was saved rather than passing the head off as the whole.

Two fields beside it come from the tool's structured output, never cut:
**`stats`** — the counts a summary needs (lines read, files and matches found, a
subagent's tool uses) — and **`report`**, a subagent's answer in its own words.
The result's text carries the CLI's trailer after that answer, the agent's id
and a usage block meant for the model, and a report is often longer than the
head: it is the one thing the subagent was for. A conversation recorded before
these existed has none of them, and the log falls back to counting the head —
saying "at least" when the head was all there was — and to the text with the
trailer taken off.

**A failure keeps everything** — its content is the whole of what the failure says,
and the pane shortening it from the middle is a decision about reading rather
than about storage. And the bound is on the transcript alone: the live event
reaching the window carries the lot.

**The plan windows are the exception, and were not always.** They used to be
cached beside the rate limit and go no further, on the reasoning above — a
reading restored after a night would be drawn with full confidence and be
wrong. They are written to `state.json` as `usageWindows`, because they moved
out of the composer and into the left column's footer, where they are on screen from the
moment the window opens. The block fills within a second of the window taking
focus now, so what this buys is that second rather than a whole launch — and a
block drawn empty for it would flicker on every start.

`usageWindows` is a **new key** rather than the reshaped `subscriptionUsage` it
replaces, which held the five-hour and weekly windows alone. `readJsonFile`
throws on a shape mismatch rather than falling back, so widening the old field
in place would have stopped every existing installation opening; zod drops the
key it no longer knows, and the first read fills the new one. The reading now
carries **every** window the account reports and the moment it was taken —
`resetsAt` says a window has since emptied, and cannot say how old the share
beside it is.

`readAt` is when the app asked, which says nothing of the answer: the CLI falls
back to older figures when the endpoint refuses, silently. So the reading also
carries `asOf`, the moment the figures describe, **or null when they are live**.
It is stored, so it has a default — a reading written before it existed loads as
"not known to be old", which is what it was.

What makes the trade different from the rate limit's is that the objection is
answerable here. A window carries `resetsAt`, so a reading can be checked
against the clock: past that moment it is drawn faded and says so, rather than
standing there as fact. The rate limit has no such handle, so it still expires
into nothing.

It is written only when it changes — the figures are read at the end of every
turn, on every return to the window and every three minutes besides, and a write
per read would put the busiest path in the app on the state
file to record a number that had not moved.

Three things write it now — a turn ending, a `/usage` somebody typed, and the
limits block's own refresh — through one function, so they cannot drift about when a
reading counts as new.

The `usage` event in a transcript is not an exception to any of that, though it
looks like one. It is not a reading kept in case it is wanted later; it is the
answer to a command somebody typed, dated to the moment they typed it. The
figures in it are stale by design, the same way every other line of a transcript
is — and a log that kept the question and dropped the answer would be worse read
back than one that kept neither. It is a record of the conversation, and the
readings above are not.

## Ports

[`ports.ts`](../../src/core/ports.ts) hands out **blocks of ten from 3100**, twenty
of them: a workspace gets `3100`, and `3101`–`3109` are its own to use for a
second server. It starts at 3100 rather than 3000 because 3000 is what an
unconfigured framework binds, and a pool meant to coexist with that must not
begin by fighting it.

`firstFreeBlock` takes the lowest block no workspace holds **and** nothing
answers on — the second half is the one that matters, since a port another
application is holding is not in our records and used to be handed out anyway.
`settlePort` asks again on the way into a run, while nothing of that workspace
is alive, which is what makes the answer knowable: anything answering then
belongs to somebody else. A pool with nothing free answers with the port the
workspace already had, so the failure is the server's own and not an invented
one of ours.
