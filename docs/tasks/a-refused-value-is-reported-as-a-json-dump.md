# A value the boundary refuses is reported as a JSON dump

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`attempt` maps only the eight core error classes onto `{ code, params }`. A
`ZodError` is not one of them, so it falls through to `describeError(error)`,
which is `error.message`.

Under zod 4.4.3 — verified by running it — a `ZodError`'s `message` is
`JSON.stringify(issues, null, 2)`: a multi-line array of `origin` / `code` /
`maximum` / `path` objects. The renderer has no `code` to switch on, so
`useErrorMessage` reaches its `default` and renders "Щось пішло не так: " with
the serialised issue array pasted into it.

## Why it matters

Most of the ~50 `.parse(` sites in `ipc.ts` refuse values the interface cannot
produce — `skills:read` with `../escape`, a path leaving the worktree, an unknown
colour. For those a JSON dump is ugly but nobody reaches it, and
`docs/ipc.md:212-215` says plainly they exist for a buggy or compromised
renderer, not for a person.

**The finding is the handful a person genuinely reaches by typing or pasting**,
because nothing in the renderer bounds any input: a chat message at 100,000
characters, a chat title at 60, an instruction body at 16,000, a repo-config
project body at 8,000, an env profile body. For those the refusal is a normal
outcome of ordinary use.

`chats.ts:580-586` is explicit that its bound exists because "anything past this
is a pasted file, which belongs in the workspace where the agent can read it
rather than in the conversation" — a statement about ordinary user behaviour. So
the `docs/ipc.md` justification does not cover it.

And `useChat.send` has already drawn the pasted file into the log optimistically,
while `Composer` only clears the field on success — so the failing turn shows the
user their own pasted file twice over plus the JSON block, and the JSON never
names the limit in a way a reader can act on.

## Evidence

- `src/main/result.ts:36-63` — `attempt`; the eight arms at `:41-48`, the
  uncoded fallthrough at `:61`.
- `src/core/persist.ts:35-37` — `describeError` passes the message straight
  through. `:72-77` — **the project's own precedent that a raw `ZodError` is not
  presentable**: `readJsonFile` flattens
  `result.error.issues.map((issue) => issue.message).join('; ')` first. The IPC
  boundary does no such flattening.
- `src/main/ipc.ts:601-603` — `chats:send`; `src/core/chats.ts:587` and `:595` —
  the two reachable chat caps.
- `grep -rn "maxLength" src/renderer/src` — no hits. No input or textarea in the
  app is bounded.
- `grep -rn "ZodError|prettifyError|treeifyError|flattenError" src .claude` — no
  matches; nothing anywhere maps a zod failure onto a code.
- `src/main/result.test.ts` covers four of the eight classes, a plain `Error`, a
  rejection and a bare thrown string — never a `ZodError`, so nothing fixes this
  as intended.
- `src/main/ipc.test.ts:1727-1737` asserts only `{ ok: false }`; contrast
  `:1701-1703`, whose comment states the project's rule that a refusal it knows
  how to explain must carry a code.

## What is already decided

**A single blanket code is the wrong fix.** `invalidArgument` would give the same
sentence to a chat message over 100,000 characters and to a `skills:read` with
`../escape`, and the second should stay a developer-facing string.

The useful information — which limit was exceeded — lives in `error.issues[0]`,
and with `noUncheckedIndexedAccess` that indexed read is `ZodIssue | undefined`,
so it has to be destructured or iterated, not reached for with `!`.

Importing `ZodError` in `src/main/result.ts` is allowed: it is main-process code,
and `ipc.ts` already imports `z` directly.

**A second class is missing from the same list.** `InvalidFileError`
(`src/core/persist.ts:18-26`) is not among the eight either — `grep -rn
InvalidFileError src/main/` returns nothing — so a corrupt `~/.octopus/state.json`
or config also crosses with no code. Its message is at least a sentence, because
`persist.ts:72-77` flattens by hand, but it is the same missing arm. Add it in the
same change. See also `no-skill-error-code-reaches-the-window.md`, which is the
third instance of this list being short.

## Sketch

The alternative fix is arguably better and is what the codebase already does
elsewhere: **bound the input where the user is**, not only at the boundary. A
`maxLength` on the composer textarea and on the rename field turns the failure
into "you cannot type more", and the boundary parse goes back to being the
unreachable defence `docs/ipc.md` says it is.

That does not remove the need for the `attempt` arm — the boundary must still
answer sanely — but it changes which one the user ever meets.

The fix touches `en.ts` and `uk.ts` together; TypeScript fails the build until
`uk.ts` carries the matching key.
