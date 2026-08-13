# An interrupted edit is remembered for ever

## What happens

`editsInFlight` is filled on `tool_use` and emptied on the matching
`tool_result` (`service.ts:470-484`). A turn stopped mid-edit produces no
result, so the entry stays. `closeChatsOf` clears a chat's entries when its
session ends, but `interruptChat` (`service.ts:878`) does not.

## Why it matters

Bounded and small — one entry per interrupted edit, cleared when the workspace
goes. But it is the same shape as the question `abandonPermissions` now
withdraws, and the map's own comment promises it cannot grow.

## Already decided

The fix belongs beside `abandonPermissions` in `interruptChat`, and the
`editsInFlight` loop in `closeChatsOf` is the code to reuse.
