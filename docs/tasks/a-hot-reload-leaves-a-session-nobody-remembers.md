# A hot reload leaves a session nobody remembers

**Found:** 2026-08-19, as the remainder of "the renderer forgets what is
running", most of which is now fixed.

## What has been fixed

A **reload** no longer leaves anything behind. `did-start-loading` on the
window's webContents ends every session that window owns, so a document that
starts fresh starts with nothing running — the same treatment quitting already
gave. What is on screen is true again after ⌘R and after a renderer crash.

## What is left

A Vite HMR update is **not a navigation**. React Fast Refresh replaces the
modules that changed and leaves the document alone, so nothing in `main` fires
and nothing can. Edit `RightPanel.tsx` while a server runs and `useRunSequence`
resets while the pty carries on: the header offers `Run`, the port is held, and
pressing it starts a second server against the first.

This is development only — a released build never hot-reloads — but development
is where octopus is written, and it cost most of an evening the first time.

## Why it is not simply "dispose on any remount"

The obvious hook is the renderer telling `main` it has started fresh. There is
no such moment: Fast Refresh remounts only what changed, `App` usually survives,
and the components that do remount are also the ones that mount when a pane is
folded and unfolded. Disposing there would kill a server for opening the
Terminal tab.

## Evidence

- `src/main/index.ts` — `did-start-loading` is the only signal `main` gets, and
  HMR does not produce one.
- `src/renderer/src/hooks/useRunSequence.ts` — the stage lives in `useState`,
  which Fast Refresh resets when the file holding it changes.
- `src/main/terminals.ts` — `disposeFor` can end a window's sessions; nothing
  asks it to on an HMR update because nothing knows one happened.

## Sketch

The renderer is the only side that can tell. Vite exposes `import.meta.hot`, and
a module that owns a session could dispose on `hot.dispose` — but the sessions
are owned by `Terminal`, which is not usually the module being edited.

The honest version is the other direction: let the renderer ask what exists.
A `terminal:list` answering with the live sessions, and a spec that records the
workspace and the kind, so the pane can reconcile on mount instead of guessing.
That was the design turned down when this was first written, on the grounds that
disposal is simpler — which it is for a reload, and is not for this.

Cheapest thing worth doing before any of it: make the failure legible. A server
holding a port that the pane has forgotten produces "a server is already
running" from somebody else's tool, which is the message that sent this hunt
into the user's own script twice.
