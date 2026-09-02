# Two workspace names can slug to the same database

## What happens

`workspaceSlug` lowercases, turns every other character into `_` and truncates
at 30 (`scriptEnv.ts:87-92`). It is deliberately not injective, so distinct
workspaces can share a slug:

- `fix-login`, `fix_login` and `fix.login` all become `fix_login`;
- two non-Latin names of the same length become the same run of `_`;
- any two names agreeing on their first 30 slugged characters collapse.

Both then resolve to one `myapp_development_fix_login`. The second workspace's
build script loads a dump over the first one's database while its dev server is
running, and the first workspace's cleanup drops a database the second is still
using.

## Why it matters

Rare, because workspace names are short and usually the generated ones. Not
theoretical: renaming is offered in the sidebar, and "fix-login" and "fix_login"
are the kind of pair one person writes on two days.

A pair with a space in it — "fix login" against "fix-login" — is refused today,
though not for this reason: `toSlug` turns whitespace into `-`
(`git.ts:282-294`), so both want one branch and the rename throws
`branchExists` (`workspaces.ts:315-317`). That only covers pairs that agree as
branch names too, which the ones above do not.

Silent in the worst way — nothing fails, the data is simply somebody else's.

## What is already decided

The truncation length and the character rule are **not** free to change. They
mirror the `tr | sed | cut` pipelines in the repositories' own setup and archive
scripts, and that byte-compatibility is what lets an env block and a shell
script name the same database. A hash suffix would make the slug unique and
break it: `.conductor/archive.sh` would compute a different name and drop
nothing.

30 is fixed by Postgres' 63-character identifier limit against a 29-character
prefix (`scriptEnv.ts:50-63`).

## Sketch

Refuse the collision rather than encode around it. `nextWorkspaceName`
(`names.ts:293`) is handed every name already taken, so it can compare slugs
instead of names and refuse. `renameWorkspace` cannot: it receives one workspace
and the project, never the sibling list (`workspaces.ts:294-299`), so that half
of the check either widens the signature or sits in `renameWorkspaceById`
(`service.ts:2708-2714`), which does hold the state. Either way the error should
say which workspace it would collide with, since "fix_login is taken" is
confusing when the sidebar shows `fix-login`.

That leaves the truncation case for a name long enough to reach it, which the
same check covers for free.
