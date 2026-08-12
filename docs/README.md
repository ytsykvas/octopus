# octopus documentation

Written for whoever changes this code next — a person returning after a month,
or an agent seeing it for the first time. It explains **why** things are shaped
as they are; the code says what they do, and stays the authority on that.

| Document                           | Read it when                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [PROJECT.md](PROJECT.md)           | you want the original intent: what this is, what it refuses to be, why the stack was chosen              |
| [architecture.md](architecture.md) | you are adding anything and need to know which layer it belongs to                                       |
| [core.md](core.md)                 | you are touching `src/core` — the modules, their contracts, the invariants                               |
| [ipc.md](ipc.md)                   | you are adding a channel or wondering where a call ends up                                               |
| [data.md](data.md)                 | you are changing what lives in `~/.octopus`, or adding a stored field                                    |
| [ui.md](ui.md)                     | you are building a component, picking a colour, or laying something out                                  |
| [testing.md](testing.md)           | you are writing tests, or a test is failing and you doubt the test                                       |
| [tasks/](tasks/)                   | you have finished something and want the next thing, or you just found work and need somewhere to put it |

## The shortest possible summary

octopus runs several Claude Code sessions at once. Each task gets a git
worktree, a branch, a port and an agent session of its own, so tasks never see
each other.

```
src/core/      all logic, headless, no Electron. 100% covered.
src/main/      Electron: window, menu, IPC, pseudo-terminals.
src/preload/   the typed bridge, and nothing else.
src/renderer/  the interface.
```

Two rules carry most of the weight, and both have been broken at least once:

- **`core/` knows nothing about the UI** — a hook blocks importing `electron` there.
- **The renderer imports _types_ from core freely, but a _value_ only from a
  module free of Node dependencies.** Types are erased; values are not.

## Conventions

Everything in the repository is English — code, comments, tests, commits.
User-facing strings live in `src/renderer/src/i18n/locales/`, English first.

Before committing: `npm run check` (format, lint, types, tests with coverage).
Coverage is 100% across `src`, enforced by a threshold that fails the build.
