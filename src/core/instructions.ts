/**
 * Instructions for the agent, per project and for the installation.
 *
 * Files rather than config strings, for the same reasons as the scripts: they
 * grow past what a text field holds comfortably, they are worth reading in a
 * diff, and they can be edited outside the app.
 *
 * Kept apart from `scripts.ts` despite the resemblance. A script is executable
 * and runs in a shell; an instruction is prose handed to a model. Sharing the
 * code would mean one module that sometimes sets an executable bit, which is
 * the sort of "almost the same" that turns into a bug the first time the two
 * diverge.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { globalInstruction, projectInstruction } from './paths.js'
import type { ProjectId } from './types.js'

/**
 * The prose the pull request tab can send, one kind per button.
 *
 * Every one of them goes out as an ordinary user message the reader can see in
 * the log and edit before it is ever sent (§4). That is the whole reason they
 * are files rather than strings in the app: a prompt nobody can read is a
 * prompt nobody can correct, and octopus adds nothing to the agent's context
 * that the user has not written.
 */
export const InstructionKindSchema = z.enum([
  'pullRequest',
  'commitMessage',
  'fixChecks',
  'addressReview',
  'review',
  'multiAgentReview',
  'resolveConflicts',
  'setupScripts',
  'diagnoseRun'
])
export type InstructionKind = z.infer<typeof InstructionKindSchema>

/**
 * Whether the turn a kind starts ends in a push the app makes.
 *
 * The agent may not push (`publishGuard.ts`), so the prompts that change the
 * branch tell it to commit and stop, and the push is the app's — the press was
 * the user asking for it. A record rather than a list so a new kind cannot be
 * added without deciding.
 */
export const PUBLISHES_AFTER: Readonly<Record<InstructionKind, boolean>> = {
  pullRequest: false,
  commitMessage: false,
  fixChecks: true,
  addressReview: true,
  review: false,
  multiAgentReview: false,
  resolveConflicts: true,
  // Never read: Help sends its text without naming an instruction kind.
  // False should that change — they write scripts at most, and nobody asked
  // for a push.
  setupScripts: false,
  diagnoseRun: false
}

/** How a message is sent, as accepted from the renderer: the prompt a pane button sent, if any. */
export const SendOptionsSchema = z
  .object({ instruction: InstructionKindSchema.optional() })
  .optional()
export type SendOptions = z.infer<typeof SendOptionsSchema>

/**
 * An instruction body as accepted from the renderer.
 *
 * Bounded because it will be prepended to a prompt: an instruction longer than
 * this is not guidance, and would crowd out the diff it is meant to describe.
 */
export const InstructionBodySchema = z.string().max(16_000)

/**
 * Starting point for an instruction nobody has written.
 *
 * Written as guidance rather than left blank: a project's conventions are
 * easier to state as edits to something concrete than from nothing, and the
 * template doubles as documentation of what the instruction is for.
 */
