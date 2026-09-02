# No skill error code reaches the window

**Found:** 2026-09-02, in a review of the whole repository, alongside
[a-skill-named-differently-from-its-folder-cannot-be-removed.md](a-skill-named-differently-from-its-folder-cannot-be-removed.md).

## What happens

`attempt` lists eight error classes whose `code` and `params` it carries across
the bridge. `SkillError` is not one of them, so every skill refusal falls through
to `{ ok: false, error: describeError(error) }`.

Verified by running `attempt` with a `SkillError('skillMissing', …)`: the result
is `{"ok":false,"error":"real-name has no readable SKILL.md."}` — no `code`, no
`params`.

In the renderer that misses every `case 'skill…'` in `useErrorMessage` and lands
in `default:` → `errors.unknown`, so the raw English core message is shown inside
a Ukrainian frame. `skillMissing`, `skillNameInvalid`, `skillExists`,
`skillNameMismatch`, `skillTooLarge`, `skillLinkRefused` and `skillUrlRefused` all
arrive this way.

## Why it matters

The house rule is that core throws a code and the renderer localises it; the
English text is a fallback for logs. Seven codes exist, seven localised messages
exist, and none of them can ever be reached.

It is a verbatim repeat of the `EnvProfileError` bug the codebase already
documents in `src/main/ipc.test.ts:1090-1096` and in the header of
`useErrorMessage.test.tsx` — the same omission, in the same list, one class
later.

The skill rows in `CODE_PARAMETERS` (`useErrorMessage.test.tsx`) assert a mapping
the system never exercises: a test passing for a state that cannot occur.

## Evidence

- `src/main/result.ts:39-61` — the eight recognised classes; `SkillError` absent.
- `src/renderer/src/hooks/useErrorMessage.ts` — the `case 'skill…'` arms that
  nothing can reach, and the `default:` that everything lands in.
- `src/main/ipc.test.ts:1090-1096` — the same omission recorded for
  `EnvProfileError` when it was found.

## What is already decided

A one-line fix, and independent of the skill-naming bug it was found beside.

The test that would have caught it has to go through `attempt`, not through
`useErrorMessage` alone — the renderer test asserts the mapping from a code that
never arrives, which is why it stayed green.
