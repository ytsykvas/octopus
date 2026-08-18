# An emptied instruction breaks the button that sends it

**Found:** 2026-08-18, while checking whether pull request instructions were
ready to use.

## What happens

Emptying a project's `pull-request.md` is a **supported choice**. `data.md` says
so plainly: "An empty project file counts as an answer. Emptying it says this
project adds nothing, and falling through to the global one there would make
that impossible to express."

So `effectiveInstruction` answers with `''`, exactly as designed. Then the pull
request tab's "ask the agent to describe" button hands that to `chats:send`,
where `ChatMessageSchema` is `z.string().min(1)` and rejects it. The press comes
back as a failure with whatever prose an unlabelled zod error produces — about
a message, in a pane the reader was using to talk about instructions.

Reproduced against a temporary data root, not against anyone's own:

```
effective = ""
accepted by ChatMessageSchema = false
```

## Why it matters

Two parts of the app disagree about what empty means. One treats it as an
answer; the other as a mistake. The reader who used the documented feature gets
an error naming neither.

It is also the wrong shape of failure. Nothing is broken — the project simply has
nothing to add, and the honest response is either to send the installation's own
or to say the button has nothing to send, not to refuse mid-way with a
validation message.

## Evidence

- `src/core/instructions.ts:127-137` — `effectiveInstruction`; `??` keeps `''`,
  which is what makes an empty file an answer rather than a fall-through.
- `src/core/chats.ts:542` — `ChatMessageSchema = z.string().min(1)`.
- `src/renderer/src/components/PullRequestPanel.tsx:207-213` —
  `askForDescription` sends whatever came back, unchecked.
- `docs/data.md` — the sentence that makes the empty file deliberate.

## What is already decided

An empty project file means "this project adds nothing". Do not reopen that by
making it fall through to the installation's own — the note in `data.md` says
why that spelling was rejected, and it is still right.

`ChatMessageSchema` should not accept an empty message either. A prompt with no
text in it is not a thing to send.

## Sketch

The disagreement belongs in the renderer, where both facts are known. Read the
effective instruction when the tab draws — it is already read on the press — and
where it is empty, disable the button and say that this project adds nothing to
a description, with a way to the place that is written.

That keeps both rules intact and turns a failed press into a state the pane can
explain before anyone presses anything.

Worth deciding at the same time: whether the button should then offer to send
the installation's own instead. Probably not — the project said it adds nothing,
and quietly substituting the global one is the fall-through that was already
turned down.
