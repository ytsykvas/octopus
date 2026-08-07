# maestro

A local app for running Claude Code sessions in parallel: every task lives in its
own git worktree — with its own branch, agent session and dev server on a
dedicated port.

Instead of waiting for one task to finish, you start several at once. They never
see each other and never conflict.

## Status

Stage 1, in development. The shell is in place: build, design system, quality
tooling, project management. The worktree manager and agent integration come next.

## Requirements

- Node.js 22+
- git
- [Claude Code](https://claude.com/claude-code) — the app drives it

## Running

```bash
npm install
npm run dev
```

If `npm run dev` fails with `Error: Electron uninstall`, the Electron binary was
not downloaded during install:

```bash
node node_modules/electron/install.js
```

## Development

```bash
npm run check    # full gate: format, lint, types, tests with coverage
npm test         # tests
npm run build    # build
```

`npm run check` must pass before every commit. `src/core/` coverage is held at
100% — the threshold fails the build when it drops.

## Layout

```
src/core/         application logic, headless, no Electron
src/main/         Electron main process, thin IPC bridge
src/preload/      typed bridge to the renderer
src/renderer/     UI (React + Tailwind + i18next)
docs/PROJECT.md   full description of the project, decisions and requirements
```

## Localisation

English is the default and the source of truth. Translations live in
`src/renderer/src/i18n/locales/`; Ukrainian ships alongside English.

## Licence

Private project for personal use.
