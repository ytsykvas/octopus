# A one-field project edit resets every other field the patch did not carry

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`ProjectPatchSchema` is `ProjectSchema.pick({...}).partial()`. Six of the picked
fields carry `.default()` on `ProjectSchema`, and in zod 4 `.partial()` wraps a
`ZodDefault` in `ZodOptional` **without** suppressing the default. So parsing a
one-key patch materialises all six.

Run in the repository against zod 4.4.3, `ProjectPatchSchema.parse({ color: 'teal' })`
returns seven keys. Fed to `updateProject`, a project holding `.env.local`,
`['digest-a']`, `['digest-b']`, `prod`, `true`, `['review']` comes back as
`.env`, `[]`, `[]`, `default`, `false`, `[]`.

`src/main/ipc.ts:207` is the only place that parse happens, and it is on the path
of every project edit. The renderer only ever sends one-key patches — `{ name }`,
`{ color }`, `{ icon }`, `{ baseBranch }`, `{ envProfile }`, `{ trustRepoScripts }`,
`{ disabledSkillDefaults }` — so **every** edit path triggers it.

`updateProjectById` then compares `wasEnvFile` against the new one, sees a
change, and runs `removeEnvBlock` over every workspace — stripping octopus's
block out of the file the project was actually using. That half only fires when
the stored `envFile` was something other than `.env`, which is exactly the
Vite/Next case `store.ts:78-84` added the field for.

## Why it matters

Picking a colour silently revokes both approval lists, turns `trustRepoScripts`
off, clears the disabled-skill defaults, and resets `envProfile` from `prod` back
to `default`. Every workspace of that project then runs against a different set
of credentials — precisely the silent environment swap `envProfiles.ts:1-19` says
it exists to prevent.

The reset is also partly visible and partly not, which is the worst combination.
`useProjects.update` calls `refresh()` after every patch, so an open settings
dialog re-renders with the profile back on `default` and the trust toggle off; a
user looking at that section might notice. The approval digests have no UI at
all, and the `removeEnvBlock` write across every worktree is invisible.

## Evidence

- `src/core/store.ts:384-396` — `ProjectPatchSchema = ProjectSchema.pick({...}).partial()`.
- `src/core/store.ts:84,93,103,111,124,134` — the six `.default()` fields.
- `src/core/store.ts:406` — `updateProject`; `:472-499` is the return block whose
  per-key spreads apply every key that is `!== undefined`, which they now all are.
- `src/main/ipc.ts:207` — the only `ProjectPatchSchema.parse` in the repository.
  `src/preload/index.ts:556-557` forwards the patch untouched.
- `src/core/service.ts:2088` — `updateProjectById` applies a local `applied`, not
  `patch`; a fix touching the service has to account for that variable.
- `src/core/service.ts:2100-2118` — `wasEnvFile` compared after the commit,
  `removeEnvBlock` over every workspace.
- `src/renderer/src/components/ProjectSettings.tsx:240,360,368,423,456,469,502,629,696,748`
  — every call site sends exactly one key, the env-file field included, which
  resets the other five while doing its own job.

## What is already decided

**The defaults stay on `ProjectSchema`.** The comments at `store.ts:78-84`,
`105-111` and `132-134` say why: a record written before those fields existed
still has to load, with no migration. The patch schema is what must stop
inheriting them.

The correct idiom is already in the codebase, one function away — `applyConfig`
(`service.ts:1016-1025`) parses the _merged_ object, `ConfigSchema.parse({ ...config, ...patch })`,
so a default can only fill a key genuinely absent from both. `config:update`
looks like the same bug and is not, for this reason.

Whatever the fix, keep the compile-time link `store.test.ts:340-351` relies on:
the `CHANGES` record is typed `{ readonly [K in keyof Required<ProjectPatch>]: ... }`
so a new patch field fails to compile until it is given a value. A hand-written
`z.object({...})` keeps that but loses the guarantee that the patch fields track
`ProjectSchema`'s validators. A helper unwrapping `.def.innerType` off each
`ZodDefault` in the picked shape preserves both.

## Sketch

The regression test **must cross `src/main/ipc.ts:207`**. Nothing in `src/core`
can catch this: every core test calls `updateProject` with hand-written literals
and would pass with the bug in place — which is why the suite is green while
`store.test.ts:316-320` states the intent in words ("a patch must not carry a
stale copy of the others back into the state").

The home is `ipc.test.ts`, on a project first moved off the defaults, then
patched with `{ color }` alone and asserted field by field. `toMatchObject` is
not enough; it is what let `ipc.test.ts:413-421` miss this.
