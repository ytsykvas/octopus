# Testing

## The gate

```bash
npm run check    # format, lint, types, tests with coverage
```

It must pass before every commit. Coverage is **100% across `src`**, enforced by
a threshold that fails the build. Never lower it and never disable a lint rule
to get past — if coverage drops, there is untested code.

## Two runs, not two projects

There are two configs, sharing `vitest.shared.ts`:

| Config                      | Environment | Covers                                |
| --------------------------- | ----------- | ------------------------------------- |
| `vitest.config.ts`          | node        | `src/core`, `src/main`, `src/preload` |
| `vitest.renderer.config.ts` | jsdom       | `src/renderer`                        |

```bash
npx vitest run                                          # core, main, preload
npx vitest run --config vitest.renderer.config.ts       # the interface
npm test                                                # both
npm run test:coverage                                   # both, with thresholds
```

**Vitest projects would be tidier, and were tried first.** Coverage is merged
across projects by file, and a file loaded in one project and absent from the
other comes out as zero: `Settings.tsx` measured 92% on its own and 0% in the
combined run. Two runs with two thresholds is less elegant and reports the
truth.

A single project with `environmentMatchGlobs` fails differently — `setupFiles`
applies to every test, and the DOM setup breaks the core suite.

Only bootstrap is excluded, each a line that mounts something: `main/index.ts`,
`renderer/src/main.tsx`, the type-only `core/types.ts`, and the test helpers.

## 100% coverage is not the same as tested

This is the most important thing on the page.

A workspace whose directory had been deleted by hand reported as healthy, while
every line of the function was covered. The test filtered the entry out of the
worktree list itself — modelling a state git never produces. git keeps listing
such a worktree, flagged `prunable`, and the real code never saw that flag.

Both were at 100%. The lesson is not "write more tests" but:

> When a function reads external output, go and look at what the tool actually
> prints in the awkward case, and assert against that.

```bash
git worktree list --porcelain   # after rm -rf on the worktree
```

Questions worth asking, from the audit that found the above:

| Ask                                          | Because                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| what does a hostile name become              | `toSlug` output goes straight into `git branch`, which rejects `.lock`, `..`, leading `-`, `@{`, control characters |
| what happens on collision                    | a port hash collides long before the range fills                                                                    |
| what does a half-written file look like      | a crash between temp-write and rename leaves the temp behind                                                        |
| what does the tool print about a stale entry | `prunable`, `locked` and `bare` lines the parser had never seen                                                     |

## Core tests drive real git

Not a mock. Each test builds a repository in a temporary directory and runs
actual commands.

This has caught bugs no mock would have:

- a slug that destroyed Cyrillic;
- paths git canonicalises — `/var` → `/private/var` — which made every workspace
  read as missing;
- a branch left behind by an earlier removal, blocking the name.

A fake executor is for edge cases real git will not produce.

**Never test against the user's real state or data root.** Point the service at
a temporary directory. Writing to `~/.octopus` while the app runs leaves it
acting on a stale in-memory copy — a repro that corrupts what it diagnoses is
worse than no repro.

## Renderer tests

`src/renderer/src/test/setup.ts` runs before each: it installs a stub on
`window.octopus`, initialises real translations and cleans up afterwards.

The stub in [`test/octopus.ts`](../src/renderer/src/test/octopus.ts) is **typed
as the real `OctopusApi`**, so a channel added to preload without a counterpart
here is a compile error rather than a test exercising a bridge that no longer
exists. Every method is a spy and resolves successfully by default; a test that
cares about failure says so.

```ts
vi.mocked(window.octopus.projects.list).mockResolvedValue({ ok: false, error: 'nope' })
```

**Query by role, label, title or text — never by class name.** A test that
asserts on styling breaks on every refactor while proving nothing. This is what
makes a 100% threshold on UI survivable.

Native things are stubbed: xterm.js measures glyphs against a canvas jsdom does
not have, and `node-pty` spawns a real shell.

## Main and preload

`registerIpc` takes its Electron surface as a parameter, so `ipc.test.ts`
supplies five small functions and drives all 27 channels without a window.

Two lists are load-bearing: `EXPECTED` in `ipc.test.ts` and `CALLS` in
`preload/index.test.ts`. A channel name that drifts between the two sides fails
only at runtime, saying just _"no handler registered"_.

## Writing a test

`describe` names the module or component; `it` names the **scenario**:

```ts
it('refuses when the branch already exists', …)
it('saves the name when the field loses focus', …)
```

Not `it('calls onUpdate')` — that names the implementation, and will be wrong
the moment it changes.

Comments explain **why a case matters**, and only where that is not obvious.

Functions with default parameters are called both with and without the
argument, or the default branch stays uncovered.

**Reproduce a reported bug as a test before fixing it.** Each of the naming
bugs has one, and each would have caught its own regression.

**Never weaken the source to make a test pass.** An agent once deleted an abort
guard from a hook for exactly that reason. If a line seems unreachable, say so —
it is either dead code worth removing or a case worth understanding.
