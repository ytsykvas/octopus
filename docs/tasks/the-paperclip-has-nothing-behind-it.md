# The paperclip has nothing behind it

The composer's attic carries a paperclip on the right, beside the skills
control. It is `disabled`, its title says attachments are not wired up yet, and
clicking it does nothing (`ComposerAttic.tsx`).

## Why it matters

It was put there deliberately — the shape of the strip was decided with both
controls in it, and moving the skills control later to make room would be a
second change to a row people have learned. But a dead control is a promise
with a deadline nobody set, and the longer it sits the more it reads as a bug
somebody stopped looking at.

## What is already decided

It says it is not ready rather than swallowing the click. A control that looks
live and does nothing is read as a fault in the app; one that plainly is not
ready is read as a plan.

## What it would take

An attachment is a file the agent should be able to read, so the question is
where it lands. The worktree is the only directory a session can reach without
being handed a new root, and writing there puts an untracked file in somebody's
`git status`. `additionalDirectories` on the SDK options is the other answer and
has never been passed. Neither has been looked at properly.
