# Three test files hand-roll the workspace factory

## What happens

`src/renderer/src/test/workspaces.ts` exports `workspaceView(name, overrides)` —
a `WorkspaceView` with every field filled and an overrides bag, written so a test
about one field does not spell out the other sixteen.

Three test files carry their own copy of it anyway:

- `src/renderer/src/components/WorkspaceRow.test.tsx`
- `src/renderer/src/components/Sidebar.test.tsx`
- `src/renderer/src/components/chat/ChatSession.test.tsx`

Each is a local `workspace()` returning the same shape with slightly different
constants.

## Why it matters

Every field added to `WorkspaceView` has to be added in four places instead of
one. That has now happened twice in quick succession — `headOnBranch` and, before
it, the fields the publish state brought in — and each time it is four identical
edits that TypeScript catches one at a time.

TypeScript catching them is the saving grace and the reason this is a note rather
than a bug: the copies cannot silently drift out of shape. What they _can_ drift
in is their **values**. `workspaceView()` names its branch `ytsykvas/<name>` and
the copies do not all agree, so a test that reads a branch name reads a different
one depending on which file it lives in — which is how an assertion ends up
pinning a fixture rather than a behaviour.

## What is already decided

- **The shared factory is the survivor.** It is the one under `test/`, it is what
  the newer test files use, and its docblock explains the naming.
- **Not a source change.** Nothing under `src/renderer/src/components/` moves;
  this is four test files and their imports.

## A sketch

Delete the three local copies, import `workspaceView`, and fix up the call sites
— they take `(name, overrides)` where the local ones take `(overrides)` alone, so
the edit is mechanical but not a search-and-replace.

Worth doing when the next field is added to `WorkspaceView`, since that is the
moment the cost is being paid anyway and the diff will already be touching all
four.
