# The Enter that only confirms an IME candidate sends the message

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

The composer's textarea handler ends with
`if (event.key !== 'Enter' || event.shiftKey) return; event.preventDefault(); submit()`.
Nothing asks whether a composition is in progress.

In Chromium — which is what an Electron renderer is — the Enter that commits an
IME candidate arrives as a `keydown` with `key: 'Enter'`, `keyCode: 229` and
`isComposing: true`, before `compositionend`. React fires `onChange` on every
composition update, so `draft` holds the uncommitted reading at that instant, and
`submit()` sends it.

Verified by rendering `Composer`, dispatching `compositionStart`, a change to a
kana reading, then `keyDown {key: 'Enter', keyCode: 229, isComposing: true}` —
`onSend` was called once with that unconfirmed reading.

`PlanDialog`'s feedback field carries the same three lines, and it is the only way
to answer that dialog at all.

**`preventDefault()` does not cancel the commit.** The IME has already consumed
the key before the DOM event, so the composition still commits and the confirmed
text stays in the field, racing with the `write('')` that `submit()` performs once
`onSend` resolves. The visible failure is a message sent from a sentence still
being typed, and a field whose contents afterwards depend on that race.

## Why it matters

For anyone typing through an IME the main input of the application is unusable:
every word committed fires a message to the agent, and there is no way to finish a
sentence.

The failure is silent and looks like the app sending on its own — the person did
not press Enter to send, they pressed it to choose a character.

A grep across `src/` finds no `isComposing`, no `compositionstart` and no
`keyCode === 229` anywhere, so **no field in the window is guarded**.

## Evidence

- `src/renderer/src/components/chat/Composer.tsx:394-396`; `:353-360` and
  `:275-304` — `onChange` writes every composition update into `draft`, and
  `submit()` sends from that state.
- `src/renderer/src/components/chat/PlanDialog.tsx:73-77`.
- `src/renderer/src/App.tsx:340-392` — the only window-level keydown listener;
  every branch requires `metaKey` or `ctrlKey`, so it does not intercept first.
- `Composer.test.tsx` exercises only plain `{Enter}`, `{Shift>}{Enter}` and the
  suggestion list; the whole suite contains no composition event.

**The suggestion branch is not the relevant path.** `suggesting` requires
`readCommandQuery` to match `/^\/([\w:-]*)$/`, which no kana, kanji or hangul
character satisfies, so an open suggestion list and a CJK composition cannot
normally coexist. Only a romaji composition typed straight after a `/` reaches
it. The bug is the fall-through.

## What is already decided

1. **`event.isComposing` will not work.** React's `SyntheticKeyboardEvent` does
   not carry it — it is absent from `React.KeyboardEvent` in the TS types — so
   the guard must read `event.nativeEvent.isComposing`. Writing
   `event.isComposing` gives a type error at best and `undefined` at worst, which
   is a guard that silently never fires.
2. **`nativeEvent.isComposing` alone is not the whole story on macOS.** Some IMEs
   dispatch `compositionend` _before_ the Enter keydown, leaving `isComposing`
   false on the very keydown that ends the composition. The robust guard is
   `event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229`. Both
   reads are typed and legal — the deprecated `keyCode` still exists on the
   native `KeyboardEvent` type.
3. **It is testable, but not through `user-event`:** `{Enter}` from
   `userEvent.keyboard` cannot express a composition. It needs
   `fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 })` after
   `fireEvent.compositionStart` — jsdom's `KeyboardEventInit` accepts
   `isComposing`. With 100% coverage enforced, both branches need a case anyway.

## Sketch

Return early at the top of the handler — before the suggestion branch, since the
arrows and Enter belong to the candidate window while it is up.

**Three more sites have the same unguarded Enter, and the rename one is the worst
because it writes to disk:**

- `NameEditor.tsx:59-63` — Enter commits a workspace rename, so a half-composed
  name becomes the branch and directory slug. It also commits on blur, so the
  IME's own focus behaviour is a second path in.
- `Combobox.tsx:84-88`.
- `ProjectSettings.tsx:406` and `:597`, where Enter blurs and thereby commits.

`CommentedRow.tsx:222` is already safe — it requires `metaKey || ctrlKey`, which
an IME commit never carries.

This is the same three-line guard in five files, and the project's own instinct
argues against five copies: `commandMatch.ts` exists because "every decision
about _when_ the suggestion list appears lives here rather than in a condition
inside the field's key handler". A small shared helper — `sendsOnEnter(event)`
beside `commandMatch.ts` — is the shape.
