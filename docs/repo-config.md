# Settings a repository carries: `.octopus/`

Everything a project knows about itself lives under `~/.octopus/projects/<id>/`
— the three scripts, the carry list, the seven instructions — and its fields
live in `state.json`. That is one directory on one machine. Wipe it, move to
another laptop, or lose the disk, and all of it is gone with no trace in the
repository the settings describe.

A repository may therefore carry a copy, in a directory called `.octopus/`. A
fresh installation is then rebuilt from the repository rather than from memory.

**A project whose repository has no `.octopus/` behaves exactly as it did
before.** This is insurance, not a new way of configuring anything.

## The one thing to understand

**The scripts and the instructions are live and the repository wins; the rest
here is a snapshot.**

Which of the three scripts runs is asked of the **worktree**, in this order:
`.octopus/scripts/` in it, then the project's own settings under `~/.octopus`.
The seven instructions follow the same chain — `.octopus/instructions/`, then
the project's own, then the installation's, then the written template — so a
clone sends the pull-request description this project wants with nothing
configured.

The carry list and the fields in `project.json` are **not** live: they move only
by the two actions below, both of which somebody presses.

An instruction is not gated the way a script is. It becomes a visible user
message in the log, where it is read before it does anything, and a dialog in
front of every one of them would be friction for no gain.

### This reverses an earlier decision, and the reason is worth keeping

It used to say: _nothing is live_, because reading the repository live would
mean **executing shell that arrived with a `git pull`** — and octopus's existing
gate (`repoTrust.ts`) is a fact about a **worktree**, so a project just re-added
after a wipe has approved nothing and has no workspace to approve in. A live
layer would be switched off in exactly the situation it exists for, and switched
off _silently_: the app would fall back to a local copy that had just been
deleted.

The silence was the whole of that objection, and **putting the repository first
removes it**. There is no local copy to fall back to. A project whose scripts
have not been approved does not quietly run something else; Run is disabled and
the tab says which file it would have run and shows every byte of it.

What survives is that this executes shell somebody else may have written, and
that is answered rather than avoided:

- the digest covers only what the **repository** supplies, so a script the user
  wrote is not gated — a dialog asking somebody to approve their own text is one
  they learn to click through;
- it is a digest and not a flag, so a pull that rewrites the script asks again;
- the kind goes into it beside the text, so allowing a body as the cleanup
  script is not allowing it as the one that runs on every build;
- it lives in `approvedScripts`, separate from `approvedSettings`: what the agent
  may load and what the Run button may execute are different questions, and one
  list would mean reading a hook file quietly approved a build script.

**And the environment never travels.** Variables are credentials and stay on the
machine. That is the line the arrangement rests on: the repository decides _what
runs_, the machine decides _what it runs against_. A pull can change the build
script; it cannot point a workspace at production.

### Turning the gate off, per project

A repository you write yourself asks the same question after every commit that
touches a script, and the answer is always yes. **Trust this repository's
scripts** in Project settings → Repository says so once: on, the digest is not
consulted at all. Off is the default, and off is what a clone should stay.

It is a project's own field (`trustRepoScripts`) rather than a global setting or
a per-script one, because the unit somebody actually trusts is a repository. The
same section lists what the checkout supplies and where each script comes from,
so what has been agreed to is readable afterwards rather than only at the moment
of agreeing.

## The directory

```
.octopus/
  README.md            written by octopus, so the folder explains itself
  project.json         base branch, env file, name, icon, colour
  carry                one path per line, as the local list
  scripts/
    setup.sh  run.sh  archive.sh
  instructions/
    pull-request.md  commit-message.md  fix-checks.md  address-review.md
    review.md  multi-agent-review.md  resolve-conflicts.md
```

It mirrors the layout under the data root exactly, and the filenames are not
repeated anywhere: `SCRIPT_FILES` in `scripts.ts` and `INSTRUCTION_FILES` in
`instructions.ts` are the single list, and `repoConfig.ts` reads them. The copy
in a repository and the copy in the data root cannot drift into different names.

Every entry is optional and moves on its own. A repository holding nothing but
`scripts/setup.sh` offers one file; everything else comes from the app, as
before.

### `project.json`

```json
{
  "baseBranch": "develop",
  "envFile": ".env.local",
  "name": "Planner",
  "icon": "calendar",
  "color": "teal"
}
```

Every field is optional, and an unknown key is dropped rather than refused — a
file written by a later version still imports what this one understands.

Two fields are deliberately **not** here:

- **`branchPrefix`** is a person's GitHub username, not a fact about the
  project.
- **`approvedSettings`** is the trust record. A repository that could declare
  itself approved would defeat the gate it has to pass.

## What never goes in

