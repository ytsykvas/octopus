# The comment about modes is out of date

## What happens

`sendToChat` re-asserts the permission mode on every message, and the comment
above it (`service.ts`, the block beginning "The record is what the session runs
under") justifies that by saying:

> no message in the SDK carries a mode except the one at startup

That is no longer true. `SDKStatusMessage` — `system` messages of subtype
`status` — carries an optional `permissionMode`, and a live session emits those
messages routinely (`{"status":"compacting"}` and `{"status":null}` were both
observed while probing `/compact`).

## Why it matters

The comment is the entire argument for re-asserting the mode blind, and it is
the first thing a reader consults before touching that code. An argument resting
on a claim that has since become false either gets believed — and the reader
leaves a workaround in place that may no longer be needed — or gets doubted, and
then the whole passage is suspect including the parts that still hold.

The re-assertion itself is probably still right: a status message is a push, and
relying on one to learn the mode means trusting that it always arrives.

## Evidence

`sdk.d.ts`, `SDKStatusMessage`, field `permissionMode?: PermissionMode`. The
observation of `system/status` in flight is in the probe run that accompanied
the slash-command work.

## A sketch

Either rewrite the comment to say what is actually true — the mode can now be
read, and we re-assert anyway because a push is not a guarantee — or use the
field, and keep the re-assertion as the fallback for when it is absent.
