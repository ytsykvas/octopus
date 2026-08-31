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

Only bootstrap is excluded: `main/index.ts` and `renderer/src/main.tsx`, each a
line that mounts something; the type-only `core/types.ts` and `env.d.ts`, which
compile to nothing to cover; and the test helpers. The list is `bootstrapOnly`
in `vitest.shared.ts`, shared by both configs so the two cannot disagree.

## The suite runs in one zone

Both configs set `TZ` from `testEnv` in `vitest.shared.ts`, and it is
`Europe/Kyiv` rather than UTC. The composer's attic prints a wall clock, so
without a pinned zone every expectation about it is a fact about the machine
that ran it.

Both, although only the renderer reads a clock today: two runs disagreeing about
what time it is would be a difference nobody put there on purpose, and the first
core test to want a clock should be deterministic from its first run rather than
after somebody has spent an afternoon on it.

Not UTC on purpose: a formatter reaching for `getUTCHours` would pass every
expectation under UTC and be wrong for every reader — green, and describing what
the code does rather than what it is for. Kyiv is three hours off in summer and
two in winter, so local and UTC cannot agree by accident, and a fixture written
in December is not the same arithmetic as one written in August. The pin needs no
test of its own: reverting the formatter to `getUTCHours` turns five expectations
red, which is a better guarantee than asserting `process.env.TZ`.

The clock itself is fixed where it has to be. `formatResetAt` takes `from` the
way `formatCountdown` does, so its own tests need nothing more. The component
around it reads `new Date()` with no seam, and a prop existing only for tests
would be worse than a fake clock — so the attic's moment tests fake **`Date`
alone**, `vi.useFakeTimers({ toFake: ['Date'] })`, and put it back in an
`afterEach`, which `restoreAllMocks` does not do. Faking the timers as well
breaks the `userEvent` tests in the same file, and it breaks them by hanging
rather than by failing.

## 100% coverage is not the same as tested

This is the most important thing on the page.

A workspace whose directory had been deleted by hand reported as healthy, while
every line of the function was covered. The test filtered the entry out of the
worktree list itself — modelling a state git never produces. git keeps listing
such a worktree, flagged `prunable`, and the real code never saw that flag.

Both were at 100%. The lesson is not "write more tests" but:

> When a function reads external output, go and look at what the tool actually
> prints in the awkward case, and assert against that.

A third arrived from the other direction, and it is worth knowing separately.
`DropdownMenu` closed on every scroll anywhere, and the test that covered it
read `closes the menu when the page scrolls` — green, honest, and describing
what the code did rather than what it was for. The rule it should have been
holding is narrower: close when the trigger **moved**. The chat log pins itself
to the bottom on each streamed fragment, so menus in the composer shut a few
times a second while the agent answered.

> A test named after what the code does can only ever confirm it. Name it after
> the rule the code exists to keep, and the day the two part company the test
> is the one that notices.

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

## A type declaration is not a payload

The same lesson as the one above, met again where there is no `--porcelain` to
run: the shape a library's types **allow** and the shape that **arrives** are
different documents.

Both misses came from one live session, and both fixtures had been written
faithfully from the declarations:

| Field                         | The types say             | What arrived                                    |
| ----------------------------- | ------------------------- | ----------------------------------------------- |
| `rate_limit_info.resetsAt`    | `number`, no unit given   | seconds — read as milliseconds it is 1970       |
| `rate_limit_info.utilization` | `number` optional         | absent; the header was built to show a per cent |
| `usage.input_tokens`          | the prompt's input tokens | `2`, beside 17,392 cached — the prompt was 25k  |

The last one is the dangerous kind: a number that looks perfectly reasonable and
is wrong by four orders of magnitude. Nothing would have failed.

So when a mapping reads someone else's payload, **run the thing once and print
what it sent** — a throwaway script against a temporary directory is enough —
then paste that payload into the test verbatim. `agent.test.ts` marks the one
that came from a live session, because a fixture composed from the declaration
alone tests a message the SDK does not send.

## Faking what must not run

`query` from the Agent SDK spawns a child process and talks to a model, so it is
a parameter of `startSession` and of `createService` rather than an import — the
same shape as `GitExec`. The fake keeps only what the code depends on: an async
iterable with `interrupt` and `close`, and the control requests the session
makes: `setPermissionMode`, `applyFlagSettings`, `setModel`, `supportedModels`
and the two usage readings.

**Never call `query()` from a test.**

A fake earns its keep only if it can fail. `setPermissionMode` on the fake once
discarded its argument while the test asserted the call merely resolved: deleting
the line from the service left the suite green. If the promise being made is
delivery, the fake has to record what it was told.

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

**jsdom lays nothing out**, which bites in three places and always the same way
— a measurement comes back as zero, or the method is missing entirely, and the
component behaves as though the window had no size:

- `getBoundingClientRect` on an **element** answers zeroes, so anything placed
  against a trigger needs it stubbed (`useAnchoredPanel.test.tsx` and the split
  threshold in `DiffPanel.test.tsx` both do);
- `getBoundingClientRect` on a **`Range`** does not exist at all. A handler that
  calls it throws, and the state it was going to set never arrives — which
  looks exactly like a listener that never fired. `DiffPanel.test.tsx` assigns
  one on `Range.prototype`;
- there is no `selectionchange` event of jsdom's own, so a test that selects
  text dispatches it after building the range.

**A test that measures whether props hold still has to hold still exactly what
`App` holds still — or it measures itself.** `DiffFile` is memoised, and the
pane's contract is that every prop it hands down is steady; a test of that
contract built a fresh `vi.fn()` for `onError` and a fresh controller on each
render, and three props duly looked unstable. Two of the three were the test.

The finding underneath was real, which is what makes this worth writing down:
the measurement was two thirds noise and still correct about the third. Take the
props the window builds once and hand the same objects over on every render,
then measure.

**Two memo tests are needed and neither is sufficient.** `DiffFileMemo.test`
builds steady props by hand and asks whether a memoised file ignores its
parent's render — so it holds whatever the pane actually passes, and cannot see
a pane that passes something new. `DiffPanelMemo.test` drives the pane and
counts what it redraws, which is the only half that can. The first alone was
green throughout the week the pane was rebuilding a handler on every render.

A selection's ends belong in **text** nodes, not in the elements around them,
and once the highlighter has run a line's text sits inside however many token
spans shiki produced. A range anchored to the element instead models a selection
no browser makes, and stops exercising the nesting the running app always has.

## Main and preload

`registerIpc` takes its Electron surface as a parameter, so `ipc.test.ts`
supplies nine small functions and drives all 76 channels without a window.

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
