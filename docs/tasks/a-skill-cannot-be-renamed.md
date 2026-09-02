# A skill cannot be renamed

The name field in the skill editor is disabled once the skill exists
(`SkillEditor.tsx:122`). The only way to change it is to make a new skill and
delete the old one, which loses whatever conversations had said about it.

## Why it matters

A name written in a hurry is the one thing about a skill somebody is most likely
to want to change, and the description beside it is editable. The asymmetry
reads as an oversight rather than as a decision.

## Evidence

The name is the directory (`skills.ts:272-278`, `skillPath`), and it is the key
three stored things use: `Config.disabledSkillDefaults` (`config.ts:194`), a
project's own list (`store.ts:134`), and `Chat.skillOverrides` on every
conversation (`chats.ts:574`).

## What is already decided

Renaming is a migration, not an edit — which is why it was left out rather than
half-done; the comment above `SkillContentSchema` (`skills.ts:93`) says as much.
A rename that moved the folder and left the keys behind would look like it
worked and quietly switch the skill back on everywhere it had been turned off:
`skillEnabled` (`skills.ts:252-261`) reads a key no list mentions as on.

## A sketch

One service method that moves the directory, rewrites `name:` in the document,
and rewrites the key in all three places inside a single `commit` — the same
shape `env:rename` already has for env profiles (`service.ts:2197`), which moves
a file and every reference to it at once.
