# A skill whose document names something other than its folder cannot be opened or deleted

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`readSkillsIn` deliberately takes a skill's name from its frontmatter and falls
back to the directory only when there is none —
`skills.test.ts:57` asserts exactly that, with a folder called `folder-name`
holding a document that says `name: real-name`.

Every other operation resolves the name back to a directory: `skillPath` returns
`join(dir, name)`, used by `readSkill`, `writeSkill`, `writeRawSkill` and
`removeSkill`. The renderer passes the listed name straight into all of them.

Run against the real module with that on-disk shape: the listing returns
`{"name":"real-name", "path":".../folder-name"}`, `readSkill(root,'real-name')`
throws `skillMissing`, `removeSkill(root,'real-name')` **resolves** — `rm` with
`force: true` on a path that does not exist — and the row is still there after
the refresh.

The edit half is worse than it first looks. `open` is
`const document = await ...read(...); if (document.ok) setEditing(...)` — a
failure is dropped on the floor. No error state is set, so the Edit menu item
simply does nothing at all. Nothing is shown.

**The variant that is real data loss:** nothing dedupes names inside one store. A
hand-placed folder `alpha` whose document says `name: review`, beside a skill the
app created in folder `review`, gives two rows both labelled `review`.
`refuseExisting` only ever probes `skillPath(dir, name)`, so it never notices.
Edit on either row opens `review/SKILL.md`, Save writes into it, and Remove
deletes the `review` folder — **the wrong skill disappears while the one the user
aimed at stays on screen.**

## Why it matters

The store is documented as ordinary files — "a skill written here is a file the
user can copy anywhere, and one written anywhere can be brought here" — so
dropping a folder into `~/.octopus/skills/` by hand, or editing a `name:` in
place, is a supported route in. After that the skill is listed, is switchable, is
loaded by the agent, and cannot be edited or removed from the app at all.

A destructive action that reports success while changing nothing is the worst
shape this can take: the user clicks Remove, is told it worked, and the skill
keeps reaching the agent.

## Evidence

- `src/core/skills.ts:306-331` — name from frontmatter, directory only as
  fallback at `:324`.
- `src/core/skills.ts:272-278` — `skillPath` is `join(dir, name)`, validated but
  never reconciled with the document.
- `src/core/skills.ts:334-343` — `readSkill` throws `skillMissing`; `:454-456` —
  `removeSkill` is `rm` with `force: true`, so a non-existent path resolves.
- `src/core/skills.ts:440-446` — `writeRawSkill` refuses the mismatch, so **the
  app never creates the state itself**. The precondition is a folder placed or
  edited by hand.
- `src/core/skills.ts:496-500` — `refuseExisting` only probes
  `skillPath(dir, name)`.
- `src/renderer/src/components/settings/SkillsSection.tsx:74-77` — `open`
  swallows a non-ok answer; `:157` and `:165` — both act on `skill.name`.
- `src/renderer/src/hooks/useSkillStore.ts:82-91` — `remove` clears the error on
  `ok`, then re-lists the surviving row.

## What is already decided

`SkillEntry` already carries `path` (`skills.ts:81`), and the listing hands it to
the renderer, which uses it for copy-to-global — so resolving Edit and Remove by
`path` is the small change. **But it cannot be done blindly:** the frontmatter
name is also the key that `Config.disabledSkillDefaults`,
`Project.disabledSkillDefaults` and `Chat.skillOverrides` are stored under, and
`writeSkill`/`writeRawSkill` both assume directory == document name. One of the
two has to be declared authoritative, and
`docs/tasks/a-skill-cannot-be-renamed.md` already sets out why moving a directory
without moving those three key lists silently switches a skill back on.

The cheapest honest fix may be the opposite direction: have `readSkillsIn` report
both, and let the panel refuse Edit/Remove — or offer "fix the folder name" —
when they disagree.

The read-only "in repository" list is unaffected: it offers only copy-to-global,
which goes through `importFromPath(skill.path)`, by path.

Not a duplicate of `two-skills-cannot-share-a-name.md`, which is the cross-store
version of the duplicate shape.

## Sketch

See also `no-skill-error-code-reaches-the-window.md` — every skill refusal
arrives uncoded, so even a fix that surfaces the failure cannot say it in
Ukrainian yet.
