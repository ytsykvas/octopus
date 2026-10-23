---
paths:
  - 'src/main/**'
  - 'src/preload/**'
---

# `src/main/` and `src/preload/`

- **`main/` is a thin bridge**: window, menu, the IPC table, pseudo-terminals.
  Logic appearing here belongs in `src/core/`.
- **Every IPC argument is parsed with zod at the handler**, whatever its
  TypeScript type says: the renderer draws agent output, so a compromised
  window must not reach a command line.
- **`preload/` holds channel names and types, nothing else.**
- **Nothing here hot-reloads.** Only the renderer does. A change under
  `src/main/`, `src/preload/` or any core module they import reaches the app
  only after `npm run dev` is restarted — until then the old build runs and a
  fix that looks ineffective may simply not be loaded. Restart it yourself
  before handing the app back; [docs/development.md](../../docs/development.md)
  says how to stop the old copy cleanly.
