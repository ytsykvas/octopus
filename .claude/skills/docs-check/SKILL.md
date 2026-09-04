---
name: docs-check
description: Checks whether docs/ has fallen behind the code and updates what has — verifying that referenced paths exist and that documented claims are still true.
when_to_use: After a change that alters structure, an IPC channel, a stored field or a UI convention. Also on "are the docs still right", "update the documentation", or before a release.
argument-hint: '[fix]'
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(ls:*), Bash(grep:*), Bash(rg:*), Read, Edit, Glob, Grep
---

# Documentation check

Documentation rots quietly. Nothing fails when a document starts describing an
application that no longer exists — and `CLAUDE.md` sends whoever comes next to
read `docs/` first, so a stale claim is worse than no claim: it sends them the
wrong way with confidence.

This command finds where `docs/` and the code have drifted apart.

## What to check

### 1. Do the referenced paths exist?

Every `../src/...` link and every path named in prose. A document pointing at a
file that was renamed is the cheapest kind of rot to find and the most certain
to mislead.

```bash
grep -oE '\(\.\./[^)]+\)|`src/[^`]+`' docs/*.md
```

Check each one resolves. Report the ones that do not.

### 2. Has anything documented actually changed?

Look at what moved since the docs were last touched:

```bash
git log --oneline -1 -- docs/
git diff --stat <that commit>..HEAD -- src/
```

Then compare against the claims each document makes:

| Document          | Goes stale when                                                               |
| ----------------- | ----------------------------------------------------------------------------- |
| `architecture.md` | a layer gains or loses a responsibility; a boundary rule changes              |
| `core.md`         | a core module is added, removed or renamed; an invariant changes              |
| `ipc.md`          | **any** channel is added, removed or renamed, or its validation changes       |
| `data.md`         | a stored field appears; a migration is added; a path under `~/.octopus` moves |
| `ui.md`           | the window layout changes; a token or shared component is added               |
| `testing.md`      | the vitest projects, the coverage threshold or the exclusions change          |

### 3. Are the counts and lists still right?

These are the claims that quietly become wrong:

```bash
grep -c "host.handle(" src/main/ipc.ts              # ipc.md gives a channel count
ls src/core/*.ts | grep -v test                     # core.md lists the modules
grep -n "thresholds" -A 5 vitest.shared.ts          # testing.md quotes the threshold
```

The palette needs care — counting `--project-` in the stylesheet does not give
the number of colours, and that count has now been wrong twice: each colour is
declared once per theme, so the total is doubled, and the wash rules name
`--project-color` on a dozen further lines besides. Do not correct the number,
do not quote one. The list in the core is the answer:

```bash
node -e "const s=require('fs').readFileSync('src/core/colors.ts','utf8');
  console.log(s.match(/PROJECT_COLORS = \[([^\]]+)\]/s)[1].split(',').filter(Boolean).length)"
```

That is the shape of the trap in general: **verify the check before believing
what it says about the document.** A miscount here reports drift that is not
there, and sends someone to edit a document that was right.

### 4. Does anything contradict the code?

Read the claim, then read the code it describes. A document that says a modal
closes on a backdrop click, when it deliberately does not, is worse than silence.

## What NOT to do

**Do not turn documentation into a description of the code.** These documents
exist to explain _why_ — the code already says what. A section that lists every
function of a module has replaced something useful with something that will be
wrong next week.

**Do not document what has not happened.** If a feature is planned, it belongs
in `PROJECT.md` as intent, not in `architecture.md` as fact.

**Do not delete a hard-won explanation** because the code around it moved. The
reason a rule exists usually outlives the line that broke it — the note about
`node:os` reaching the renderer is worth more than the import that caused it.

## Argument

With `fix`, update what has drifted and report what changed. Without it, report
the drift and ask before rewriting anything substantial.

## Finish

One of two answers:

- **In step with the code** — say so plainly, without inventing findings.
- **These have drifted** — list each with the file and the claim, and say
  whether it is now wrong or merely incomplete.

Replies to the user are in Ukrainian; everything written into `docs/` is English.
