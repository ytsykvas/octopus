# Coming off `.conductor/`

**Open this when the checkout has a `.conductor/` directory. Delete this file
when the last repository has been converted** — it describes a bridge, not a
feature.

octopus reads `.conductor/` already, so a repository set up for that tool works
here unchanged and there is no hurry. Converting is worth it for one reason:
`.octopus/scripts/` are files, which can be read in a diff and run outside the
app, while Conductor's `run` is a command line inside a config file.

## The translation

| Conductor                   | Here                                          |
| --------------------------- | --------------------------------------------- |
| `[scripts] setup`           | `.octopus/scripts/setup.sh`                   |
| `[scripts] run`             | `.octopus/scripts/run.sh`                     |
| `[scripts] archive`         | `.octopus/scripts/archive.sh`                 |
| `file_include_globs`        | the carry list in Project settings            |
| `$CONDUCTOR_PORT`           | `$OCTOPUS_PORT`, and `_1`…`_9` for the rest   |
| `$CONDUCTOR_ROOT_PATH`      | `$OCTOPUS_ROOT_PATH`                          |
| `$CONDUCTOR_WORKSPACE_NAME` | **`$OCTOPUS_WORKSPACE_SLUG`**                 |
| `[prompts]`                 | `.octopus/instructions/`, one file per action |
| `run_mode = "concurrent"`   | nothing — it always is                        |

**The workspace name is the trap.** `CONDUCTOR_WORKSPACE_NAME` is what their
scripts slugify by hand before naming anything with it, so the counterpart is
the slug and not `$OCTOPUS_WORKSPACE_NAME`. Translating it to `_NAME` gives a
string with spaces and capitals in it, which then names a database.

When a script resolves out of `.conductor/`, octopus sets the `CONDUCTOR_*`
names too, with the workspace name already slugified — so their scripts keep
working while the conversion has not happened yet. That is the bridge; a script
under `.octopus/` gets no such aliases, which is why the check for a leftover
`CONDUCTOR_` matters.

## Three things that come out

**The `cp` of the gitignored secrets** at the top of the setup script. That is
the carry list here, and it runs before the script.

**The slug pipeline.** Something like

```sh
SLUG=$(echo "$CONDUCTOR_WORKSPACE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g' | cut -c1-40)
```

comes out entirely — `$OCTOPUS_WORKSPACE_SLUG` is that string already, and a cut
at 40 where the app cuts at 30 is two names for one database.

**Anything that pins the environment.** A setup script that edits `.env` to
point at a dev host is doing the env set's job, and losing to it on the next
prepare. Move it, and say which variables moved — by name.

## What does not convert

`[prompts]` translate, but four of the seven instructions have no Conductor
counterpart, and `general` is deliberately not read at all: octopus adds nothing
to the system prompt.

`CONDUCTOR_IS_LOCAL` is not set here. A script branching on it takes the branch
for unset; check what that branch does before assuming it is harmless.
