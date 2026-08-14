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
- `.project-tinted` / `.bubble-sent` / `.tab-selected` — where a project's
  colour turns into a surface;
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

Existing pieces, worth checking before writing another: `Modal`,
`DropdownMenu`, `Combobox` (a select with search), `Field`, `NameEditor`,
`ResizeHandle`, `Terminal`.

`Modal` deliberately leaves its body without padding so a list can span the
full width — a form inside it brings its own.

`DropdownMenu` positions its panel against the **window**, not its trigger.
An `absolute` panel is clipped by any scrolling ancestor, and the project tab
strip is one — the menu came out sliced to the width of a 56px column. The cost
is that the coordinates are a snapshot, so a resize closes it, and so does a
scroll — but only one in something the trigger sits **inside**. Closing on every
scroll was the first rule and the chat log broke it: it pins itself to the
bottom on each streamed fragment, so the composer's menus shut a few times a
second while the agent answered, and the composer had not moved a pixel.

## Colour that carries meaning

A project's colour comes from `--project-<name>`, declared once per theme, and
is applied by setting `--project-color` inline on a container. That inline style
is the one sanctioned exception: the value is dynamic, but it still resolves to
a token.

Two rules that are easy to get wrong:

- **Text on a filled colour uses `--project-ink`**, not `#fff`. The dark theme
  uses brighter values on purpose, and white on them is barely legible.
- **Measure contrast, do not judge it.** Five colours looked fine and sat
  between 3.3:1 and 4.1:1 against white — under the 4.5:1 body text needs. A
  short script comparing relative luminance settles it in seconds.

## Selection is a relationship, not a highlight

The obvious way to show which project is active is to make its tab the
brightest thing on the strip. Browser tabs do the opposite, and they are right:
the active tab is the panel reaching back, not a button shouting next to it.

So the active tab takes exactly the colour the sidebar's gradient starts with,
runs to the strip's right edge, squares off there, and the dividing line is
removed so the two surfaces meet. Inactive tabs step back rather than compete.

Two consequences worth carrying to anything else built this way:

- **Surfaces that are meant to join must start at the same coordinate.** Four
  pixels of padding above the first tab was enough to break the effect
  outright. When two elements share an edge, their offsets are one decision,
  not two.
- **Delete the redundant signal.** The strip had a marker beside the active
  tab; once the tab visibly joined the panel, the marker was a second answer to
  a question already answered — which reads as noise, not as emphasis.
- **On ground that already carries a colour, selection is a surface.** The
  workspace list is washed in the project's hue, and the selected row used a
  fill of the blue accent: two unrelated colours in the same 200px, and the
  accent read as a foreign object. `.row-selected` lifts the row onto the plain
  canvas instead, leaving colour to a 2px mark in the project's own hue.
- **Announce it as well as draw it.** A lifted surface and a mark reach nobody
  using a screen reader, so the chosen row, tab and rail item all carry
  `aria-current` — which is also the only handle a test has on selection.

## Themes

Nothing to do if you use tokens: `.dark` on `<html>` swaps every value at once.
`App.tsx` sets the class from a main-process event.

**Check both themes** — muted colours behave differently against a dark ground.

## Where logic does not go

A component renders and calls `window.octopus.*`. Git, filesystem and process
work lives in `src/core/`.

## Running the tests

The renderer has a vitest config of its own, and the default one does not look
in `src/renderer` at all. Without the flag a test file here is not "failing" —
it is `No test files found`, which reads like a missing file.

```bash
npx vitest run --config vitest.renderer.config.ts src/renderer/src/components/X.test.tsx
```

`npm test` runs both configs in turn, so only a single file needs the flag.

## Before finishing

```bash
npm run typecheck:web
npx eslint src/renderer
```
