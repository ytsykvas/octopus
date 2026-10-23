# Rails

**Open this when the checkout has a `Gemfile`.** It is the stack these rules
were worked out against, which is exactly why it is a reference and not the
default assumption: read it to recognise the shape, not to apply it to a project
that is not this one.

## The three answers, for a Rails app

**Private:** the development database, and the test one if the suite runs here.
Created in setup, dropped in cleanup.

**Shared:** `vendor/bundle` if the project vendors gems, `node_modules` if it
has a JS build, `tmp/cache`. Symlinked to `$OCTOPUS_ROOT_PATH`, never dropped.

**Pinned:** anything naming a real service — a payment sandbox, an SMTP host, an
S3 bucket, a Sidekiq Redis URL. Env set, and a separate one for anything that
must never be the production endpoint.

## Setup

```sh
#!/bin/sh
set -e

: "${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"
: "${DATABASE_NAME:?the env set must define DATABASE_NAME}"

bundle install

# Shared, so it is a link and never a copy: one bundle for every workspace.
ln -sfn "$OCTOPUS_ROOT_PATH/node_modules" node_modules

bin/rails db:prepare
```

`db:prepare` rather than `db:create db:migrate`: it creates the database if it
is missing and migrates it either way, so the script is the same on the first
run and the tenth.

Loading a dump instead is the common variant, and the dump comes out of the main
checkout — `$OCTOPUS_ROOT_PATH/tmp/latest.dump` — rather than being downloaded
per workspace.

## Server

```sh
#!/bin/sh
set -e
exec bin/rails server -b 127.0.0.1 -p "$OCTOPUS_PORT"
```

`-b 127.0.0.1` because the server is for this machine. `exec` so a stop reaches
Rails rather than the shell holding it.

A second process — a Sidekiq, a `bin/vite dev` — takes `$OCTOPUS_PORT_1`.

## Cleanup

```sh
#!/bin/sh
# No set -e: this cannot stop the removal.
: "${OCTOPUS_WORKSPACE_SLUG:?}"

dropdb --if-exists "myapp_development_$OCTOPUS_WORKSPACE_SLUG"
dropdb --if-exists "myapp_test_$OCTOPUS_WORKSPACE_SLUG"
rm -rf "storage/$OCTOPUS_WORKSPACE_SLUG"
```

`node_modules` is a symlink to something shared, so it is not on this list. `rm
-rf` on a symlink removes the link, but a trailing slash follows it — and that
would empty the main checkout's `node_modules` while other workspaces are using
it.

## Variables

Rails reads `config/database.yml`, which usually reads `DATABASE_URL` or a
`database:` key. Either way the per-workspace name comes from the env set:

```
DATABASE_NAME=myapp_development_$OCTOPUS_WORKSPACE_SLUG
DATABASE_URL=postgres://localhost/myapp_development_$OCTOPUS_WORKSPACE_SLUG
```

`config/master.key` is gitignored and therefore missing from every worktree:
it belongs in the carry list, with `.env`. Without it Rails fails on boot
complaining about credentials, which reads as a Rails problem and is not one.

If the project's checkout is itself a fresh clone it has neither, and the carry
list needs to say where they are — `config/master.key = ~/work/app/config/master.key`,
pointing at the checkout the person actually works in. `.ruby-version` is a third
gitignored file most Rails projects have, and it is the one **not** to carry:
`setup.sh` writes it from the branch's own `Gemfile`, so a branch that bumps Ruby
gets the version it asks for.

`RAILS_ENV` stays `development`. A workspace pointed at production by a variable
is the failure the env sets exist to prevent, and it is not something a script
should be able to do.
