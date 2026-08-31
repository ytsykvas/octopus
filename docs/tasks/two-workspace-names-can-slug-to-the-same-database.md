# Two workspace names can slug to the same database

## What happens

`workspaceSlug` lowercases, turns every other character into `_` and truncates
at 30. It is deliberately not injective, so distinct workspaces can share a
slug:

- `fix login` and `fix-login` both become `fix_login`;
- any two names agreeing on their first 30 slugged characters collapse.

Both then resolve to one `myapp_development_fix_login`. The second workspace's
build script loads a dump over the first one's database while its dev server is
running, and the first workspace's cleanup drops a database the second is still
using.

## Why it matters

Rare, because workspace names are short and usually the generated ones. Not
theoretical: renaming is offered in the sidebar, and "fix login" and "fix-login"
are the kind of pair one person writes on two days.

Silent in the worst way — nothing fails, the data is simply somebody else's.

## What is already decided

The truncation length and the character rule are **not** free to change. They
mirror the `tr | sed | cut` pipelines in the repositories' own setup and archive
scripts, and that byte-compatibility is what lets an env block and a shell
script name the same database. A hash suffix would make the slug unique and
break it: `.conductor/archive.sh` would compute a different name and drop
nothing.

30 is fixed by Postgres' 63-character identifier limit against a 29-character
prefix (`scriptEnv.ts`).

## Sketch

Refuse the collision rather than encode around it. `renameWorkspace`
(`workspaces.ts`) and `nextWorkspaceName` (`names.ts`) both already know every
other workspace of the project, so either can compare slugs instead of names and
refuse — with an error saying which workspace it would collide with, since
"fix-login is taken" is confusing when the sidebar shows `fix login`.

That leaves the truncation case for a name long enough to reach it, which the
same check covers for free.
