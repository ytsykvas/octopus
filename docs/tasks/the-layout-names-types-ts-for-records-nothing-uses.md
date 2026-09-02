# The project layout names types.ts for records the application stopped using

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`docs/PROJECT.md` §14 describes `src/core/types.ts` as holding "Workspace,
Project, WorkspaceStatus, identifiers". The identifiers are real and widely
imported. The three records are dead:

- nothing anywhere imports `Project` or `WorkspaceStatus` from `types.ts`;
  `WorkspaceStatus` is referenced only inside the dead interface itself;
- the sole importer of its `Workspace` is `src/main/ipc.test.ts:24`, which casts
  the `workspaces:create` result to it;
- the application's records are the zod inferences at `store.ts:214-215`, and the
  renderer already type-imports them from `@core/store.js`.

And they have drifted. `ProjectSchema` has thirteen fields against the
interface's five — missing `color`, `icon`, `envFile`, `approvedSettings`,
`approvedScripts`, `envProfile`, `trustRepoScripts`, `disabledSkillDefaults` —
and `WorkspaceSchema` carries `envProfile`, which the interface lacks.

Worse than a missing field, the comment at `types.ts:42` reads "Dev server port,
derived deterministically from the id" — which `docs/data.md:141` records in bold
as a fixed bug: "`port` is **allocated, not derived**. It used to be a hash of
the id… but the hash asked only our own records whether a port was free, and one
another application was holding got handed out anyway."

`docs/core.md:27` describes the same module, correctly, as "shared identifiers".
The two documents disagree about what it is.

## Why it matters

§14 is the map a newcomer reads to find where a thing lives, and it points at a
file whose contents look authoritative — hand-written interfaces with doc
comments — and are wrong. A reader who follows it comes away believing the port
is a hash of the id, which is the precise behaviour that caused a bug and was
replaced.

No runtime effect: `types.ts` contains only `export type` and `interface`, so all
of it is erased at compile time.

## Evidence

- `src/core/types.ts:21`, `:23-32`, `:34-50`, and the port comment at `:42`.
- `src/core/store.ts:137`, `:155`, `:214-215`.
- `docs/PROJECT.md:651`; `docs/data.md:141`; `docs/core.md:27`.
- `src/main/ipc.test.ts:170-174` — a **cast** on an `unknown` handler return, in a
  helper whose comment says the assertions need only its id and path. The call
  sites read `.id`, `.path`, `.branch` and `.port`, and all four stand
  character-for-character the same in the interface and in `WorkspaceSchema`;
  nothing reads `envProfile` off it and nothing does a whole-object `toEqual`. So
  no test currently passes for the wrong reason — the divergence is latent, not
  active.

## What is already decided

**Coverage was never going to catch this.** `types.ts` is on `bootstrapOnly` for
the reason its comment gives — a type-only module emits no runtime code, so there
is nothing a coverage tool could instrument. Removing it from the list would not
surface a dead `interface`.

**`WorkspaceStatus` is dead but not stale** — its four members are
character-for-character `WorkspaceStatusSchema`. Only `Project` and `Workspace`
have drifted in content.

**The fix must be subtractive only.** Do not re-export `Workspace`/`Project` from
`types.ts` to keep PROJECT.md honest: that would require importing from
`store.ts`, which reaches `node:os` through `paths.ts`, and would poison the one
module the whole renderer depends on being clean. `types.ts`'s header — "This
module deliberately has no imports — neither Electron nor Node" — is exactly why
`docs/core.md` lists it among the safe modules. That is the mistake CLAUDE.md
says has already been made twice.

The identifiers must stay: `ProjectId`/`WorkspaceId`/`ChatId` are imported by
eight core modules, and `ThemeName` by the renderer, the preload and main.

Deleting the three declarations is safe. The one import that breaks moves to
`import type { Workspace } from '../core/store.js'` — a _type_ import, erased at
compile time, so the safe-module rule is not engaged; and it is `src/main/`
anyway, where even a value import would be legal.

## Sketch

**§14 is stale far beyond this one line.** Its tree lists thirteen modules under
`src/core/`; there are 48. Missing entirely: `branches`, `colors`, `icons`,
`initials`, `ports`, `skills`, `skillNames`, `github`, `pullRequests`,
`pullRequestDraft`, `pullRequestShapes`, `envProfiles`, `envBlock`, `env`,
`scriptEnv`, `scripts`, `repoConfig`, `repoSource`, `repoTrust`, `remotes`,
`accounts`, `archive`, `carry`, `changeContext`, `conductorConfig`, `diff`,
`instructions`, `instructionSources`, `loginShell`, `questions`, `revert`,
`terminal`, `usage`, `workspaces`.

A patch that only mends the `types.ts` line leaves the map wrong in thirty-odd
other places. `docs/core.md` is the document that is actually current, so the
honest fix may be for §14 to stop trying to be a module list and point there
instead.
