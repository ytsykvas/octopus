# The import dialog does not preview what it is about to write

Importing a skill — from disk, from pasted text or from a link — writes it and
then either shows the new row or an error. It never says "this is
`pdf-forms`, described as …, shall I?" before writing.

## Why it matters

The three routes differ in how much the user can see beforehand. A folder they
picked, they know. Pasted text, they can read. A **link** they cannot: the only
thing on screen is a URL, and what comes back is prose the agent will later
follow. Naming it before writing is the difference between importing a skill and
importing an address.

The failure is also louder than it needs to be. A document whose frontmatter
gives a name that cannot be a folder is refused _after_ the round trip, with a
message about a name the user never saw.

## Evidence

`SkillImport.tsx` calls `onImport` straight from the button. The parse happens
in `core/skills.ts`, behind `skills:import`, which writes in the same call.

## What is already decided

The name is never asked for — a skill names itself in its frontmatter, and a
second name in the dialog would be a way to file it under something the document
does not say. A preview shows what was read; it does not offer to change it.

## A sketch

The parse and the write are already separate functions; what they are not is
separate calls. Either a `skills:inspect` channel answering `{ name,
description }` for the same three shapes, or `skills:import` gaining a
`dryRun` — the first is cleaner, the second is one channel fewer.
