# The paperclip has nothing behind it

The composer's attic carries a paperclip on the right, beside the skills
control. It is `disabled`, its title says attachments are not wired up yet, and
clicking it does nothing (`ComposerAttic.tsx:221-229`).
`ComposerAttachments.tsx` and `attachments.ts`, in the same directory, are not
this: they carry the review notes that ride out with a message, and have nothing
to do with the paperclip.

## Why it matters

It was put there deliberately — the shape of the strip was decided with both
controls in it, and moving the skills control later to make room would be a
second change to a row people have learned. But a dead control is a promise
with a deadline nobody set, and the longer it sits the more it reads as a bug
somebody stopped looking at. The strip's own doc comment already describes it as
though it were live: `ComposerAttic.tsx:66-70` says the strip stays put because
it carries controls now, "the skills this conversation may use, and what a
message may bring with it".

## What is already decided

It says it is not ready rather than swallowing the click. A control that looks
live and does nothing is read as a fault in the app; one that plainly is not
ready is read as a plan (`ComposerAttic.tsx:218-220`).

## What it would take

An attachment is a file the agent should be able to read, so the question is
where it lands. The worktree is the only directory a session can reach without
being handed a new root, and writing there puts an untracked file in somebody's
`git status`. `additionalDirectories` on the SDK options is the other answer,
and it is passed today: `src/core/service.ts:1987` hands it `skills.roots` on
every session start, and `src/core/agent.ts:386-387` forwards it to the SDK
whenever the list is non-empty. So the mechanism is built and proven for skills;
what is left is deciding whether an attachment rides the same one, and neither
that nor the worktree has been looked at properly.
