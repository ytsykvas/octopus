# A refused paste is shown back twice, and bounded nowhere

**Found:** 2026-09-04, split off from
`a-refused-value-is-reported-as-a-json-dump.md` when that one landed. The
boundary now answers in words; what is left is where the user meets it.

## What happens

Nothing in the renderer bounds any input. `grep -rn "maxLength" src/renderer/src`
returns no hits, so no `<input>` or `<textarea>` in the app has a ceiling — while
core bounds a chat message at 100,000 characters, a chat title at 60, an
instruction body at 16,000, a repo-config project body at 8,000, and an env
profile body.

Those bounds are reachable by ordinary use. `chats.ts` says so in its own words:
the cap exists because "anything past this is a pasted file, which belongs in
the workspace where the agent can read it rather than in the conversation" — a
statement about what people do, not about a compromised renderer. So
`docs/ipc.md`'s justification for the other parses does not cover these.

**And the failing turn shows the paste back twice.** `useChat.send` draws the
message into the log optimistically, while `Composer` only clears the field on
success. So a refused 200,000-character paste is on screen in the log _and_
still in the composer, with the refusal underneath.

## Why it matters

The refusal is now a sentence rather than a JSON dump, which is the half that
landed. This is the other half: the reader is told what was wrong while looking
at two copies of the thing that was wrong, in a window they now have to scroll
to get back to.

Low, in the sense that the work is not lost — the text is still in the field.
Ordinary, in the sense that pasting a file into a chat is a thing people do
without thinking about it.

## What is already decided

**`maxLength` alone is the wrong fix for the composer.** A textarea with
`maxLength` silently truncates a paste, and silently keeping the first 100,000
characters of somebody's file is worse than refusing it — the agent would then
answer about a fragment nobody knew was a fragment. The refusal is right; what
is wrong is what the pane does around it.

`maxLength` **is** right for the short fields, where the ceiling is a name
rather than a body: a chat title at 60 characters cannot be pasted into by
accident in a way that matters, and stopping at 60 is what every other rename
field in every other application does.

## Sketch

Three separable pieces, in the order they are worth doing:

1. **Do not draw the message into the log until it is accepted.** That is one
   condition in `useChat.send`, and it removes the duplicate outright.
2. **`maxLength` on the fields whose bound is a name** — the rename field, the
   env profile name — so the boundary parse there goes back to being the
   unreachable defence `docs/ipc.md` describes.
3. **Say the limit before it is hit** on the composer, if anything: a count
   that appears only near the ceiling is the usual shape, and it needs a
   decision about whether the composer's footer has room for one at all.

The refusal message itself needs nothing further: `valueRefused` carries zod's
own reason, which names the limit.
