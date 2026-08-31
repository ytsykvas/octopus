# Three modules spell the same path rule

**Found:** 2026-08-31, adding the per-file Revert to the Changes pane.

## What happens

The same sentence — a path must be relative, and must not climb out of the
worktree with `..` — is written three times, in three modules, in three
slightly different shapes:

| Where                            | Shape                                            | On failure                                     |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `carry.ts:73` (`carriedPaths`)   | a `.filter` over the parsed list                 | the line is dropped, silently and deliberately |
| `store.ts:327` (`updateProject`) | an `if` on the env file                          | throws `StateConflictError`                    |
| `revert.ts` (`insideWorktree`)   | an exported predicate, plus a zod schema over it | throws, and refuses at the IPC boundary        |

Each is correct today. Nothing keeps them in step.

## Why it matters

The rule is a security boundary in all three: every one of these values reaches
either a process argument or a filesystem call. A fourth caller will copy
whichever of the three it happens to find, and a fix to one — a Windows drive
letter, a UNC path, a normalisation case `normalize` treats differently — lands
in one of three places with nothing pointing at the other two.

It is the third copy that makes this worth a note. Two were a coincidence.

## Evidence

- `src/core/carry.ts:73` — `carriedPaths`, `isAbsolute` + `normalize().startsWith('..')`
- `src/core/store.ts:327` — the same two calls, inline
- `src/core/revert.ts` — `insideWorktree`, and `RevertPathSchema` built on it

## What is already decided

The three **behaviours** on failure are not a mistake and should not be
unified: a carry list is typed by hand and one bad line should not stop a
workspace being prepared, while a path about to be handed to `git rm` should
stop everything. What is shared is the predicate, not the reaction to it.

## Sketch

One exported predicate — `insideWorktree` is already the name and already
tested — imported by the other two. It has no dependencies, so it can live
wherever it is least surprising; `git.ts` is the closest thing to a home for
"facts about a worktree-relative path", and neither `carry.ts` nor `store.ts`
imports it today, which is worth checking before assuming that is free.
