# A shortcut still makes a workspace while a dialog is open

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`App` registers one `keydown` listener on `window`. Only the ⌥ branch asks where
the keystroke landed — `if (takesText(event.target)) return`, because ⌥ types
characters on macOS. The ⌘ and ⌃ branches ask nothing, and **nothing anywhere
asks whether a dialog is open**.

Modals are native `<dialog>` elements opened with `showModal()`, which makes the
page behind them inert to pointer and focus but does not stop a keydown from
inside the dialog bubbling to `window`. Only ⌘, is claimed by the native menu.

So with Settings, Project settings, the repository picker or a confirmation on
screen, ⌘⇧N still fetches, adds a git worktree and cuts a branch; ⌘T still opens
a conversation (up to the three-per-workspace cap); ⌘⇧D, ⌘⇧P, ⌘1-9 and ⌃1-9 all
still move the selection.

## Why it matters

The sharpest case is **`RepoConfig`**. `ProjectSettings` passes the live
`workspaceId` down, and `RepoConfig.tsx:87` re-reads
`projects.scripts(projectId, workspaceId)` on a `[projectId, workspaceId, trusted]`
dependency. That list of the checkout's scripts sits directly above the
per-project trust checkbox.

So ⌃3 behind the open dialog swaps the scripts being listed for another
workspace's, with nothing on screen naming which workspace they belong to — and
the tick that follows trusts the repository having read a different set. That
also contradicts what `docs/ui.md:662` promises of this dialog: "It asks about
the workspace the dialog was opened from."

⌘⇧N is the noisier one: a worktree appears behind the dialog, and `setEditingId`
opens the rename field on a row that is inert, so `autoFocus` cannot take. When
the dialog closes the field is sitting open and unfocused, and typing goes
nowhere until it is clicked.

## Evidence

- `src/renderer/src/App.tsx:392` — the listener; the handler spans `:311-390`
  with no modal check. `:327-333` — `takesText` is inside the `altKey` branch
  only. `:344-348`, `:383-389`, `:802-859`, `:817`.
- `src/renderer/src/components/Modal.tsx:79` — bare `element.showModal()`; the
  component has no keydown handler at all. The `onKeyDown` handlers in the
  dialogs are two local Enter/Escape inputs (`ProjectSettings.tsx:405`, `:596`)
  and `Combobox`'s arrow-and-Enter list (`Combobox.tsx:75`, used at
  `ProjectSettings.tsx:521`); none of them stops propagation.
- `src/renderer/src/components/RepoConfig.tsx:87`, `:96`, `:203-213`.
- `src/renderer/src/hooks/useWorkspaces.ts:279`;
  `src/renderer/src/components/NameEditor.tsx:51`.
- `src/main/index.ts:84` — the only `accelerator` in the file.
- `App.test.tsx` exercises every shortcut (`:517, 553, 608, 1591, 1748, 1935,
1989`) but never with a dialog on screen.
- `docs/ui.md:1037-1042` and the matching comment at `App.tsx:328-332` argue only
  about text-entry surfaces and why ⌥ is special; neither considers a modal.

## What is already decided

**`if (document.querySelector('dialog[open]')) return` was ruled out because not
every open `<dialog>` here was a modal — and that reason has gone.**
`DropdownMenu` is a portalled `<div role="menu">` (`DropdownMenu.tsx:184-187`)
and `ModelPicker` a `<div role="dialog">` (`chat/ModelPicker.tsx:163-164`), so
neither would match; `Modal.tsx:86` is the only `<dialog>` left in the renderer,
and it is always opened with `showModal()` (`:79`). The query would match modals
and nothing else.

The narrow test is `dialog[open]:modal`, or a piece of state in `App`: every
modal here is already conditionally rendered from `App`, and all four booleans
are in scope at line 310, so no new plumbing is needed. The confirmation is the
awkward one — `useConfirm` returns only `dialog: JSX | null`, so `App` cannot
currently see whether one is pending without the hook exposing it.

**⌥1-3 is not exempt.** It returns early only when the target is an input or
textarea; pressed on a dialog's own body or on a button inside it, it still
switches conversation behind the modal.

## Sketch

One guard at the top of `onKey` reads better than a check per branch.

Budget for the coverage cost: at 100% enforced, each new guarded branch needs a
renderer test that opens a modal and fires the key. The stub is already shared —
`stubDialogElement` (`src/renderer/src/test/dialog.ts:12-22`), which
`App.test.tsx:16` imports — but it sets the `open` attribute and nothing more:
jsdom implements neither `showModal` nor `:modal`, so a `:modal` selector will
not match there at all. That is a concrete argument for the state-based guard
over the DOM query.