const TEMPLATES: Record<InstructionKind, string> = {
  pullRequest: `# Pull requests

How the agent should title and describe the work in a pull request for this
project. Used both for the prompt this pane sends, and when the form is left
empty and the agent writes the title and description itself.

## The title

- One line, and specific: what changed, not which area it was in.
- Follow whatever this repository already does — a Conventional Commits prefix
  if the history has them, plain prose if it does not.

## The description

- Lead with what changed and why, not with a list of files.
- Mention anything a reviewer would otherwise have to discover: migrations,
  configuration, a follow-up that was deliberately left out.
- Keep the project's own conventions — issue references, a changelog entry,
  whatever this repository already does.
`,

  commitMessage: `# Commit messages

How the agent should write the commit that carries this workspace's work, when
the pull request pane commits it.

- One subject line saying what changed, then a blank line, then why — the shape
  git expects and every tool renders.
- Follow whatever this repository already does. If the history is Conventional
  Commits, match it; if it is plain prose, write plain prose.
- The subject is not a file list. What was touched is in the diff already.
`,

  fixChecks: `# Fixing a failing check

A check on this pull request has failed. Find out why before changing anything.

- Read the log first. Each failing check is named below with a link to its job,
  and the number at the end of that link is what
  \`gh run view --job <id> --log-failed\` takes.
- Find the failing test or step in this repository and read it, along with the
  code it exercises. A log line names a symptom; the test says what was
  expected.
- Fix the cause. A test weakened, skipped or deleted to make a run green is a
  failure hidden rather than fixed — if the test itself is wrong, say so rather
  than quietly changing it.
- Run the same thing locally before committing. The command the workflow runs is
  in the workflow file, and a round trip through CI costs minutes.
- Commit the fix and stop. Do not push: Octopus pushes the branch once you are
  done, and the checks run again on it then.
`,

  addressReview: `# Answering a review

Read the review on this pull request and deal with it.

- Read every comment first, then decide. Some of them will be about the same
  thing, and one change may answer several.
- Where a comment is right, make the change. Where it is not, say so in the
  reply rather than changing the code to end the conversation.
- Where a comment asks a question, answer it — do not treat it as a request.
- Leave the branch committed and stop. Do not push: Octopus pushes it once you
  are done, so the request carries the answer.
`,

  review: `# Reviewing this change

Review the pull request as though it were somebody else's, before anyone else
has to.

- Read the diff against what the change set out to do, not line by line.
- Look for what would fail: an unhandled case, a check that cannot fire, a
  claim in a comment the code no longer keeps.
- Say what is fine as well as what is not. A review that only lists faults
  cannot be told from one that ran out of time.
- Do not change the code. This is a reading, and what to do about it is the
  next decision rather than part of this one.
`,

  multiAgentReview: `# A review from several angles at once

Review this pull request with several subagents, each reading for one thing,
then reconcile what they found.

- Give each one a different lens — correctness, tests, security, performance,
  the interface it presents — so they are not four copies of one reading.
- Verify a finding before reporting it. A plausible fault that does not
  reproduce costs more to dismiss than it did to raise.
- Reconcile at the end: drop the duplicates, say which findings disagree with
  each other, and rank what is left by what it would cost to leave.
- Do not change the code.
`,

  resolveConflicts: `# Resolving the conflicts

This branch conflicts with its base. Merge the base in and settle it.

- Fetch and merge the base branch rather than rebasing: the branch is already
  pushed, and a rebase rewrites what the pull request is made of.
- For each conflict, work out what both sides were doing before choosing.
  Taking one side wholesale is how a change quietly disappears.
- Build and run the tests afterwards. A file that merged cleanly can still be
  wrong once both changes are in it.
- Commit the merge and stop. Do not push: Octopus pushes the branch once you are
  done, and the request stops showing a conflict then.
`,

  /*
   * Help's two are read in the log as a message, and in a composer when their
   * send fails, so their paragraphs are not wrapped: in a field narrower than
   * eighty columns every hard break wrapped a second time.
   */
  setupScripts: `# Setting this project up to run

Octopus runs every workspace in its own git worktree, on its own port, and starts it with three scripts kept in \`.octopus/scripts/\` inside the repository:

- \`setup.sh\` — before the server, **on every Run**: dependencies, the database, migrations. It runs the tenth time as surely as the first, so it creates only what is absent, installs without wiping, never re-seeds and never restores a dump twice.
- \`run.sh\` — on Run, on \`$OCTOPUS_PORT\`: the dev server, and nothing else. Restart runs only this one.
- \`archive.sh\` — when the workspace is deleted: giving back exactly what setup took.

Your job is to write the ones this repository needs, in this worktree, and to say what else octopus needs. Octopus reads the scripts live from \`.octopus/scripts/\` in the worktree, ahead of anything in its own settings. A library or a CLI with nothing to serve has no \`run.sh\`: say so rather than inventing a server.

## Do this in order

1. **Look at the repository.** Stack, package manager, services (database, cache, queue), and how it is started today: \`package.json\` scripts, a \`Procfile\`, a \`Makefile\`, \`docker-compose*.yml\`, \`.github/workflows\` (the most honest record of how to install and run it), \`.nvmrc\` or \`.tool-versions\`, \`.env.example\`, and the framework's own config (\`settings.py\`, \`config/database.yml\`, \`config/dev.exs\`, \`launchSettings.json\`) for every literal port and database name. Note which files are gitignored but needed (\`.env\`, \`config/master.key\`, \`.env.local\`). If there is a \`.conductor/\` directory, read it: it is the same arrangement under older names (see the end).
2. **Answer, for every resource, "what must this workspace not share with the others?"**
   - **Private** — created by \`setup.sh\` under a name built from \`$OCTOPUS_WORKSPACE_SLUG\`, dropped by \`archive.sh\`. The development database, the **test database** too (agents run suites in several workspaces at once), a Compose project, a cache namespace.
   - **Shared** — read from the checkout at \`$OCTOPUS_ROOT_PATH\` or from the machine, never dropped. A dump, fixtures, a running Postgres, the package manager's cache.
   - **Pinned** — a value every workspace must see, such as the database name pattern or a sandbox endpoint. That is a variable in the project's env set, never a line in a script.

   Gitignored data inside the worktree — \`db.sqlite3\`, \`storage/\`, \`media/\`, \`tmp/\`, \`_build/\` — is private for free and needs no line in either script. Write the three lists down in your reply before writing any shell.

3. **The files to carry.** A worktree holds what git tracks. Every gitignored file the app needs must be listed in Project settings → Files carried into a workspace, one exact path per line, no globs; a trusted repository may carry the same list in \`.octopus/carry\`. Octopus copies them in when the workspace is made and again before each script, never over a file already there, so a seed database may be carried too. List only paths git ignores. If this checkout has not got a file either, a line may name where it is (\`.env = ~/work/app/.env\`, usually another checkout of the same repository); say where it may be found rather than inventing one.
4. **The variables.** Read variable _names_ from the code, \`.env.example\` and the existing \`.env\`, and list the ones the env set must define. For a secret — a key, a password, a token — **never write a value**, never print one, never commit one; a script may say how to generate one (\`rails secret\`, \`php artisan key:generate --show\`), never generate it into a file. A value that is no secret and follows from the workspace is the opposite: propose it as a line to paste into the env set, written with octopus's names — \`DATABASE_URL=postgres://localhost/app_$OCTOPUS_WORKSPACE_SLUG\`, \`PORT=$OCTOPUS_PORT\`, \`VITE_API_URL=http://127.0.0.1:$OCTOPUS_PORT_1\`, \`BROWSER=none\`. If the stack reads another file than \`.env\` (Vite and Next read \`.env.local\`), say which to set as the project's env file. A \`KEY=value\` a script appends to that file loses: octopus writes its own block last, before every script.
5. **The scripts.** Write the files the repository needs, a shebang on line 1, \`chmod +x\` each, and check each with the shell its shebang names (\`bash -n\` or \`sh -n\`), and with \`shellcheck\` if it is installed. Do not run them: the person reading your reply presses Run.
6. **Say what happens next.** The Scripts tab shows a repository's scripts in full and Run stays disabled until the person presses "Allow these" or turns on "Trust this repository" in Project settings. A \`git pull\` that changes a script asks again.

## What a script is given

Every script gets \`$OCTOPUS_ROOT_PATH\` (the checkout), \`$OCTOPUS_WORKSPACE_NAME\`, \`$OCTOPUS_WORKSPACE_SLUG\` and \`$OCTOPUS_ENV_PROFILE\`, plus the variables of the env set in effect as dotenv would read them (a multi-line or backtick-quoted value stays in the file only). \`run.sh\` also gets \`$OCTOPUS_PORT\` and \`$OCTOPUS_PORT_1\` … \`$OCTOPUS_PORT_9\` for a stack that is more than one process. \`$OCTOPUS_PORT\` is what the app's link opens: the process a person looks at binds it, and an API takes \`$OCTOPUS_PORT_1\`.

**Values in the env set may use those names.** Octopus fills in \`$OCTOPUS_PORT\`, \`$OCTOPUS_PORT_1\` … \`$OCTOPUS_PORT_9\`, \`$OCTOPUS_WORKSPACE_SLUG\` and the rest per workspace, in the env file and in every script's environment, so \`DB_PORT=$OCTOPUS_PORT_2\` reaches \`setup.sh\` too and a per-workspace database name reaches the app without a script writing \`.env\`. Nothing else is filled in. The port can move between runs, so nothing setup writes may remember it.

The env set is in the environment of \`run.sh\`, and so of the server it starts: a stack that reads no dotenv (Spring, Go, .NET, Phoenix) still sees every variable, and a second process or package needs no second env file.

The slug is the workspace name lowercased, every other character an underscore, cut to 30 characters, so a prefix still fits inside Postgres' 63. It is the **only** source of a per-workspace name; the name itself may hold spaces. The slug may begin with a digit or an underscore, so always put a prefix in front (\`app_$OCTOPUS_WORKSPACE_SLUG\`) and spell that name one way in the env set, \`setup.sh\` and \`archive.sh\`.

\`setup.sh\` and \`run.sh\` are started by path through the user's login shell, in the worktree, as a fresh process: PATH shims (rbenv, pyenv, asdf, mise) work, shell functions do not — for nvm, \`. "$NVM_DIR/nvm.sh" && nvm use\` reads \`.nvmrc\`. Nothing can answer a prompt. \`archive.sh\` is started with no shell at all and the login PATH only, is given 30 seconds, and its output is not shown: plain tools, quick and quiet.

## Rules

- Nothing shared is touched without the slug, and an empty slug stops the script: \`: "\${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"\` is the first line after the shebang of \`setup.sh\` and \`archive.sh\`.
- \`archive.sh\` never uses \`set -e\`: nothing may stop a workspace being removed, and the script must get as far as it can. It uses plain tools — \`dropdb --if-exists --force\`, \`docker compose down -v --timeout 5\`, \`redis-cli\`, \`rm -rf\` — rather than the framework's CLI, and drops only names that hold the slug.
- \`run.sh\` binds \`$OCTOPUS_PORT\` **exactly**, on 127.0.0.1 or all interfaces, and fails rather than moving to the next free port (\`vite --strictPort\`, \`next dev -p\`, \`artisan serve --port\`, \`dotnet run --urls\`, \`foreman start -p\`). A literal port anywhere — a config file, a proxy target, a Procfile — is a collision between workspaces.
- \`run.sh\` is only the server, started with \`exec\` so it is the process the signal reaches first. Before the \`exec\` it may remove a stale pidfile or derive a variable; it does not install, migrate or write files.
- Stop sends SIGTERM to the whole process group and SIGKILL a few seconds later. A process manager (\`foreman\`, \`overmind\`, \`concurrently\`) started with \`exec\` is fine. Anything outside the group is not stopped: Docker containers, the JVM a Gradle daemon forks. Containers go in \`setup.sh\`, detached and idempotent (\`docker compose up -d --wait\`) under \`COMPOSE_PROJECT_NAME=app_$OCTOPUS_WORKSPACE_SLUG\`, with host ports from \`$OCTOPUS_PORT_n\` in the env set, and come down in \`archive.sh\`; the app itself runs natively.
- No prompts and no browser: \`--no-interaction\`, \`--noinput\`, \`--non-interactive\`, \`BROWSER=none\`, \`COREPACK_ENABLE_DOWNLOAD_PROMPT=0\`; never \`makemigrations\`, \`createsuperuser\`, \`key:generate\`, \`dev-certs --trust\` or \`iex\` in a script.
- \`setup.sh\` never installs or starts anything machine-wide — a Postgres, a Redis, Docker, a runtime version. It checks (\`pg_isready\`, \`command -v\`) and fails with the command the person should run.
- Dependencies are installed per worktree with the command that does not wipe (\`npm install\`, not \`npm ci\`; \`bundle check || bundle install\`; \`uv sync\`): the package manager's cache is shared already, so it is fast. Never link or copy \`node_modules\`, a virtualenv or \`vendor/\` from the checkout — tool caches inside them race, a virtualenv holds absolute paths, Composer's autoloader would load the checkout's code, and a branch's install would rewrite the checkout. Copy only what never changes in place — a dump, fixtures — with \`cp -c\`.
- Scripts never write the env file and never echo credentials.
- Where the app takes its port or database name only from a literal (\`config/dev.exs\`, \`settings.py\`, \`database.yml\`), make the smallest change that reads the variable with the old literal as its default, and say so in the reply.
- Do not write \`.octopus/project.json\` from here: it is read from the checkout rather than the worktree, and only once the repository is trusted. Name the env file and the base branch in the reply; the person sets them in Project settings.
- Keep the scripts short.

## Where stacks collide with octopus

- **Node (Next, Vite, Express):** caches live inside \`node_modules\` (\`.vite\`, \`.cache\`), so it is per worktree; Vite needs \`--strictPort\`; Next takes \`-p "$OCTOPUS_PORT"\`; corepack must not be left to ask.
- **Django:** \`migrate --noinput\`, never \`makemigrations\`; create the database only if \`psql\` says it is absent, not with \`createdb || true\`, which also hides a Postgres that is down; \`settings.py\` reads the name from \`$DATABASE_URL\`; \`runserver "127.0.0.1:$OCTOPUS_PORT"\`.
- **Rails:** \`bin/rails db:prepare\` is idempotent where \`db:setup\` re-seeds; \`DATABASE_URL\` with the slug reaches Rails without touching \`database.yml\`; \`rm -f tmp/pids/server.pid\` before the \`exec\`; a \`Procfile.dev\` app is \`exec bin/dev -p "$OCTOPUS_PORT"\`, since foreman sets \`PORT\` itself; \`config/master.key\` is carried.
- **Laravel:** \`APP_KEY\` is a secret for the env set that the person makes with \`key:generate --show\`; \`composer install --no-interaction\`; \`artisan serve --host 127.0.0.1 --port "$OCTOPUS_PORT"\`; the Vite half of \`composer run dev\` sits on 5173 and needs \`--port "$OCTOPUS_PORT_1" --strictPort\`.
- **Spring and Gradle:** \`./gradlew bootRun --no-daemon\`, or build in setup and \`exec java -jar … --server.port="$OCTOPUS_PORT"\`; \`SPRING_DATASOURCE_URL\` in the env set reaches it through the environment; SDKMAN is a shell function.
- **.NET:** \`dotnet run --no-launch-profile --urls "http://127.0.0.1:$OCTOPUS_PORT"\`, since \`launchSettings.json\` holds a literal; \`dotnet watch --non-interactive\`; \`ConnectionStrings__Default\` is a valid env-set key.
- **Phoenix:** \`config/dev.exs\` holds a literal port and database; \`mix ecto.create\` and \`mix ecto.migrate\`, not \`ecto.setup\`; \`exec mix phx.server\`, never \`iex\`.
- **Go:** module and build caches are global, so setup is \`go mod download\`; the ports in \`.air.toml\` are literals that collide.
- **Docker Compose:** a per-slug \`COMPOSE_PROJECT_NAME\`, host ports from \`$OCTOPUS_PORT_n\` in the env set (Compose interpolates them from the environment), \`up -d --wait\` in setup, \`down -v --timeout 5\` in archive; a Compose \`up\` in the foreground of \`run.sh\` outlives Stop.
- **Monorepo:** one env file is written, so every other package reads the environment; Turborepo's strict env mode hides it unless \`passThroughEnv\` names \`OCTOPUS_*\` or \`--env-mode=loose\` is given; every package's \`dev\` script with a literal port takes \`$OCTOPUS_PORT_n\`.
- **Version managers:** a runtime version the machine lacks is a machine-wide install; report the \`asdf install\` or \`nvm install\` rather than running it in setup.

## Verify, without running anything

For each script: a shebang on line 1; \`bash -n\` or \`sh -n\` as the shebang says; \`test -x\`; \`command -v\` for every tool it calls, asked through \`$SHELL -i -c\` since that is how the script is started; \`git check-ignore -v\` for every path to carry. Then read them once more for: the guard after the shebang, a prefix and the slug on every destructive line, no \`set -e\` in \`archive.sh\`, \`$OCTOPUS_PORT\` bound exactly and no literal port, nothing that prompts or opens a browser, nothing shared deleted, nothing that writes the env file, no \`CONDUCTOR_\` names left. Report what each check answered.

## If the repository has \`.conductor/\`

Octopus does not read it; it is translated once. \`[scripts] setup/run/archive\` → the three files; \`file_include_globs\` → the files to carry, one exact path per line; \`$CONDUCTOR_PORT\` → \`$OCTOPUS_PORT\`; \`$CONDUCTOR_ROOT_PATH\` → \`$OCTOPUS_ROOT_PATH\`; \`$CONDUCTOR_WORKSPACE_NAME\` → \`$OCTOPUS_WORKSPACE_SLUG\` (their name was already a slug; ours is not); \`[prompts]\` → \`.octopus/instructions/\`. Drop any \`cp\` of secrets (that is the carry list now), any pipeline that builds a slug (it is given) and anything that pins the environment (that is the env set).
`,

  diagnoseRun: `# Why does Run not work?

Run in octopus is two scripts in order: \`.octopus/scripts/setup.sh\` (the build), then \`.octopus/scripts/run.sh\` (the server) on \`$OCTOPUS_PORT\`. A failed build stops there. Restart runs only \`run.sh\` again, on the build it has. Below this message octopus has put what it knows: the checkout, this workspace's name, slug and port, whether anything is listening on that port right now, which scripts are in effect and where they come from, the env set and the names of its variables, the files it carries, any problems in the env set, and the last lines of the most recent build and server with their exit codes.

Every script is given \`$OCTOPUS_ROOT_PATH\`, \`$OCTOPUS_WORKSPACE_NAME\`, \`$OCTOPUS_WORKSPACE_SLUG\` and \`$OCTOPUS_ENV_PROFILE\`, plus the env set's variables; \`run.sh\` also gets \`$OCTOPUS_PORT\` and \`$OCTOPUS_PORT_1\` … \`$OCTOPUS_PORT_9\`. Your own session has none of them: take their values from the facts below, not from your environment.

Find out why before changing anything.

## First, which case this is

- **Nothing has run yet.** Octopus says so below. Ask the person to press Run on the Scripts tab and ask again, unless Run is disabled, which is one of the next two.
- **There are no scripts.** Nothing can run. Say so and point to Help → "Set this project up to run", which writes them; do not write them from here.
- **The scripts are not allowed yet.** Run stays disabled until the person presses "Allow these" on the Scripts tab or turns on "Trust this repository" in Project settings. Say that; there is nothing else to diagnose.
- **The last runs look healthy:** the build exited 0, the server is still running and something is listening on the port. Then the failure is what the person sees, and you have not seen it: ask what they see (a blank page, an error in the browser, another workspace's page, an old build) before guessing.

## Then, in order

1. **Read the output first.** The last error is usually not the first thing printed; find the line that actually failed. Only the last lines are kept, so the first error may be gone; say so rather than inventing it.
2. **Check what the script was given.** A run most often stops on a variable the script could not read, and that is almost never the script. The env set is written into the workspace's env file before every script, last and winning; a script that appends its own \`KEY=value\` is overwritten. The variable names are listed below; the values are not, and you must not ask for them to be pasted here.
3. **Check what is missing from the worktree.** A worktree holds what git tracks. A file the app reads at boot (\`.env\`, \`master.key\`) that is not in the files carried into the workspace is simply absent.
4. **Check the port.** The server must bind \`$OCTOPUS_PORT\` exactly, not a literal and not the next free port: a dev server that moved on is running where the app's link does not look. Octopus asks both loopback addresses, 127.0.0.1 and \`::1\`, so "not listening" below means nothing holds the port on either: the server never got that far, or it bound another port or a non-loopback address only. \`lsof -nP -iTCP:<port> -sTCP:LISTEN\` shows who holds the port and on which address.
5. **Check the slug.** A database, a container or a directory named without \`$OCTOPUS_WORKSPACE_SLUG\` is shared with every other workspace, and whichever ran last wins.
6. **Check how the script is started.** It runs by path through the login shell, as a fresh process with nothing to answer a prompt: a build that hangs is usually waiting on a question or opening a browser, and \`nvm\` or SDKMAN, being shell functions, are not there unless the script loads them. Setup runs on every Run, so a step that only works the first time fails the second.
7. **Check what the last run left behind.** Stop reaches the server's process group and nothing else: a Docker container, a Gradle daemon or a stale pidfile (\`tmp/pids/server.pid\`) from before can hold the port or refuse the boot.
8. **Check what is outside octopus.** A Postgres or Redis that is not running (\`pg_isready\`, \`docker ps\`); a runtime version that \`.nvmrc\` or \`.tool-versions\` names and the machine has not got; a migration a branch switch brought in that \`setup.sh\` does not run. Octopus starts none of those: say the command the person should run.
9. **Check the gate.** A repository's scripts do not run until they are allowed on the Scripts tab, and a script runs by path, so it must be executable (\`test -x\`) and start with a shebang.

## What you may run, and what you may not

You may run checks that change nothing: \`lsof -nP -iTCP:<port> -sTCP:LISTEN\`, \`pg_isready\`, \`docker ps\`, \`bash -n\` or \`sh -n\` on a script, \`test -f\` and \`test -x\` on a path, and \`command -v <tool>\` through \`$SHELL -i -c\`, since that is how a script is started. You may not kill a process, install anything, run a migration, or run \`setup.sh\` or \`run.sh\` yourself: the person presses Run.

Then say, in order: what failed, why, and the smallest change that fixes it. Propose the change; if it is in a script, write it and \`chmod +x\`, and say that Run is gated again until the person presses "Allow these". Never write a variable's value anywhere.
`
}

