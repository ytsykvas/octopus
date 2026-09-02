# The clone destination chosen once is never told to the window

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`resolveCloneDirectory` writes the destination the user picked by calling
`service.updateConfig` **directly** — it does not go through the `config:update`
handler, so it skips even the one push that handler makes
(`host.broadcastTheme`). Main therefore tells no window anything.

The renderer reads the config once on mount and otherwise only replaces it from
its own `config:update` reply, so `cloneDirectory` stays `''` for the rest of the
session while the file on disk and main's copy hold a real path.

The staleness is specific to the destination chosen in **main's** dialog: the
picker's own "Change…" button goes through the renderer, so a destination set
that way does show up immediately.

## Why it matters

The two places that report where clones land both read the stale value and both
then lie: the picker footer prints "You will be asked where to clone." and
Settings shows "Not set — you will be asked on the first clone."

The second and every later clone of the session is written into a directory the
user was told they would be asked about, with no prompt and nothing on screen
naming it — the project's on-disk path is not rendered anywhere.

The picker's own comment says this footer exists because "a surprise location is
hard to undo". This is that surprise.

It corrects itself on the next app start, and nothing is corrupted — `applyConfig`
parses `{ ...config, ...patch }` over main's own copy, so the window's stale `''`
can never be written back. Which is why this is low.

## Evidence

- `src/main/ipc.ts:744-767` — `resolveCloneDirectory`; `:765` calls the service
  directly rather than through the handler.
- `src/main/ipc.ts:157-163` — `config:update` **does** broadcast after a write,
  the precedent this path bypasses; recorded at `docs/ipc.md:35`.
- `src/main/index.ts:110,116,122,128,134` — the five push channels; none carries
  the config. `src/preload/index.ts:79-83` — `get` and `update` only, no
  subscription exists to carry one.
- `src/renderer/src/App.tsx:199-211` — `config.get()` in a `[]`-deps effect, the
  only read; `:231-237` — the only other `setConfig`.
- `src/renderer/src/components/RepositoryPicker.tsx:126-135`;
  `src/renderer/src/components/Settings.tsx:246-252`; `en.ts:54` and `en.ts:849`.
- `src/main/ipc.test.ts:768-782` — the only test of the remembering asserts
  main's own `cloning.getConfig()`; nothing asserts the window learns.

## What is already decided

**Do not widen the `projects:addFromGitHub` reply to carry the config.** Its
current shape is load-bearing: `null` means "the destination prompt was
cancelled", and both `RepositoryPicker.tsx:113-114` and `ipc.test.ts:749-766`
depend on it.

## Sketch

The narrow fix — re-read the config in `App`'s `onPicked` handler — works but
leaves a second, identical hole: `config:update` from one window already updates
only that window's state, so with two windows open **every** setting except the
theme is stale in the other one.

A `config:changed` broadcast sent from the two places in main that write
(`ipc.ts:159` and `:765`) fixes both at once, and is the same shape as the sketch
already filed in
`a-second-window-never-learns-a-conversation-was-opened.md` for `chats:changed`.
A sixth push channel means updating `docs/ipc.md`'s broadcast table and
`src/preload/index.ts`.

Worth noting either way: `resolveCloneDirectory` bypassing the handler is why it
also misses `broadcastTheme`. Harmless today, since it only patches
`cloneDirectory` — but any future config write added in main will silently skip
both broadcasts unless the broadcast moves to where the write happens.
