# Opening a chat twice at once creates two

## What happens

`openChat` (`service.ts:855-873`) checks for an existing record and then awaits
`commit`. Two callers that arrive together both see none and both write one. The
renderer has two paths into it — picking a setting in the composer, and sending
a message — and either can be in flight when the other starts.

## Why it matters

The message and the whole reply are appended to the second record's transcript,
while `chats.list` answers with the first: the conversation reopens empty, and
the transcript that has it is filed under an id nothing points at.

## A sketch

Make the check and the write one step inside `commit`'s callback — return
`current` unchanged if the workspace already has a chat — then read the winner
back out of the state. `commit` serialises, so the second caller cannot see a
state the first has not written.
