# Rails

**Open this when the checkout has a `Gemfile`.** It is the stack these rules
were worked out against, which is exactly why it is a reference and not the
default assumption: read it to recognise the shape, not to apply it to a project
that is not this one.

## The three answers, for a Rails app

**Private:** the development database, and the test one if the suite runs here.
Created in setup, dropped in cleanup.

**Shared:** a dump in the main checkout, and the gem and npm caches, which live
outside the repository already. `vendor/bundle` and `node_modules` are not on
this list: each worktree installs its own, so a branch that bumps a gem cannot
rewrite the checkout's.

**Pinned:** anything naming a real service — a payment sandbox, an SMTP host, an
S3 bucket, a Sidekiq Redis URL. Env set, and a separate one for anything that
must never be the production endpoint.

## Setup

```sh
#!/bin/sh
set -e

: "${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"
: "${DATABASE_NAME:?the env set must define DATABASE_NAME}"

bundle check || bundle install
[ -f package.json ] && npm install --no-audit --no-fund

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
# A SIGKILL leaves the pidfile, and Rails then refuses to boot on any port.
rm -f tmp/pids/server.pid
exec bin/rails server -b 127.0.0.1 -p "$OCTOPUS_PORT"
```

`-b 127.0.0.1` because the server is for this machine. `exec` so Rails is the
process the SIGTERM reaches first and gets to remove its own pidfile; Stop
signals the whole process group either way.

An app started through `Procfile.dev` is `exec bin/dev -p "$OCTOPUS_PORT"`:
foreman sets `PORT` itself and would override one from the environment. A
second listener — a `bin/vite dev`, a mailcatcher — takes `$OCTOPUS_PORT_1`.

## Cleanup

```sh
#!/bin/sh
# No set -e: this cannot stop the removal.
: "${OCTOPUS_WORKSPACE_SLUG:?}"

dropdb --if-exists --force "myapp_development_$OCTOPUS_WORKSPACE_SLUG"
dropdb --if-exists --force "myapp_test_$OCTOPUS_WORKSPACE_SLUG"
```

`dropdb` rather than `bin/rails db:drop`: the cleanup has 30 seconds and no
shell, a Rails boot spends much of that, and `db:drop` refuses outright on a
protected environment. `--force` because a server still holding a connection
would otherwise keep the database. `storage/` and `node_modules` sit inside the
worktree and go with it.

## Variables

Rails merges `DATABASE_URL` over `config/database.yml`, so the per-workspace
name comes from the env set without touching the file:

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
