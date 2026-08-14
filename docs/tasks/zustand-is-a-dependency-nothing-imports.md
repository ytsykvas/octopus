# zustand is a dependency nothing imports

**Found:** 2026-08-14, while looking for somewhere to put state shared by two panes.

## What happens

`zustand` is in `package.json` and named in `docs/PROJECT.md` as what holds UI
state. `grep -rn zustand src` finds nothing: every piece of shared state in the
renderer is a hook whose value `App` holds and passes down.

## Why it matters

A dependency nobody imports is a claim about the architecture that is not true,
and the docs repeat it. Someone reaching for shared state reads that line, adds
a store, and now the app has two ways of doing one thing — which is worse than
either.

## Evidence

- `package.json` — `"zustand": "^5.0.14"` under dependencies.
- `docs/PROJECT.md:174` — names it as the state library.
- `src/renderer/src/hooks/` — `useProjects`, `useWorkspaces`, `useDiffComments`
  and the rest, all plain hooks lifted into `App`.

## What is already decided

Nothing. Both answers are defensible: the hooks work and the prop threading is
shallow, so dropping the dependency is honest; equally, `useDiffComments` had to
be lifted into `App` to reach two sibling panes, and a store is what that
pattern turns into if a third such value appears.

## Sketch

Decide, then make the docs say what is true. If it goes, `npm uninstall zustand`
and edit §7 of `docs/PROJECT.md`. If it stays, the next value shared between
non-adjacent panes is what should move into it first.
