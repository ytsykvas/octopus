---
name: ui-component
description: Creating UI components — palette, tokens, themes, typography, ready-made design-system classes, and localisation of every user-facing string. Use when touching any file under src/renderer, creating a component, panel, button or list, or working with styles and themes.
when_to_use: When a UI component needs to be added or changed, a colour picked, a light/dark theme question resolved, a string localised, or when the question "how should this look" comes up.
paths:
  - src/renderer/**
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm run typecheck:*), Bash(npx eslint:*)
---

# UI component

The invariants are in `.claude/rules/renderer.md`; this is how to meet them.
Tokens live in `src/renderer/src/styles.css`; the design intent, a calm desktop
interface in the spirit of Linear, Raycast and VS Code, is §10 of
`docs/PROJECT.md`.

## Localising a string

Add the key to `en.ts` first, then `uk.ts` and `de.ts`. German addresses the
user as _du_, keeps developer terms English (der Branch, der Pull Request, der
Workspace) and avoids long compounds.

```tsx
const { t } = useTranslation()
return <span>{t('sidebar.projects')}</span>
```

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
  rule above; the linter rejects both.

## The content comes first

This interface carries chat, diffs and logs — dense text people read for hours.
The styling has to stay out of its way:

- no `uppercase`, no weight 900;
- hierarchy through **colour** (`ink` → `ink-soft` → `ink-faint`) and weight,
  not size;
- panels separated by 1px borders, **not** shadows;
- shadows only for things floating above the content (menus, modals).

The one exception is the composer's colour ring (`.composer-ring`): the single
place the user types, made to be found at a glance. It is not a pattern to copy
onto another pane — the one sanctioned second use is the Help button at the foot
of the workspace list (`.help-button`), in rules of its own.

That is exactly why the original neo-brutalist style was dropped — it shouted
over its own content.

## Check the ready-made classes first

- `.panel` — surface with border and 10px radius;
- `.composer-ring` — the composer's colour ring and glow, with `.composer-ring-line`
  as its own first child (the one layer that turns, and only while focused);
- `.help-button` — the Help button's quieter copy of that ring, with
  `.help-button-line` as its own first child (turns only under the pointer or focus);
- `.row` / `.row-selected` — list row with hover and selection;
- `.project-tinted` / `.bubble-sent` / `.tab-selected` — where a project's
  colour turns into a surface;
- `.input` — text field, and anything shaped like one;
- `.choice` — **every** checkbox and radio, with `.choice-danger` for the tick
  inside a destructive confirmation. Not optional and not replaceable by
  `accent-color`: that colours the checked fill and leaves the empty box a
  white square on the dark canvas;
- `.section-label` — section heading (11px, weight 600, muted);
- `.focus-ring` — visible keyboard focus;
- `.titlebar-drag` — window drag region.

The second copy of a run of utility classes is the moment to add a class here.
Six copies of the field styling had already drifted by a few pixels of height —
inconsistency that reads as sloppiness rather than as variety.

## The tokens

Available: `canvas`, `surface`, `muted`, `line`, `line-strong`, `ink`,
`ink-soft`, `ink-faint`, `accent`, `accent-hover`, `on-accent`, `success`,
`danger`, `warning`, `info`, plus paired backgrounds `success-bg`, `danger-bg`,
`warning-bg`, `info-bg`.

**Status colours** apply to text or icons; only the paired `*-bg` is used as a
background. Solid colour blocks make a list look like confetti.

## Sizing

- Buttons and rows: 24px (`sm`) or 28px (`md`) tall, radius `--radius-control`.
- Panels: radius `--radius-panel`.
- Body text 13px; monospace (branches, paths, code) 11px.

The interface is dense on purpose: there is a lot of data, and generous padding
forces scrolling.

## Components

`Button` has six variants: `accent` (primary action), `success` (green: what
starts something running or finishes the work — Run, a send, a push, a merge),
`quiet` (secondary), `danger` (subdued destructive), `destructive` (filled, for
the action a confirmation is asking about) and `agent` (the composer's colour
ring, for a press that hands the work to the agent). Extend it rather than
adding new button components.

Existing pieces, worth checking before writing another: `Modal`,
`DropdownMenu`, `Combobox` (a select with search), `Field`, `NameEditor`,
`ResizeHandle`, `Terminal`, and the pair in `Disclosure.tsx` for anything that
folds — `DisclosureButton` for the toggle, `DisclosureChevron` alone where the control
is not a plain button (a `Button`, a tree row, a `<summary>`).

A mounted `Terminal` that is not on screen is hidden with `.offstage` inside a
box that clips, or with `display: none` — never `invisible` or a box of no
height, which xterm cannot tell from on screen and goes on drawing
(`docs/ui/right-pane.md`, "A terminal not on screen stops being drawn").

`Modal` deliberately leaves its body without padding so a list can span the
full width — a form inside it brings its own.

`Modal` draws its body and footer one render after the dialog opens, so
`autoFocus` inside works. The cost: a ref into those contents is still `null` in
the first effect of the component that opened it.

`DropdownMenu` positions its panel against the **window**, not its trigger.
An `absolute` panel is clipped by any scrolling ancestor, and the project tab
strip is one — the menu came out sliced to the width of a 56px column. The cost
is that the coordinates are a snapshot, so a resize closes it, and so does a
scroll — but only one in something the trigger sits **inside**. Closing on every
scroll was the first rule and the chat log broke it: it pins itself to the
bottom on each streamed fragment, so the composer's menus shut a few times a
second while the agent answered, and the composer had not moved a pixel.

**A panel is drawn into the body, not beside its trigger.** `z-50` only ever
means "above its own siblings", and any `sticky` or `transform`ed ancestor with
a `z-index` starts a stacking context the panel cannot be lifted out of by any
number. The diff's file headers are exactly that, and a menu opened from one was
painted behind the next header. `DropdownMenu` portals; if you write another
panel, portal it too — and remember that `useDismiss` then needs the panel's own
ref, or a click inside it counts as outside and closes it under the pointer.

**A panel that is not a menu gets `useAnchoredPanel`** rather than a third copy
of that reasoning: it holds the open state, the fixed coordinates, the flip, the
clamp and all four ways of closing, and both composer panels use it. Give it the
size at the moment of opening — a panel's height often depends on what it is
about to draw.

## Colour that carries meaning

A project's colour comes from `--project-<name>`, declared once per theme, and
is applied by setting `--project-color` inline on a container. That inline style
is the one sanctioned exception: the value is dynamic, but it still resolves to
a token.

Two rules that are easy to get wrong:

- **There is no `project-` utility class.** No `--project-*` token is in
  `@theme`, so `text-project-blue` compiles to nothing at all — no error, no
  colour, and no Tailwind lint wired in to say so. Reach for the value the way
  the rest of the code does: an arbitrary value like
  `after:bg-[var(--project-color)]`, or an inline style.
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

## Before finishing

```bash
npm run typecheck:web
npx eslint src/renderer
```
