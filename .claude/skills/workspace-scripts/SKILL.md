---
name: workspace-scripts
description: Sets a project up to run in octopus — the build, server and cleanup scripts, and moving environment variables from where they are to where a workspace needs them. Use when a project runs nowhere yet, when Run does nothing useful, or when a repository still carries Conductor's setup.
when_to_use: On "set up the scripts for this project", "make this project work in octopus", "why does Run do nothing", or when a checkout has a .conductor/ that should become an .octopus/.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(ls:*), Bash(cat:*), Bash(git check-ignore:*), Bash(git status:*), Bash(git ls-files:*), Bash(sh -n:*), Bash(bash -n:*), Bash(command -v:*), Bash(test:*)
---

# Setting a project up to run

Three scripts and a set of variables. That is the whole of what a project needs
before its workspaces do anything, and it is worth writing down why it is only
three.

| Script       | When it runs                  | What belongs in it                            |
| ------------ | ----------------------------- | --------------------------------------------- |
| `setup.sh`   | on Run, before the server     | dependencies, the database, dumps, migrations |
| `run.sh`     | on Run, on `$OCTOPUS_PORT`    | the dev server, and nothing else              |
| `archive.sh` | when the workspace is deleted | giving back exactly what setup took           |

They go in `.octopus/scripts/` **inside the repository**, so a clone works with
nothing configured and a second machine needs no setting up. The app reads them
from there ahead of anything in its own settings. Project settings is the
fallback for a project that cannot commit them.

## Never run them

This skill writes scripts and reads files. It does not execute a script it
wrote, and it does not run a migration, a dump, a `dropdb` or a container to
"check". Verification is by reading — the section at the end says how — and the
person asking presses Run.

The same goes for the environment: **propose variables, never write them.** An
env set is keyed by a project id in `state.json`, and the running app holds that
in memory, so a file written from underneath it is overwritten from a stale
copy. Read variable **names** to know what is needed. A value in one of these
files is a credential; it does not go into the plan, the repository, or the
reply.

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

## Where to put what

| It is                                  | It goes in                                          |
| -------------------------------------- | --------------------------------------------------- |
| a command                              | one of the three scripts                            |
| a gitignored file to copy in           | the carry list                                      |
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
  path git tracks, and that path is already in the worktree.

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
