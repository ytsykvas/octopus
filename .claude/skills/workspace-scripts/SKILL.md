---
name: workspace-scripts
description: Sets a project up to build and run in octopus — the carried files, the variables, and the build, server and cleanup scripts, in that order. Use when a project runs nowhere yet, when Run does nothing useful, when a workspace comes up missing its .env or master.key, or when a repository still carries Conductor's setup.
when_to_use: On "set up the scripts for this project", "make this project work in octopus", "why does Run do nothing", "the workspace has no .env", or when a checkout has a .conductor/ that should become an .octopus/.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(ls:*), Bash(cat:*), Bash(git check-ignore:*), Bash(git status:*), Bash(git ls-files:*), Bash(sh -n:*), Bash(bash -n:*), Bash(command -v:*), Bash(test:*)
---

# Setting a project up to run

Some files, a set of variables, and three scripts. That is the whole of what a
project needs before its workspaces do anything — and the scripts, which look
like the job, are the last part of it.

| Script       | When it runs                  | What belongs in it                            |
| ------------ | ----------------------------- | --------------------------------------------- |
| `setup.sh`   | on Run, before the server     | dependencies, the database, dumps, migrations |
| `run.sh`     | on Run, on `$OCTOPUS_PORT`    | the dev server, and nothing else              |
| `archive.sh` | when the workspace is deleted | giving back exactly what setup took           |

They go in `.octopus/scripts/` **inside the repository**, so a clone works with
nothing configured and a second machine needs no setting up. The app reads them
from there ahead of anything in its own settings. Project settings is the
fallback for a project that cannot commit them.

## The order it has to be done in

A project set up in any other order fails in a way that points at the wrong
thing, which is worth five lines to avoid.

**The files first** — the carry list, with sources where the checkout has not got
them. Nothing else works without these, and their absence is silent.

**Then the variables** — the env set. The scripts read it and must never write it
(_"the environment has one authority"_ below), so it has to exist first.

**Then the scripts**, which are short by then, because the two steps above have
already done what the first half of a setup script used to do.

**Then allowing them to run.** A repository's scripts are shown once before they
execute; until somebody allows them, or turns on the project's trust switch,
`Run` does nothing and the Scripts tab says why.

The failure worth recognising: **`Run` stops on a variable the script could not
read.** That is almost never the script. It is the variables missing, or the
files having silently copied nothing — and a setup script that guards its own
inputs (_"nothing shared is touched without the slug"_) says so in one line
rather than failing somewhere deeper.

## Never run them

This skill writes scripts and reads files. It does not execute a script it
wrote, and it does not run a migration, a dump, a `dropdb` or a container to
"check". Verification is by reading — the section at the end says how — and the
person asking presses Run.

The same goes for the environment: **propose variables, never write them.** The
reason is that they are credentials — reading a value to copy it is the thing
not to do, and a value does not go into the plan, the repository, or the reply.
Read variable **names** to know what is needed.

Not because the file cannot be written: a set is an ordinary file under
`~/.octopus/projects/<id>/envs/`, read from disk at every run, and `state.json`
holds only which set is chosen. This once said the running app caches the
contents and would overwrite them, which is untrue and was worth checking before
being written down. `state.json` itself is the file to leave alone while the app
is running.

## The question that produces the scripts

Every project's setup script looks like every other and none of them are the
same, so a template is the wrong shape. What is stable is the question:

> **What must this workspace not share with the others?**

Ask it once per resource — database, uploads directory, cache, container,
search index, queue — and each answer is one of three:

**Private.** Created in `setup.sh`, named through the slug, dropped in
`archive.sh`. A database is the usual one.

**Shared.** Symlinked or copied from `$OCTOPUS_ROOT_PATH`, and **never** dropped
in cleanup. A `node_modules` cache, a downloaded model, a vendor directory.
Deleting one of these in `archive.sh` breaks every other workspace and the main
checkout with it.

**Pinned.** Shared, but must never be the production one. This is the answer
that gets missed and the one that costs the most. It is an **env set** and never
a line in a script: a script that points itself at staging is a script somebody
edits, and the whole point of keeping the environment out of the repository is
that a `git pull` cannot change what a workspace runs against.

Write the three lists down before writing any shell. The scripts fall out of
them, and a resource nobody classified is the bug.

## Four rules

Each of these is a failure that has already happened here.

**1. Nothing shared is touched without the slug, and an empty slug stops the
script.** `$OCTOPUS_WORKSPACE_SLUG` unset expands to nothing, and
`dropdb "myapp_development_"` — or worse, a `rm -rf "$ROOT/$SLUG"` — then names
something real. Every script that drops or deletes opens with:

```sh
: "${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"
```

**2. The slug is the only source of a per-workspace name.** Scripts written for
other tools carry a `tr | sed | cut` pipeline that builds one from the workspace
name. Delete it. The app's slug is lowercase, every non-alphanumeric character
becomes `_`, and it is cut to 30 characters — chosen so a Postgres identifier
with a prefix in front still fits under the 63 Postgres silently truncates at.
Two pipelines that disagree by one character are a database created under one
name and dropped under another.

**3. The environment has one authority, and it is not a script.** A `KEY=value`
appended to `.env` by `setup.sh` wins while setup runs and loses on the next
prepare, because the app writes its own block **last** and prepare runs before
each half of a run. The same variable then means one thing while the dump loads
and another while the server runs. So a per-workspace database name goes in the
**env set**, using `$OCTOPUS_WORKSPACE_SLUG`, and the scripts read it back out
of the environment:

```
# in the env set, not in a script
DATABASE_NAME=myapp_development_$OCTOPUS_WORKSPACE_SLUG
```

```sh
# in setup.sh
createdb "$DATABASE_NAME"
```

