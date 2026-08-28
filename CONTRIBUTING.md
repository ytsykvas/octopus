# Contributing

Pull requests are welcome. The repository keeps a few conventions that are
stricter than usual, and they are not negotiable in review — better to know them
before writing rather than after.

## How a change lands

`main` is protected and refuses direct pushes, the maintainer's included.
Everything arrives as a pull request from a branch, and merges once CI is
green.

```bash
git checkout -b fix/short-description
# work
gh pr create --fill
```

## The gate

```bash
npm run check
```

Format, lint, types, and both test runs. It must pass before a commit, and CI
runs the same command on every pull request — so a red run is a change that
cannot merge, not a note to consider.

**Coverage is 100% across `src`,** enforced by a threshold that fails the build.
This is not aspirational: a change arrives with its tests. Never lower the
threshold or disable a lint rule to get past — if coverage drops, there is
untested code.

Only bootstrap is exempt, and the list is in `vitest.shared.ts`. Putting logic
into an exempt file to avoid testing it is the one thing that will definitely be
sent back.

## Conventions

- **Everything in the repository is English** — code, comments, test names,
  error messages, documentation and commit messages. User-facing strings are the
  exception in that they never appear inline: they live in
  `src/renderer/src/i18n/locales/`, English first.
- **Conventional Commits.** The subject says what changed; the body says why.
- **No `any`**, no non-null assertions. External data is validated with zod at
  the boundary, and types come from `z.infer`.
- **External processes go through `execFile`, never `exec`.**
- **Comments explain why, not what.**

## Where to start reading

[`docs/README.md`](docs/README.md) is the index and says which document answers
which question. The two rules that carry the most weight, and that have both been
broken at least once:

- `src/core/` knows nothing about the UI, and must not import `electron` — a
  git hook blocks it;
- the renderer may import _types_ from any core module, but a _value_ only from
  one that pulls in nothing Node-only. Types are erased; values are not.

[`docs/tasks/`](docs/tasks/) holds work that is known about and not done, one
file each. It is a reasonable place to find something to pick up.

## Reporting something

An issue that says which macOS version, whether the app was built with
`npm run dist` or run with `npm run dev`, and what `npm run check` reports, is
one that can be acted on. Note that there are no published builds — if you did
not build it yourself, whatever you are running is not this project.
