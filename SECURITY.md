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
  user's machine. `src/core/repoTrust.ts` digests those settings and the hooks
  they name, and shows them once before any of it is believed. A way to get
  settings or a hook honoured without that prompt is the most serious bug this
  project can have.
- **Anything reaching a process argument.** External commands go through
  `execFile`, never a shell, and values crossing IPC are parsed with zod at the
  boundary. A path that reaches an argument unvalidated — branch names and
  project ids come from repository directory names — is worth reporting.
- **Files written outside `~/.octopus`, the worktree, and `.octopus/` inside a
  project's checkout.** Those three are the whole of what the app is allowed to
  touch. The third is the narrowest and the newest: exporting a project's
  settings writes there and nowhere else, through fixed path constants a test
  checks, and refuses a symbolic link that could redirect the write out of the
  directory. A write that escapes it is worth reporting —
  see [docs/repo-config.md](docs/repo-config.md).

## What is not a vulnerability

- **Builds are unsigned.** Deliberate, and the reason there is nothing to
  download; see [docs/releasing.md](docs/releasing.md).
- **The agent can run commands.** That is the product. The question is only ever
  whether the user was asked first.
- **Credentials are not handled here.** `claude` and `gh` keep their own, in the
  keychain. If you find this application storing or reading them, that is a bug
  and very much worth reporting.
