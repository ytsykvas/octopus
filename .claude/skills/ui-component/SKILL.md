---
name: ui-component
description: Creating UI components — palette, tokens, themes, typography, ready-made design-system classes, and localisation of every user-facing string. Use when touching any file under src/renderer, creating a component, panel, button or list, or working with styles and themes.
when_to_use: When a UI component needs to be added or changed, a colour picked, a light/dark theme question resolved, a string localised, or when the question "how should this look" comes up.
paths:
  - src/renderer/**
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm run typecheck:*), Bash(npx eslint:*)
---

# UI component

The style is a **calm desktop interface** in the spirit of Linear, Raycast and
VS Code: neutral base, thin separators, restrained accents (§10 docs/PROJECT.md).

Tokens live in `src/renderer/src/styles.css`. **Never write colours inline** —
tokens only, otherwise the dark theme breaks.

## Every string is localised

No user-facing text appears in a component. Add the key to
`src/renderer/src/i18n/locales/en.ts` first — English is the source of truth —
then translate it in `uk.ts`. TypeScript rejects a locale that drifts.

```tsx
const { t } = useTranslation()
return <span>{t('sidebar.projects')}</span>
```

Errors coming from core carry a `code`; render them through `useErrorMessage`
rather than printing `failure.error` directly.

**Delete a key when its last caller goes.** A key nothing reads is a claim
about the interface that has quietly stopped being true, and it survives every
type check — `en.ts` types `uk.ts`, but nothing types either against the code.

## State that is not this component's

IPC calls, their error handling and the list they maintain belong in a hook —
`useProjects` and `useWorkspaces` are the pattern. A component that lays out a
window should not also know what an IPC failure looks like.

The split is not all-or-nothing: `useProjects.remove` asks and deletes, while
`App` clears the selection afterwards, because what points at a project is the
window's business, not the hook's.

## React rules the linter enforces

`react-hooks` here is strict, and two rules come up constantly:

- **No `setState` in an effect.** State derived from a prop is adjusted during
  render (`if (activeId !== lastActiveId) { … }`, the official pattern); state
  that follows an event is set in the handler.
- **No reading a ref during render.** A ref is not an escape hatch from the
  rule above; both were rejected in turn while writing `WorkspaceTerminals`.

## The content comes first

This interface carries chat, diffs and logs — dense text people read for hours.
The styling has to stay out of its way:

- no `uppercase`, no weight 900;
- hierarchy through **colour** (`ink` → `ink-soft` → `ink-faint`) and weight,
  not size;
- panels separated by 1px borders, **not** shadows;
- shadows only for things floating above the content (menus, modals).

That is exactly why the original neo-brutalist style was dropped — it shouted
over its own content.

## Check the ready-made classes first

- `.panel` — surface with border and 10px radius;
- `.row` / `.row-selected` — list row with hover and selection;
- `.input` — text field, and anything shaped like one;
- `.section-label` — section heading (11px, weight 600, muted);
- `.focus-ring` — visible keyboard focus;
- `.titlebar-drag` — window drag region.

The second copy of a run of utility classes is the moment to add a class here.
Six copies of the field styling had already drifted by a few pixels of height —
inconsistency that reads as sloppiness rather than as variety.

## Colours through tokens only

```tsx
// Good
<div className="bg-surface text-ink border-line">

// Bad — breaks the dark theme
<div className="bg-[#f7f8fa] text-black border-gray-200">
```

Available: `canvas`, `surface`, `muted`, `line`, `line-strong`, `ink`,
`ink-soft`, `ink-faint`, `accent`, `accent-hover`, `on-accent`, `success`,
`danger`, `warning`, `info`, plus paired backgrounds `success-bg`, `danger-bg`,
`warning-bg`, `info-bg`.

**Text on an accent** uses the `on-accent` token, not `text-white`.

**Status colours** apply to text or icons; only the paired `*-bg` is used as a
background. Solid colour blocks make a list look like confetti.

## Sizing

- Buttons and rows: 24px (`sm`) or 28px (`md`) tall, radius `--radius-control`.
- Panels: radius `--radius-panel`.
- Body text 13px; monospace (branches, paths, code) 11px.

The interface is dense on purpose: there is a lot of data, and generous padding
forces scrolling.

## Components

`Button` has four variants: `accent` (primary action), `quiet` (secondary),
`danger` (subdued destructive), `destructive` (filled, for the action a
confirmation is asking about). Extend it rather than adding new button
components.

`Modal`, `DropdownMenu`, `Combobox` (a select with search), `Field` and
`NameEditor` already exist. `Modal` deliberately leaves its body without
padding so a list can span the full width — a form inside it brings its own.

## Themes

Nothing to do if you use tokens: `.dark` on `<html>` swaps every value at once.
`App.tsx` sets the class from a main-process event.

**Check both themes** — muted colours behave differently against a dark ground.

## Where logic does not go

A component renders and calls `window.octopus.*`. Git, filesystem and process
work lives in `src/core/`.

## Before finishing

```bash
npm run typecheck:web
npx eslint src/renderer
```