**4. A cleanup script never uses `set -e`.** `archive.sh` cannot stop the
removal and should not try: the workspace goes whatever happens. With `set -e` a
database that was already dropped by hand aborts the script and leaves the
uploads directory behind for ever. Let every line run, and let each fail on its
own:

```sh
#!/bin/sh
# No set -e: this cannot stop the removal, so a failed line must not
# skip the lines after it.
: "${OCTOPUS_WORKSPACE_SLUG:?}"
dropdb --if-exists "myapp_development_$OCTOPUS_WORKSPACE_SLUG"
rm -rf "$OCTOPUS_ROOT_PATH/tmp/uploads/$OCTOPUS_WORKSPACE_SLUG"
```

## What a script is given

All three get these:

| Variable                  | Is                                                    |
| ------------------------- | ----------------------------------------------------- |
| `$OCTOPUS_ROOT_PATH`      | the project's own checkout, which the worktree is not |
| `$OCTOPUS_WORKSPACE_NAME` | the label as typed — spaces and capitals and all      |
| `$OCTOPUS_WORKSPACE_SLUG` | the same thing as an identifier                       |

`run.sh` also gets `$OCTOPUS_PORT` and `$OCTOPUS_PORT_1` … `$OCTOPUS_PORT_9` —
ten ports, so a stack that is more than one process has somewhere to put the
rest. The server binds `$OCTOPUS_PORT` and never a literal.

`$OCTOPUS_ROOT_PATH` is the one that is not obvious. A worktree is a copy of the
repository, so anything gitignored is missing from it and there is no way to
work out the path back — `../../` is the app's data directory, not the user's
code. Anything that has to be fetched from the main checkout goes through it.

The same names work inside the **env set**, where `$OCTOPUS_PORT` and
`$OCTOPUS_WORKSPACE_SLUG` are substituted per workspace on the way in. Only
`OCTOPUS_*` names are substituted; every other `$` is left alone, because a
password with a `$` in it must survive.

## Files a worktree does not have

A gitignored `.env` or `config/master.key` is missing from every new worktree by
definition. **That is the carry list, not a script**: paths one per line in
Project settings, copied in before either script runs, never overwriting a file
already there.

So the `cp` lines at the top of a setup script written for another tool come
out. And a path only belongs in the list if git actually ignores it — a tracked
file is already in the worktree, and listing it is a no-op that reads like a
safeguard.

### When the checkout has not got them either

**Ask where the project's checkout came from before writing the list.** If it was
cloned — from GitHub, from anywhere — then it has _no_ gitignored file in it at
all. They were never pushed. A carry list naming `.env` there copies nothing, and
copies nothing **silently**: the workspace comes up without it and the first sign
is the build failing on a variable, which reads as a script problem and is not
one. This has already cost an afternoon.

The answer is on the same line. A carry entry may say where its file comes from:

```
.env = ~/work/planner/.env
config/master.key = ~/work/planner/config/master.key
```

Left of the `=` is where the file lands in the worktree; right of it is where to
read it from, on this machine. Absolute, `~`-relative, or relative to the
checkout — and a line with a source uses it rather than falling back, so there is
nothing to be surprised by.

The usual source is **another checkout of the same repository**, which is nearly
always on the disk already: the one the person actually works in. Find it before
asking them for anything — `git worktree list`, or a sibling directory with the
same remote — and propose the two lines rather than the question.

Those sources stay on this machine: export strips them out of `.octopus/carry`,
so what the repository carries is still just the list of files. Which also means
pressing **Import** replaces the list and takes the sources with it — worth
saying out loud to whoever will press it.

## Where to put what

| It is                                  | It goes in                                          |
| -------------------------------------- | --------------------------------------------------- |
| a command                              | one of the three scripts                            |
| a gitignored file to copy in           | the carry list                                      |
| the same, in a checkout that lacks it  | the carry list, with `= /where/it/really/is`        |
| a variable, per project                | the env set                                         |
| a variable that must not be production | **its own env set**, and the workspace pinned to it |
| a path back to the checkout            | `$OCTOPUS_ROOT_PATH` in a script                    |

## Verifying, without running anything

Work through all of these before handing the scripts back. Each has caught
something real.

```sh
sh -n .octopus/scripts/setup.sh          # and run.sh, archive.sh
test -x .octopus/scripts/setup.sh        # the executable bit, on all three
command -v createdb                      # every command the scripts name
git check-ignore -v .env                 # every path in the carry list
ls -l ~/work/planner/.env                # every source a carry line names
```

And by reading:

- **no destructive line without the slug** — every `dropdb`, `rm -rf`, `docker
rm`, `DROP DATABASE` mentions `$OCTOPUS_WORKSPACE_SLUG`, and the script that
  contains one opens with the `:?` guard;
- **`archive.sh` has no `set -e`**;
- **`run.sh` binds `$OCTOPUS_PORT`** and no literal port anywhere;
- **no `CONDUCTOR_` left** in anything under `.octopus/`;
- **nothing shared is deleted in cleanup** — check each `rm` against the shared
  list from the question above;
- **every carried path is genuinely ignored** — `git check-ignore` exits 1 for a
  path git tracks, and that path is already in the worktree;
- **every carried file is somewhere** — for each line, either the checkout has it
  or the line names a source that exists. A carry entry that resolves to nothing
  is the failure above, and nothing at run time will say so.

Report what each check answered. A check that was skipped is worth saying so
about.

## References

Open the one whose trigger is present. They are small and each has an expiry.

| File                       | Open when                        |
| -------------------------- | -------------------------------- |
| `references/conversion.md` | the checkout has a `.conductor/` |
| `references/rails.md`      | the checkout has a `Gemfile`     |

Rails leads because it is the stack these were worked out against, and that is
the reason to read `rails.md` rather than to assume any project resembles it.
