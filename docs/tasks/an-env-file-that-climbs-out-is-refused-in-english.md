# An env file that climbs out of the workspace is refused in English

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`updateProject` refuses an `envFile` that is absolute or starts with `..` by
throwing a bare `StateConflictError('An env file has to sit inside the workspace')`
with no `code`. `StateConflictCode` covers only the four `repoPath` cases.

It is reachable: the env-file field in project settings is a free-text input
whose blur handler sends whatever was typed, `ProjectPatchSchema` picks `envFile`
off `ProjectSchema` where it is only `z.string().min(1)`, and
`updateProjectById` pre-checks `repoPath` and `baseBranch` only. So
`../shared/.env` passes every layer.

`attempt` omits the `code` key when it is undefined, so `useErrorMessage` falls
to its `default` arm and renders `errors.unknown` — "Щось пішло не так: {{message}}"
— wrapped around the English sentence.

What the user experiences is split in two: the field snaps back to `.env` with
nothing visible explaining why, because the banner that carries the message lives
inside `<main>` while `ProjectSettings` is a modal rendered after it. The English
message is sitting there once the dialog is closed.

## Why it matters

The user writes in Ukrainian, and the whole error-code mechanism exists so
refusals reach them in their own language. `../shared/.env` is a plausible thing
to try in a monorepo, and it produces a Ukrainian frame around an English
sentence — the one outcome the fallback is documented as being for logs only.

It is also the only reachable refusal in `store.ts` left without a code, so the
comment claiming otherwise reads as true when it is not, and the next person
adding a validation here will copy the wrong pattern.

Low, because the refusal itself is correct and protective, the user is not left
in a bad state, and the workaround is obvious. What is broken is presentation —
and the house rule.

## Evidence

- `src/core/store.ts:461-469` — the whole `envFile` block. `:463`
  (`'An env file cannot be empty'`) is uncoded too, and only unreachable because
  the renderer guards it.
- `src/core/store.ts:233-234` — `StateConflictCode`, four `repoPath` members.
- `src/core/store.ts:84` — `envFile: z.string().min(1).default(DEFAULT_ENV_FILE)`,
  the only schema-level constraint.
- `src/main/ipc.ts:206-207`; `src/core/service.ts:2070-2100` — nothing else
  narrows it.
- `src/main/result.ts:50-58` — the `code` key is dropped when undefined;
  `src/renderer/src/hooks/useErrorMessage.ts:130-131` — the default arm.
- `src/renderer/src/App.tsx:104` and `:690-693` versus `:813-836` — the banner
  behind the modal.
- `src/renderer/src/components/ProjectSettings.tsx:348-361` and `:589-600` —
  `commitEnvFile` and the free-text input.
- `src/core/store.test.ts:854-861` asserts only `.toThrow(StateConflictError)`,
  never the code — unlike `projects.test.ts:137`, which does assert
  `.code === 'duplicateProject'`.

## What is already decided

The constructor's doc comment at `store.ts:237-244` is misleading in **both**
directions. It claims the reachable conditions are exactly the coded ones, which
this breaks; and its own last clause cites "the duplicate branch name a user can
actually produce", pointing at `store.ts:527-535`, which is not reachable today
because `createWorkspaceIn` takes no user-supplied name and derives the branch
from `nextWorkspaceName`. Rewrite it in the same change, or the next reader
inherits a claim that was already false before this finding.

The other uncoded throws in `updateProject` are genuinely unreachable through the
UI — `commitName`, `commitEnvFile` and `changeBranch` all guard upstream, and
`addProject`'s duplicate is pre-empted by the coded
`ProjectValidationError('duplicateProject')`.

## Sketch

Add `envFileEscapes` — and, while the file is open, `envFileEmpty` — to
`StateConflictCode`, throw them from the two branches, and add the cases to
`useErrorMessage` plus keys to `en.ts` then `uk.ts` (TypeScript enforces the
match). The existing `repoPath` entries sit at `en.ts:1003-1007` / `uk.ts:840-847`.

Pass the offending path as a `param`, the way `repoPathRelative` does at
`store.ts:427-429`. The user typed something; a message that repeats it back is
worth more, and the plumbing already works end to end.

**This collides with `three-modules-spell-the-same-path-rule.md`**, which proposes
replacing this very `isAbsolute || normalize().startsWith('..')` with a shared
`insideWorktree` predicate — whoever does that task rewrites line 467. That note's
own evidence is already stale: it says `store.ts:327`, and the check is at
`store.ts:467`.
