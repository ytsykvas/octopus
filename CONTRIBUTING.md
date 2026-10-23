# Contributing

Pull requests are welcome. The repository keeps a few conventions that are
stricter than usual, and they are not negotiable in review — better to know them
before writing rather than after.

## How a change lands

Everything arrives as a pull request from a branch. The `check` workflow runs
the gate below on every pull request, and `main` accepts a merge only once it is
green on the branch brought up to date with `main`.

```bash
git checkout -b fix/short-description
# work
gh pr create --fill
```

## The gate

```bash
npm run check
npm run test:race
```

`check` is format, lint, types, and both test runs; it must pass before a
commit. `test:race` runs the interface's tests again with React's scheduler
made to lose a race the suite otherwise wins only most of the time — a test that
reads a component before its effects have run fails there every time
(`docs/testing.md`). Run both locally before pushing: the server runs them
too, but on a macOS runner and last, and a red run there is a round trip.

**Coverage is 100% across `src`,** enforced by a threshold that fails the build.
This is not aspirational: a change arrives with its tests. Never lower the
threshold or disable a lint rule to get past — if coverage drops, there is
untested code.

Only bootstrap is exempt, and the list is in `vitest.shared.ts`. Putting logic
into an exempt file to avoid testing it is the one thing that will definitely be
sent back.

## Conventions

They are in [CLAUDE.md](CLAUDE.md) — the same list the agents and the
`octopus-reviewer` subagent hold a change to, so a person and an agent are
reviewed against one text. The rules for one layer are under
`.claude/rules/`.

## Running a development copy

Only one copy of the app may use a data directory, so `npm run dev` quits
without a window while another Octopus is open. Give the copy a directory of
its own:

```bash
OCTOPUS_DATA_DIR=/some/absolute/dir npm run dev
```

[docs/development.md](docs/development.md) has the rest: what hot-reloads and
what does not, how to stop the old copy, and the native modules.

## Where to start reading

[`docs/README.md`](docs/README.md) is the index and says which document answers
which question. The two rules that carry the most weight, and that have both been
broken at least once:

- `src/core/` knows nothing about the UI, and must not import `electron` — a
  lint rule blocks it;
- the renderer may import _types_ from any core module, but a _value_ only from
  one that pulls in nothing Node-only. Types are erased; values are not.

[Issues](https://github.com/ytsykvas/octopus/issues) hold work that is known
about and not done, and are a reasonable place to find something to pick up.

## Reporting something

An issue that says which macOS version, whether the app was built with
`npm run dist` or run with `npm run dev`, and what `npm run check` reports, is
one that can be acted on. Note that there are no published builds — if you did
not build it yourself, whatever you are running is not this project.