/**
 * Where each kind is written, at both scopes.
 *
 * A `Record` keyed by the kind rather than a function per file, so a new kind
 * arriving without a home is a compile error here — which is also what makes
 * the uniqueness test worth having: totality is checked by the compiler, and
 * two kinds pointing at one file is not.
 *
 * Exported for the same reason as `SCRIPT_FILES`: a project may carry these
 * in its repository under `.octopus/instructions/`, and that copy is the same
 * file under the same name.
 */
export const INSTRUCTION_FILES: Record<InstructionKind, string> = {
  pullRequest: 'pull-request.md',
  commitMessage: 'commit-message.md',
  fixChecks: 'fix-checks.md',
  addressReview: 'address-review.md',
  review: 'review.md',
  multiAgentReview: 'multi-agent-review.md',
  resolveConflicts: 'resolve-conflicts.md',
  setupScripts: 'setup-scripts.md',
  diagnoseRun: 'diagnose-run.md'
}

/**
 * Whose instruction this is.
 *
 * `null` is the installation's own, which every project falls back to. A
 * project id rather than a boolean flag beside it, so the two cannot both be
 * given and neither can be forgotten.
 */
export type InstructionScope = ProjectId | null

export function instructionPath(
  kind: InstructionKind,
  scope: InstructionScope,
  root?: string
): string {
  const file = INSTRUCTION_FILES[kind]
  return scope === null ? globalInstruction(file, root) : projectInstruction(scope, file, root)
}

