# A save the boundary refused is drawn as saved

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`scripts:save`, `carry:save`, `env:save` and `instructions:save` all answer with a
`Result` and can genuinely fail — each parses its body first (64k, 8k, 16k, 16k),
`requireProject` can throw because the project was removed in another window, and
the write itself can fail.

Every one of the four callers throws that `Result` away: `void window.octopus...`
at `InstructionEditors.tsx:106` and `ProjectSettings.tsx:553`, `:576`, `:672`.

The shared `FileEditor.commit` makes it worse than a missing message. It does
`setSaved(body)` **before** `save(body)`, and the next `commit` returns early on
`body === saved`. So the component records the text as persisted on the strength
of having sent it.

`attempt` resolves a throw into `{ ok: false, … }`, so a discarded save is not
even an unhandled rejection. Nothing anywhere logs it.

The unrecoverable sequence is: paste oversized text → blur → close the dialog.
(Keep editing and the next keystroke makes `body !== saved`, so the next blur
does send again — and is refused again, still silently.) Reopening remounts
`FileEditor`, `read` fetches from disk, and the old text is back with nothing
having said why.

## Why it matters

The blur looks exactly like a successful save: no error, no warning, no dirty
state. main did the work of explaining the refusal — `attempt` produced a
`Result` with the reason — and the window discards it, so the one channel that
could report it is unused.

For a `.env` profile over 16,000 the consequence is worse than a lost edit: every
workspace prepared afterwards silently gets the previously saved variables.

The asymmetry is the tell — `FileEditor`'s read path deliberately handles failure
(a null leaves the field empty, and there is a test for it), while the write path
has nowhere to put one. And the same Env section of the same dialog **does**
report its other failures (`ProjectSettings.test.tsx:819`, `:857`), so the silence
on the body saves is an inconsistency, not a decision.

## Evidence

- `src/renderer/src/components/FileEditor.tsx:70-78` — `commit`: the optimistic
  mark and the missing outcome; `:12` — `save: (contents: string) => void`, no
  channel for a `Result` even if a caller wanted one; `:51-60` — the read path's
  deliberate failure handling.
- `src/renderer/src/components/InstructionEditors.tsx:101-107` — `read` checks
  `result.ok`; `save` two lines below does not.
- `src/main/ipc.ts:220-228, 238-240, 321-329, 382-392` — the four handlers.
- `src/core/scripts.ts:37`, `src/core/carry.ts:32`, `src/core/env.ts:41`,
  `src/core/instructions.ts:49` — the four caps.
- `src/renderer/src/components/ProjectSettings.tsx:183, 211, 390-394` —
  `describeFailure`, the `error` state and the banner that already exists in this
  very component and is never fed by the four saves.
- `FileEditor.test.tsx` never mocks a failing save.

## What is already decided

**`FileEditor` is shared by two dialogs and only one has an error surface.**
`ProjectSettings` has the banner; `Settings.tsx` renders `InstructionEditors`
through `InstructionsSection` and has no error state at all. So "pass an
`onError` up to the host dialog" fixes three of the four sites and leaves the
global instructions editor with nowhere to put the message.

Widening `save` to `(contents: string) => Promise<Result<void>>` and having
`FileEditor` render the failure itself, beside the existing `problems` list at
`:109-118`, covers all four and is the only shape that reaches the global dialog.

**A surfaced zod refusal would break the localisation rule.** `attempt` attaches a
`code` only for the eight named classes, so a `ZodError` shows raw English zod
text in a localised frame. See
`a-refused-value-is-reported-as-a-json-dump.md` — doing this properly means the
four boundary parses throwing a coded error. `src/core/repoConfig.ts:172-173`
picks the same three schemas for the import path, so whatever coded error is
introduced is shared with that boundary.

## Sketch

Only `setSaved(body)` when the answer is `ok`.

**Rolling `saved` back on failure must not clobber typing.** `setSaved(previous)`
after an await can land while the user has already changed the text; the read
path solved the same race with an `AbortController` (`FileEditor.tsx:51-64`) and
the write path needs the same care.

Better still, tell the user before the round trip: `notes` already runs on every
keystroke and is the natural home for "this is longer than N characters and will
not save" — which also matches the comment at `FileEditor.tsx:80-81` about a
warning arriving in time to act on.