**The env overrides.** A project's `KEY=value` block is written into every
workspace's env file, and it holds credentials. It stays in
`~/.octopus/projects/<id>/envs/<name>` at mode 0600, in a directory at 0700, and
is never exported, never imported, and not represented in `.octopus/` even as a
list of key names — not even the names of the sets, since "prod" is information
about this machine.

`origin` is frequently public, and a secret that has been pushed has been
published whatever the next commit does — it is mirrored and indexed within
minutes. There is no version of "commit it carefully" that undoes that.

## Import

Project settings → **Repository** → the _From the repository_ list.

Every file the repository carries is listed with its path and how it stands
against the app's copy: **not here yet**, **differs**, or **the same**. Each row
opens to show **the whole of what would be written** — not a summary, because a
summary of a script is a summary somebody has to trust instead.

Ticking and pressing Import writes the chosen files through the same writers a
hand-edit uses, so an imported script lands executable and an imported
instruction sits where its editor reads it.

`project.json` gets two checks the rest do not need, because its values did not
come from the app's own pickers:

- **`baseBranch` is put to git first.** A clone stating `develop` while this one
  has only `main` would otherwise be stored and surface much later as a
  `worktree add` failure that says nothing about settings.
- **`envFile` must stay inside the worktree.** `updateProject` already refuses
  one that climbs out with `..`, since octopus writes credentials into that file.

**Nothing is executed at import.** The repository's copy is data until somebody
presses Run on the copy that has just been written.

## Export

Project settings → **Repository** → the _Into the repository_ list.

Writes the app's current settings into `.octopus/`, along with the `README.md`
that explains the directory to whoever opens the repository without the app.

An item nobody has written is skipped rather than exported as its template: a
file committed to say nothing is a file somebody has to read.

The result is an ordinary uncommitted change. `git status` shows it, and it is
committed like anything else.

### The write boundary

This is the **only** place octopus writes inside a checkout, and
[`SECURITY.md`](../SECURITY.md) had to be widened for it. Every path is a fixed
constant, `repoConfig.test.ts` fails if one of them ever climbs out of
`.octopus/`, the id that selects a path is parsed by zod at the IPC boundary,
and a symbolic link anywhere in the directory is refused on both directions —
otherwise a link could redirect a read out of the repository or a write onto a
file somewhere else entirely.

**Every segment of the path, not only the last**, and that distinction shipped
broken once. `lstat` does not follow the final component but does follow the
ones before it, so a check on the file alone read a symlinked `.octopus/scripts`
as "the file is absent" and let the write follow the link out of the repository.
`assertUnlinkedPath` walks `.octopus`, then `.octopus/scripts`, then the file.

### When git ignores the folder

The panel says so. A `.octopus/` inside `.gitignore` means everything exported
stays on this machine, which looks exactly like a working backup and is not one.

The check asks git about `.octopus/README.md` rather than about the directory:
a pattern like `.octopus/` matches nothing until the directory exists, so asking
about the folder answered "not ignored" for a repository that ignores it.

## Drift, and which side wins

Neither. When the two copies differ, the panel says **differs** and offers both
directions.

Which side is newer is deliberately not answered. Contents are all there is to
go on — a modification time says nothing after a clone — and a guess would
decide for the user in the one place they have to decide for themselves.

The practical consequence: **editing a script in Project Settings does not
update the repository's copy.** The row will say `differs` until somebody
exports. That is visible rather than silent, which is the trade being made.

## How to start, and how to stop

**To start:** open Project settings → Repository, and press Export. Commit what
appears. Anybody cloning the repository can then press Import.

**To stop:** delete `.octopus/` from the repository and commit that. Nothing in
the app depends on it, so there is nothing else to undo.

## Differences from a hand-written setup

**The first line of a setup script is often a `cp` of the gitignored secrets.**
Here that is the carry list, which runs before the script, so those lines come
out.

Variables reach a script under `OCTOPUS_*` names: `$OCTOPUS_PORT` (plus
`$OCTOPUS_PORT_1`…`_9`) for the server only, and `OCTOPUS_ROOT_PATH`,
`OCTOPUS_WORKSPACE_NAME` and `OCTOPUS_WORKSPACE_SLUG` for all three. Dev values
appended to `.env` inside `setup.sh` belong in the env block instead — which
stays out of the repository.

## Where this lives in the code

| File                                                                                          | What it holds                                                    |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`src/core/repoConfig.ts`](../src/core/repoConfig.ts)                                         | the layout, the schema, reading and writing, the symlink refusal |
| [`src/core/service.ts`](../src/core/service.ts)                                               | `projectRepoConfig`, `importRepoConfig`, `exportRepoConfig`      |
| [`src/renderer/src/components/RepoConfig.tsx`](../src/renderer/src/components/RepoConfig.tsx) | the two lists and the review                                     |
