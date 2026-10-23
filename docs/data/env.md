# Environment variables

## The env file a workspace last wrote to

`envFileApplied` on a workspace is the file its block of variables went into,
or null for a workspace written before it was recorded (those wrote into the
project's own `envFile`). The file in effect can change without anybody touching
the workspace — the repository's `.octopus/project.json` can name another — and
the old block is credentials and a frozen port that nothing would ever revisit.
Knowing where it went is what lets the next preparation take it back out.

## Which set of variables a workspace runs with

`envProfile` on a project names the set its workspaces use; `envProfile` on a
workspace overrides it, and `null` there means "follow the project". A third
state rather than a copy taken at creation: a copy would silently stop following
a project that later moved, and nothing could ask to follow again.

Both default to `default`, which is also the name the migration gives the old
single `env` file — so a record written before this existed reads back pointing
at exactly what is now on disk, and no record needs migrating.

A set whose file has gone resolves to an **empty** block rather than to the
project's default. A workspace pinned to a production set must not silently
receive dev credentials; nothing written is a run that fails on a missing
variable, which is loud.

**The scripts are given the set as well as the file.** `workspace:prepare`
answers with the set's name and its variables, `$OCTOPUS_*` already filled in,
and the build and the server start with both in their own environment — the
name as `$OCTOPUS_ENV_PROFILE`. The cleanup script gets the same from the
service. A build that pulls a dump then reads `$DUMP_URL` rather than sourcing
`.env` with whatever quoting its shell disagrees with dotenv about. Our own
names are laid over the set's, so a set cannot move `$OCTOPUS_PORT` or point a
cleanup at another checkout.

**Only what reads the same as in dotenv goes into the environment**, because
dotenv, Vite and Ruby's `Dotenv.load` all leave a variable that is already there
alone — a value read differently here would beat the right one in the file. Kept:
`export`, a value between matching quotes, an unquoted one cut at its first `#`,
the last of a repeated name. Left out, and left to the file: a value spanning
lines (with every line inside it, since a base64 line ending `==` would otherwise
read as an assignment), a backtick-quoted one, an escape in double quotes, and a
`$` outside single quotes once our own names are filled in — what dotenv-expand
would expand. A script that needs one of those reads `.env` itself.

The cleanup reads the set in effect **at removal**, not the one the last build
ran with — by then it is the only one there is. A cleanup that names what it
drops from `$OCTOPUS_WORKSPACE_SLUG` is unaffected.

## Env overrides typed against a project

`projects/<projectId>/envs/<name>` holds one **named set** of variables typed in
project settings, mode `0o600` because they are credentials, in a directory that
is `0o700` because "prod" is information about this machine even when its
contents are not. The section above says which set a workspace runs with. They are written into each workspace's
env file — `.env` unless the project says otherwise, since `.env` is only most
stacks: Vite reads `.env.local` and would ignore anything written beside it. The
name is a project field in `state.json`, defaulted rather than migrated, and
refused if it climbs out of the worktree.

Appended, between two markers:

```
…everything carried from the checkout…

# >>> octopus: project overrides
MYSQL_HOST=dev.example
# <<< octopus
```

**At the end, because last wins.** `dotenv` and every implementation of it keeps
the final definition of a name, so the block overrides whatever the copied file
held. That matters twice.

The first is a project **cloned from GitHub**, where the carry list answers
nothing: a fresh clone has no `.env` and no `config/master.key` by definition —
they are gitignored, so GitHub never had them. There is nothing to copy, and the
first sign of it is the framework complaining about credentials. Here the block
is not an override at all; it is the file, created holding only itself.

The second is a checkout pointing somewhere it should not. A `.env` left on the
production block hands every workspace production, quietly, and the block puts
that right without editing anyone's file.

**Two markers rather than one**, so a rewrite replaces only what we wrote. With
a single opening marker the tidiest implementation is to truncate there — and
that eats any line somebody added inside the workspace afterwards. An opening
marker with no closing one means the file was edited into a shape we did not
write; everything from it on is replaced, since keeping half a block is worse.

Emptying the overrides removes the block. Where the block was **all** the file
held, the file goes with it — an empty file is still a file, and `carryInto`
copies with `COPYFILE_EXCL`, so one left behind would refuse the real `.env` for
ever. The same reason a file holding nothing but a block is discarded before the
carry runs: for a project cloned from GitHub the block creates that file, and
without this the checkout's own `.env`, appearing later, could never arrive.

Writing it twice lands the same file. It did not: `withoutBlock` left a newline
where the block had been and the write added its own separator, so the file
gained a blank line at the head on every run.

**A marker of ours pasted into the body is taken out**, and warned about. Left
in, the next read cuts at that closing marker, promotes the rest of our own block
to somebody else's content and appends a fresh one below it — copying a
workspace's env back into the box was all it took.

Changing which file a project names sweeps the block out of the old one in every
existing workspace. Nothing else would ever revisit it, and what stayed behind
was live: credentials, and a port frozen at the moment of the switch.

**`$OCTOPUS_PORT` in the block becomes the workspace's own port**, along with
the rest of the names the scripts get — `$OCTOPUS_PORT_1`…`_9`,
`$OCTOPUS_ROOT_PATH`, `$OCTOPUS_WORKSPACE_NAME`, `$OCTOPUS_WORKSPACE_SLUG` and
`$OCTOPUS_ENV_PROFILE`,
in either the bare or the
`${…}` form. The block is one text for the whole project and the port is the one
thing that differs per workspace, so without this a value naming a port could
not be written at all: hard-code 3000 in a redirect URI and single sign-on works
in one workspace and nowhere else.

**Only those names.** A value in an env file is frequently a password and a
password frequently contains a `$`; substituting every `$word` would corrupt one
silently. Anything unrecognised is left exactly as typed.

The block is **checked as it is typed**, and the four things it looks for are
the four that fail silently: a line that is not an assignment, a key no parser
accepts, a key written twice — only the last counts — and a mistyped
`$OCTOPUS_…`, which reaches the file as literal text. They are warnings and
never a refusal: the file is read by somebody else's parser, and ours cannot be
the authority on what that one accepts.

Substituted on the way into the workspace, never in the stored block — the port
can move between runs, and a stored number would be yesterday's. This is why a
run **settles the port first and prepares second**: preparing first would write
the number the run is about to move away from.

**Appended, and nothing else.** These do not reach the process environment: the
terminal and the agent see them only through whatever loads `.env` from the
workspace directory. `bin/rails console` will; a bare `psql` in the Terminal tab
will not, because nothing exported them into the shell. That is the price of
appending, and it is the right price — appending is what works when the app
reads `.env` and the process environment does not reach it.

**git has to be ignoring that file.** octopus writes credentials into a
directory the agent commits from freely, so a repository whose `.gitignore` does
not cover the env file turns the block into a change waiting to be committed —
and a **tracked** env file is worse still. The checkout is asked with
`git check-ignore`, which consults the index and so answers "no" to both.

Three surfaces say so, and the wording differs because the moment does. The
project's Env section warns while there is anything in the block to expose — an
empty block in an unignored file exposes nothing. The pull request pane warns
beside **both** presses that commit: the form that opens a request, and
`Commit & push` (or _Amend commit & push_) on one that already exists. Neither of those is gated on the
block's contents, and gating them on it would be the wrong reading of the same
rule: a project that carries a real env file in through the carry list and types
nothing into the app has everything to lose and an empty block. What gates them
is that a commit is about to happen.

The file is **replaced, not rewritten in place** — written beside itself and
renamed over, which is atomic on POSIX. A dev server reads its `.env` at boot and
`run.sh` starts moments after the block was written; truncating in place leaves a
window in which a variable silently has no value, and nothing reports that as an
error. The rename also carries the mode with it, which is how `0600` reaches a
file that was carried in from a checkout at `0644`.

Files and variables are put in place together, at creation and again before a
run, so a workspace that predates either picks it up. The files go first: the
block has to end up below whatever was copied, which is the whole reason it
wins.
