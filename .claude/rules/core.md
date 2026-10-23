---
paths:
  - 'src/core/**'
---

# `src/core/`

All application logic, headless. These hold for every file here; the technique
for meeting them is the `core-module` skill.

- **No `electron`, no DOM.** The ESLint rule `no-restricted-imports` fails the
  gate on it. A decision that needs a window stays here as a pure function and
  `src/main/` supplies the Electron part.
- **Dependencies are parameters with defaults** — the executor, the clock, the
  random source, the home directory. A parser is a separate pure function
  tested on strings.
- **`execFile` with an argument array, never `exec`.** Nothing is interpolated
  into a shell line or an AppleScript source.
- **zod at every boundary** — IPC, disk, git output, the SDK — before a value
  reaches a process argument, a path or a script. Types come from `z.infer`.
- **An error the user can act on carries a machine-readable `code`**; the
  renderer maps it to a localised message. Never swallow an error: stderr from
  an external command reaches the user.
- **Uniqueness has a scope.** Say _within what_ before rejecting a duplicate:
  a workspace name, slug and branch within its project; an id across the app;
  a skill name across everything the agent can see.
- **git is the source of truth for what git knows.** `state.json` holds only
  what git cannot: the session, the port, the label.
- **A failed multi-step operation undoes what it made**, and the rollback
  never throws — it runs while another failure is being handled.
- **A field added to anything under `StateSchema` needs a default.** The
  reader throws on a mismatch, so a record written before the field must still
  load. The test is one line in `store.test.ts`: write the older shape, load it.
- **Tests drive real git in a temporary directory**, never a mock of it and
  never `~/.octopus` or the user's data root. A fake executor is for cases
  real git will not produce.
- **A function with a default parameter is tested with and without it.**
- **Verify a guard by reverting it.** 100% coverage says the line ran, not that
  anything would notice if it went: put the bug back and the suite must go red.
