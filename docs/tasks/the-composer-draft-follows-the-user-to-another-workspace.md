# The composer draft follows the user to another workspace

## What happens

The draft is local state in `Composer` (`Composer.tsx:126`), the component is
mounted without a `key` (`Chat.tsx:162`), and nothing resets it when the
workspace changes. Type "drop the old migration and rerun the seeds" in
workspace A, click B to check something, press Enter — it goes to B's agent, in
B's worktree, on B's branch.

## Why it matters

The text is still in the field, so the user has every reason to believe it
belongs to what they are looking at. The instruction runs somewhere it was never
meant for, and this application's whole premise is that several agents are
working at once.

## A sketch

`<Composer key={workspace.id} …>` empties the field on a switch. Keeping the
text per workspace instead would be kinder, and is a lifted map rather than a
key.
