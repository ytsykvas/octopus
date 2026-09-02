# A new set of variables is asked for with a dialog Electron does not have

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`addProfile` asks for the name with `window.prompt`, which Electron replaced at
renderer start-up with a function that **throws**.

Verified against the installed Electron 43.3.0 binary: `window-setup.ts` assigns
`window.prompt = function () { throw new Error('prompt() is not supported.') }`
and, because `contextIsolation` is true, pushes it into the main world via
`overrideGlobalValueFromIsolatedWorld`. `common-init.ts` runs that setup for
every protocol except `devtools:`, `chrome-extension:` and `chrome:`; this window
loads `http:` in dev and `file:` in the build, so it gets it. The sandbox check
in that code guards only `window.close`, so `sandbox: false` changes nothing.

The throw is the first statement of the async function, before any `await`, so
the promise rejects immediately and `setError(describeFailure(done))` is never
reached. Both buttons invoke it as `void addProfile(...)`, so the rejection is
unhandled — there is no `unhandledrejection` listener, `window.onerror` handler
or error boundary anywhere in the renderer.

**Pressing `New` or `Duplicate` produces no dialog, no IPC call, no banner** —
only a console entry in devtools.

`env:create` is the only route to `createProfile`, so **no project can ever hold
more than the `default` set** that `migrateEnvProfiles` creates. Everything gated
on a second set is therefore dead in the shipped app: `Duplicate`, the Remove
button, the per-workspace set entries in the Build header menu and the
resolved-name suffix on its trigger.

## Why it matters

Named environment sets are what `core/envProfiles.ts` exists for — its own
docstring calls the dev/production mix-up "the failure this whole module exists
to prevent" — and `docs/ui.md:610` describes choosing among them as something the
Build header already offers. In the built app the menu can never appear and the
module is unreachable.

**Every test mocks `window.prompt`** (`ProjectSettings.test.tsx:781, 793, 809,
822`), and jsdom supplies a stub that lets the spy install. So the suite is green
and fully covered over a path that cannot run outside jsdom.

## Evidence

- `src/renderer/src/components/ProjectSettings.tsx:320-339` — the whole of
  `addProfile`, including the docstring at `:322-327` stating that `prompt` is
  used **deliberately**, because it is "the one dialog this app does not draw
  itself". That is where the wrong assumption is written down, and it is the line
  the fix must delete.
- `src/renderer/src/components/ProjectSettings.tsx:328` — the only `window.prompt`
  in the repository.
- `src/main/index.ts:37` — `contextIsolation: true`; `:60-64` — the two protocols
  loaded, both in Electron's `default:` branch.
- `src/core/envProfiles.ts:175-193` and `:98-117`; `src/core/service.ts:2192-2194`;
  `src/main/ipc.ts:331-338`; `src/preload/index.ts:601` — the single chain.
- `src/renderer/src/components/RightPanel.tsx:856` and `:906` — the two
  `envProfiles.length > 1` gates that can never open.
- `src/renderer/src/hooks/useConfirm.tsx:39-43` — **the codebase's own opposite
  decision, in writing**: "In-app rather than the system dialog: a native alert
  cannot be styled, so it arrives as a visitor from another application." The
  comment at `ProjectSettings.tsx:322-327` is the outlier, not the rule — the app
  calls `useConfirm` in six places and `window.confirm`/`window.alert` in none.

## What is already decided

**`useConfirm` is not a drop-in.** It takes a title, message, detail, two labels,
a `destructive` flag and an optional checkbox — there is no text field. Asking
for a name needs a new dialog or an inline input, not a swap to the existing
hook. `SkillImport`/`SkillEditor` show the shape.

`service.saveEnvProfile` → `writeProfile` will also write a file under any
schema-valid name with no existence check — so `createProfile` is not literally
the only writer. But the renderer only ever passes `saveEnv` a name already in
the list, so it is not a second user-reachable route.

The i18n key already exists: `project.envProfileName` moves straight into the new
dialog. A real dialog wants confirm and cancel labels too — new keys in both
locales.

## Sketch

Apply the same `ProfileNameSchema` check the core applies, so a bad name is
refused before the round trip rather than after it.

**There is a second, unused hole in the same feature.** `env:rename` crosses the
whole stack — `renameProfile` → `service.renameEnvProfile` → `ipc.ts:341` →
`preload/index.ts:604` — and **no renderer component calls it**; it is referenced
only by the test double at `src/renderer/src/test/octopus.ts:170`. Renaming needs
the same text-input dialog, so wire both rather than leave a second dead channel.

**Sequence this against `deleting-a-set-of-variables-asks-nothing.md`.** That one
proposes routing Delete through `useConfirm` and names
`ProjectSettings.test.tsx:842` and `:857` as tests that must change. The four
create tests sit in the same `describe` and must be rewritten off
`vi.spyOn(window, 'prompt')`. Both changes rewrite the same block; doing them
blind will collide.

**A green suite is no evidence the fix works** — jsdom will happily run whatever
replaces `prompt`, exactly as it ran `prompt` itself. The check is `npm run dev`.