/**
 * What is written, or null where nothing is.
 *
 * The distinction the fallback below is built on, and the one `readInstruction`
 * cannot make: it answers with the template for a file that is absent, which is
 * the right answer for an editor and the wrong one for a chain of defaults.
 *
 * Exported for the same distinction elsewhere: exporting a project's settings
 * into its repository should carry what somebody wrote, not a template nobody
 * has touched.
 */
export async function storedInstruction(
  kind: InstructionKind,
  scope: InstructionScope,
  root?: string
): Promise<string | null> {
  try {
    return await readFile(instructionPath(kind, scope, root), 'utf8')
  } catch {
    return null
  }
}

/** The text octopus ships for an instruction nobody has written. */
export function instructionTemplate(kind: InstructionKind): string {
  return TEMPLATES[kind]
}

/** An instruction's contents, or the template when it has never been written. */
export async function readInstruction(
  kind: InstructionKind,
  scope: InstructionScope,
  root?: string
): Promise<string> {
  return (await storedInstruction(kind, scope, root)) ?? TEMPLATES[kind]
}

/**
 * The instruction that actually applies to a project.
 *
 * The project's own if it has one, the installation's if not, and the template
 * if neither — the template being what both editors start from, so a project
 * that has never been touched sends the same thing it displays.
 *
 * **An empty file counts.** Emptying a project's instruction is a decision that
 * this project says nothing extra, and falling back to the global one there
 * would make that decision impossible to express.
 */
export async function effectiveInstruction(
  kind: InstructionKind,
  projectId: ProjectId,
  root?: string
): Promise<string> {
  return (
    (await storedInstruction(kind, projectId, root)) ??
    (await storedInstruction(kind, null, root)) ??
    TEMPLATES[kind]
  )
}

export async function writeInstruction(
  kind: InstructionKind,
  scope: InstructionScope,
  contents: string,
  root?: string
): Promise<void> {
  const path = instructionPath(kind, scope, root)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}
