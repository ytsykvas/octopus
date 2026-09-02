# Two commands can share a name, and the menu breaks on it

## What happens

The agent reported two slash commands both called `code-review`, and the
suggestion menu drew them under the same React key:

```
Encountered two children with the same key, `code-review`. Keys should be
unique so that components maintain their identity across updates. Non-unique
keys may cause children to be duplicated and/or omitted — the behavior is
unsupported and could change in a future version.
```

Nothing in octopus collapses the pair. `toAgentCommands` is a straight `map`,
and the menu keys each row by the command's name.

## Why it matters

Two separate consequences, and the second is the worse one.

**The menu.** React's own warning says the rows may be duplicated or omitted.
The list is arrow-navigable and `Enter` completes whichever row is highlighted,
so a list whose identities shift between renders is one where the highlight can
land on a row the reader is not looking at.

**Alias resolution takes the first record and ignores the rest.** `isCommand` in
`chats.ts` finds a command by name and reads its aliases off that one match. Two
records under one name means the second one's aliases are invisible — and this
is what decides whether a message is intercepted or sent to the agent. If
`usage` is ever the duplicated name, `/cost` stops reaching the card and prints
the prose it was meant to replace instead; if `clear` is, the log survives a
`/reset` that the agent honoured. The plain spelling is safe either way:
`isCommand` returns on `name === command` at `chats.ts:440` before it consults
the list, so only the alias forms are lost.

That second failure is silent, and it is the reason this is worth more than a
console warning normally would be.

## Evidence

Observed in a live session on 2026-08-28, in the dev server's console. The three
places involved:

- `src/renderer/src/components/chat/CommandMenu.tsx:47` — `key={command.name}`
- `src/core/agent.ts:302-309` — `toAgentCommands`, a `map` with no dedupe
- `src/core/chats.ts:435-444` — `isCommand`, and at :442 the
  `commands.find((candidate) => candidate.name === command)` that reads the
  aliases off one match

**Not established:** where the second `code-review` comes from. A plugin and a
user command of the same name, a skill and a command, or the CLI reporting one
entry twice are all consistent with what was seen. Worth answering before
choosing a fix, because it decides whether the duplicate is a real pair the
reader should be able to tell apart or a repeat that should never have arrived.

## What is already decided

**The list is not ours to curate.** octopus is a harness, not a filter — the
commands come from the agent and every one of them belongs on screen. Dropping a
duplicate on the way in would hide a command somebody wrote, which is the thing
§4 exists to prevent. Whatever the fix is, it makes the two distinguishable
rather than making one of them disappear.

## A sketch

A key that is unique without inventing anything: the name plus its index in the
list the agent reported. That fixes the menu without deciding anything about
which of the two is meant.

`isCommand` is the part that needs a real answer rather than a key. Reading
aliases from _every_ record with that name — rather than the first — is correct
regardless of where the duplicate comes from, and is a one-line change from
`find` to a filter with a flattened alias list.
