# The local settings a worktree really has are reported as unread

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`instructionSources` treats `.claude/settings.local.json` as a special case: even
when the file is present and `local` is among the setting sources, it reports
`loaded` only if the project's carry list names the file.

That rule was written for a **checkout**, where the file is gitignored and can
only arrive by being carried — the module header says so in as many words. But
`projectInstructionSources` now passes the **worktree** path whenever a workspace
is open, and in a worktree the file's presence is the direct fact: the SDK is
pointed at that directory, with the same `sourcesIn`, and will load it.

So a worktree that genuinely holds `.claude/settings.local.json` is reported as
`present: true, loaded: false` while the agent reads it.

The history shows exactly how: `b40e5dc` wrote the rule against the checkout;
`eead1f8` ("the panel therefore answers about the workspace that is open rather
than the checkout") and `b4af47f` moved the caller to the worktree and touched
neither this module nor its test. The premise was retired; the rule that depends
on it was not.

The routes by which a worktree acquires the file are ordinary:
`WorkspaceTerminals.tsx:80` renders `<Terminal cwd={workspace.path} />`, so
running `claude` in the workspace shell and answering "always allow" writes it;
`ScriptRunner` runs setup scripts in the same directory; a repository that tracks
the file gets it via `git worktree add`.

## Why it matters

That file is in the trust digest, so the app asks the user to approve it as
something that can pre-approve tools and declare hooks — and then the sources
list says the agent does not read it. `docs/ui.md:673-676` states the contract
this breaks: "read" is a claim about what the session was started with.

Same class of defect as `eead1f8`, wrong about a security state in the reassuring
direction, surviving in the one row that kept its own rule.

## Evidence

- `src/core/instructionSources.ts:150-159` — the `on()` helper; `:156` is the
  carry-list condition, applied after `present` and the source check have already
  passed. `:136` — the path `join(cwd, LOCAL_SETTINGS)`, stat'd for `present` at
  `:164`.
- `src/core/instructionSources.ts:15-21` — the header still stating the retired
  premise.
- `src/core/service.ts:2362` — `const cwd = workspace?.path ?? project.repoPath`;
  `:2364-2371` — the same `cwd` handed to `instructionSources` with
  `sourcesIn(cwd, project)`.
- `src/core/service.ts:1956` and `:1973` — the session started with those sources
  and `cwd: workspace.path`, the same directory the panel stats.
- `src/core/repoTrust.ts:42` — the file is in the capability digest.
- `src/renderer/src/components/ProjectSettings.tsx:724-730` with `en.ts:229` —
  `present && !loaded` renders as "on disk, not read".
- `src/core/instructionSources.test.ts:190-205` — the test, whose comment carries
  the retired checkout premise.

## What is already decided

**"Delete line 156" is the wrong fix.** The rule is right in one of its two
callers: when `workspaceId` is null the panel falls back to `project.repoPath`,
and there "present in the checkout, not on the carry list" genuinely does mean
the agent will not see it, because the session runs in a worktree that has no
copy.

The rule has to become conditional on which directory was passed.
`instructionSources` cannot tell today — it receives only `cwd` — so the signal
has to be added, e.g. `carried: readonly string[] | null` where `null` means
"this is the directory the session runs in, presence is the fact", and
`service.ts` passes `null` when `workspace !== null`. Emptying the array instead
does not work: the guard still fires and still reports `loaded: false`.

**Do not fix it by widening `capabilityFiles`/trust.** The trust gate and this row
are independent — `sourcesIn` already withholds `project` and `local` while the
digest is unapproved, so an unapproved worktree correctly reports `loaded: false`
for every project row. The bug is only in the approved case.

## Sketch

The same brittleness bites a file that **is** carried. `service.ts:2370` passes
`carriedFiles(...).map((file) => file.path)`, and `carriedFiles` keeps the left
side of a line as typed — trimmed only, never normalised. A carry list spelling
it `./.claude/settings.local.json` copies the file correctly but fails
`carried.includes('.claude/settings.local.json')`. If the rule is kept for the
checkout fallback, compare normalised paths.

**Coverage will not notice the fix.** `ProjectSettings.test.tsx:945-950` mocks the
IPC answer with a hardcoded path, so it exercises the rendering, not the rule.
`instructionSources.test.ts:195` is the only test asserting the rule and it
asserts the old shape — it has to be rewritten (worktree case vs checkout
fallback), not extended, or the change lands green against a test that still
encodes the retired premise. `service.test.ts:1414-1456` is the right home for
the end-to-end version, mirroring the existing "written into the worktree,
because that is the directory a session runs in" test at `:1433-1444`.
