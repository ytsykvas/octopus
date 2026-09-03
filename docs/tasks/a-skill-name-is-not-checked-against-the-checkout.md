# A skill name is not checked against the checkout's own

**Found:** 2026-09-03, split off from `two-skills-cannot-share-a-name.md` when
that one landed. The two-store half is closed; this is the third source.

## What happens

`skillKey` is the bare name, and correctly so: a skill is keyed by it wherever
it came from, and measured against a live session, one `local-probe` in a store
and another in the checkout came back as a **single** row.

Creating a skill now refuses a name the _other store_ already uses. It does not
ask the checkout. So a repository carrying `.claude/skills/review` and a skill
written here called `review` are still two files for one skill, and the switch
on either row still moves both.

## Why it matters

Less often than the two-store case, because the checkout's skills are not ours
to write and the collision needs a repository that happens to ship the name
somebody chose. But the consequence is identical, and the panel draws all three
sources side by side — `SkillsPanel` groups them under three headings — so the
collision is visible on screen while nothing prevented it.

## Evidence

- `src/core/service.ts`, `namesBesideStore` — reads the other store and says in
  its own comment that the checkout is the missing half.
- `src/core/skillNames.ts`, `skillKey` — the measurement that makes all three
  sources one namespace.
- `src/core/service.ts`, `sessionSkills` — reads all three, and is the only
  place that already has the workspace path a checkout needs.

## What is already decided

**A `SkillStore` names no workspace**, which is why this was not done with the
rest. The store methods take `{ kind: 'global' }` or
`{ kind: 'project', projectId }`; a checkout is per-workspace, and the settings
dialog is opened against one. Either the store shape grows a workspace for the
question, or the renderer supplies the checkout's names as the editor's `taken`
list already tries to.

**The renderer's `taken` list is not the answer on its own.** It only disables
the button; a skill written in the editor reaches `writeSkill` regardless, which
is why the guarantee was put in core.
