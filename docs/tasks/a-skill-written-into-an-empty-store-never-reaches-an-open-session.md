# A skill written into an empty store never reaches an open conversation

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`sessionSkills` hands a session the two octopus stores as extra working-directory
roots, but deliberately omits a store that is empty at that moment. `startFor`
passes that list **once**, at session start, and `agent.ts:386` drops
`additionalDirectories` entirely when the list is empty.

Afterwards the three write paths call `refreshRunningSkills` →
`session.refreshSkills()` → `conversation.reloadSkills()`, which re-scans the
directories the session knows about. A root that was never handed over is not one
of them.

The decision is taken **once per session, not once per skill**. So for a
conversation whose session started while a store was empty, _every_ skill later
written into that store — the first, the second, the tenth — is invisible to that
session for as long as it lives. The two stores fail independently: a project
whose store is empty misses its project skills even when the global store is
populated and registered.

Meanwhile the composer's Skills panel calls `skillsForChat` → `sessionSkills`,
which re-reads the store off disk on every call, so the new skill appears there
and appears switched on.

## Why it matters

This is the state of every fresh install and of every project store the first
time somebody uses it: you write a skill, the panel lists it as available to this
conversation, and the agent does not have it.

Nothing in the app says a restart is needed, and the session ends only on app
quit, workspace or project removal, or by starting a different chat. So the
natural conclusion is that skills do not work.

Repository skills (the worktree's own `.claude/skills`) are unaffected, since cwd
is always a registered root — which is why the reload path looks like it works.

## Evidence

- `src/core/service.ts:1926-1936` — roots omitted for an empty store, by design,
  with the comment saying so.
- `src/core/service.ts:1959-2001` — `startFor` computes the roots once and hands
  them to `startSession` at `:1987`; the session is stored and never rebuilt.
- `src/core/agent.ts:383-388` — the option dropped entirely for an empty list.
- `src/core/agent.ts:498-503` — `refreshSkills` is nothing but
  `conversation.reloadSkills()`.
- `src/core/service.ts:3148-3154` — `sendToChat` reuses the running session; only
  mode and effort are re-asserted, nothing re-registers a root.
- `src/core/skills.ts:12-19` and `src/core/agent.ts:76-81` — a store reaches a
  session **only** as an extra root; the plugin route was measured and rejected,
  so there is no second channel a reload could use.
- `src/core/service.test.ts:6605-6627` — the test that models this exact broken
  state: it starts a session with no skills, writes the first one, and asserts
  the reload was _called_. It passes while the skill remains unreachable, because
  counting reloads does not test that the reload can find anything. Its own
  comment states the property it does not check.

## What is already decided

**The obvious fix is closed off.** The SDK has a `register_repo_root` control
request that adds a root and reloads skills, but it is not exposed as a method on
`Query` — only the request type exists — and its own contract requires the
directory to resolve to a strict subdirectory of cwd or of a directory passed at
launch, which `~/.octopus/skills` is not when the launch list was empty. The fix
has to be at start-up or by restart.

`src/core/service.test.ts:6535-6542` asserts `additionalDirectories` is undefined
when both stores are empty, so the omission is deliberate and locked in — that
test changes with whatever is chosen.

## Sketch

Two shapes that work:

1. **Hand both roots over unconditionally.** They must exist first — `ensureStore`
   is currently only called on the way to a write, and `--add-dir` on a missing
   directory is at best untested. Decide deliberately whether a fresh install now
   grows two empty directories on first message.
2. **Restart the sessions in scope when a store crosses from empty to
   non-empty.** Cheap here, because `startFor` already passes
   `resume: chat.sessionId`, so the CLI session is reattached rather than lost.
   The cost is any in-flight turn.

**The regression test must assert `options.additionalDirectories` on the started
session**, in the shape of `service.test.ts:6522-6533` — not the reload count.
`service.test.ts:6605` keeps passing either way and is exactly the test that let
this through. Note `service.test.ts:6531` hardcodes `[join(dir, 'data', 'skills')]`.

Two smaller things in the same neighbourhood: the block comment at
`service.test.ts:6408-6412` still claims the stores "arrive as a plugin", which
contradicts `skills.ts:12-19` and the current gate — stale and misleading about
the very mechanism this bug is in. And `setChatSkill` (`service.ts:2588-2608`)
will happily push an `off` override for a skill the running session cannot see.
