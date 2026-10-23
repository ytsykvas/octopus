# Diffs, writes and errors

## What a diff counts is exact; what it draws is bounded

The counts come from `git diff --numstat` and are always right, whatever else
happens. Only how much of a change is **drawn** is limited, and a file left out
says so rather than quietly appearing unchanged. Keeping those two apart is what
lets a pane degrade into "this file is too large to draw" instead of into a
failure.

The ceilings used to count files and lines only, and a line has no length: a
source map or a minified bundle is two changed lines and passes every one of
them, then puts megabytes through a buffer that holds 32MB. So there is a byte
ceiling beside the line one, applied by handing git `core.bigFileThreshold` —
past it git reports a file as binary rather than writing its content out. That
flag goes **only** on the call carrying the lines: under the same setting
`--numstat` answers `-`, and the counts are the half that must not move.

Two consequences worth keeping:

- **The pathspec has to be built from what was drawable, not from what is left.**
  Comparing the drawn files against an already-marked list compares two numbers
  that are equal by construction, so git is asked for the whole diff whatever the
  ceilings said — and the file the ceiling excluded arrives in full anyway.
- **Untracked files are not a special case.** They are measured before they are
  read, read one at a time, and share the same budget as everything else.
  Reading them all at once and measuring afterwards means a workspace whose
  build output is not ignored opens a read per file in the tree.

## Reading and writing about the same thing live apart

`diff.ts` opens by promising that nothing in it writes: "a review pane that
modified the repository it is reporting on would change the answer by asking the
question." Reverting a file is the operation that undoes what the pane draws,
which makes it the obvious thing to add there and the wrong thing to add there.

So `revert.ts` sits beside it and borrows one function, `mergeBase`, which is a
read. The promise survives, and a reader of either module can tell at a glance
which of the two can change the repository.

The rule inside it is worth carrying elsewhere: **which command to run is
decided by asking git, not by branching on what git already told us.** The diff
reports a `FileStatus`, and rename and copy detection are heuristics — a status
that guessed wrong would send a file down the wrong arm of a `switch`. Two
questions instead, "did the base commit have this path" and "is it tracked now",
and the answers cannot be wrong about the repository they are asked of.

## The one place the app writes inside a checkout

`SECURITY.md` named two places octopus may touch — the data root and the
worktree — and for a long time that was simply true: every use of a project's
`repoPath` in the service is a git call or a read. It now names three.

"Writes inside a checkout" means its **working tree**. git itself writes under
`.git` on our behalf whenever we ask it to — `worktree add` and `branch` always
did, and the fetch before a workspace is created now writes refs and objects
there too. None of that touches a file the checkout tracks.

Exporting a project's settings into `.octopus/` is the exception, and it is
confined rather than trusted. Every path is a fixed constant assembled in
`repoConfig.ts`; `repoConfig.test.ts` walks the whole record and fails if one of
them is ever absolute or climbs out with `..`; the id that selects a path is
parsed by zod before it crosses IPC; and a symbolic link inside the directory is
refused in both directions, since a link is what turns every one of those
guarantees into decoration.

The link check walks **every segment** of the path, and the first version did
not. `lstat` leaves the last component unresolved but follows the ones above it,
so checking the file alone answered "absent" for a symlinked `.octopus/scripts`
and the write then followed the link outside the repository. A guard that looks
at the leaf of a path it does not control is not a guard.

The confinement check is a **test over the constants** rather than a branch in
the code, deliberately. The paths cannot vary, so a runtime `if` guarding them
is a branch no input reaches — a line nobody can exercise and therefore nobody
should trust. What varies is the id, and that is checked where it arrives.

`.octopus/` is read while the app works — it is where a script is looked for
first — which is why the same guard applies to every path assembled from it:
[repo-config.md](../repo-config.md) has the chain, and `repoSource.ts` the gate in
front of it.

## Errors are not swallowed

If git fails, stderr reaches the user. A `catch` is justified when the fallback
is genuinely correct — not to make a coverage gap disappear. If the alternative
is a clearer error one line later, let it through.

Two failures in one chain are two decisions. Asking the agent for its model list
is fire-and-forget: a list that cannot be **read** is swallowed, since it is a
convenience for the picker and failing a message over it would report the wrong
problem — but a list that cannot be **written** is a failed write like any
other, and goes into the chat through `background`. Handling only the first left
the second uncaught in the main process, where Electron answers with a modal
about a JavaScript error over an application that is otherwise fine.
