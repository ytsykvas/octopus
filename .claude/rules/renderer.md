---
paths:
  - 'src/renderer/**'
---

# `src/renderer/`

A calm desktop interface: neutral base, 1px separators, restrained accents
(§10 of `docs/PROJECT.md`). These hold for every file here; the ready-made
classes and components are listed in the `ui-component` skill.

- **No user-facing string inline.** Add the key to
  `src/renderer/src/i18n/locales/en.ts` first, then `uk.ts` and `de.ts` in the
  same commit. TypeScript catches a missing key, never a stale one: rewording
  the English means rewording both translations. Delete a key when its last
  caller goes.
- **Colours only through the tokens in `styles.css`**, never raw hex or a
  Tailwind palette colour — the dark theme breaks otherwise. Text on an accent
  uses `on-accent`. There is no `project-*` utility class: a project's colour
  is `var(--project-color)`.
- **Check both themes.** `.dark` on `<html>` swaps every token at once.
- **No `uppercase`, no weight 900, no shadows between panels** — the content
  is chat, diffs and logs read for hours. Hierarchy comes from colour and
  weight, not size.
- **A component renders and calls `window.octopus.*`.** IPC calls, their
  errors and the list they maintain live in a hook (`useProjects`,
  `useWorkspaces`). Git, files and processes live in `src/core/`.
- **Errors from core carry a `code`**: render them through `useErrorMessage`,
  not `failure.error`.
- **The `react-hooks` rules are strict:** no `setState` in an effect — derive
  during render or set in the handler — and no reading a ref during render.
- **A floating panel is portalled into the body**, positioned against the
  window, and uses `useAnchoredPanel` unless it is a `DropdownMenu`.
- **Tests query by role, label, title or text**, never by class name. The
  selected row, tab and rail item carry `aria-current`.
- **The renderer has its own vitest config.** Run one file with
  `npx vitest run --config vitest.renderer.config.ts <file>`; without the flag
  the file is "not found", not failing.
