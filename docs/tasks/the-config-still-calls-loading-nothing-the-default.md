# The config still calls loading nothing the default

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

The doc comment on `SettingSourcesModeSchema` says:

> This is the key transparency switch (§4 docs/PROJECT.md): the default `none`
> means nothing reaches the agent's context that we did not put there
> deliberately.

That is false twice over. The default has not been `none` since config version 2
— `createDefaultConfig` writes `'all'`, and `migrateConfig` raises an existing
`none` to `all`. And §4 now reads "We add nothing of our own, and we withhold
only what we were told to… An agent that knows less here than there is a defect,
not a feature", with §12.3 blunter still: "octopus is a harness around Claude
Code, not a filter on it… it is why the old default made the agent worse than
the terminal."

The reversal commit `f8abe82` promised in its own message that "The docs and both
skills that argued the old way are rewritten, not left standing" — and its diff
rewrote the `version` comment and flipped the default while leaving this comment
above them untouched. A missed spot in an otherwise thorough commit, not an
unresolved design question.

## Why it matters

This is the one setting whose comment states the project's central principle, and
it states the version that was deliberately reversed. Anyone opening `config.ts`
to decide what `settingSources` should do — including a session that goes on to
touch `sourcesIn`, `sessionSkills` or the instruction-sources panel — is told the
app withholds by default, which is exactly the reasoning that produced the bug
version 2 exists to migrate away from.

The migration comment thirty lines below explains the reversal correctly, so the
file contradicts itself.

## Evidence

- `src/core/config.ts:47-53` — the false statement.
- `src/core/config.ts:290` — `createDefaultConfig` writes `settingSources: 'all'`;
  `:343-350` — the migration off `none`.
- `src/core/config.ts:97-102` and `:334-341` — the two comments in the same file
  that describe the reversal correctly.
- `docs/PROJECT.md:81` (§4) and `:518-520` (§12.3); `docs/data.md:52`;
  `src/renderer/src/i18n/locales/en.ts:853-861`;
  `src/core/instructionSources.ts:1-13` — everything else has already moved.
- `src/core/config.test.ts:35-43` and `:361-366` — the tests settle intent
  against the comment, not for it.

## What is already decided

**`config.ts:392-393` is a rewording, not a correction.** The
`toSdkSettingSources` comment is not factually wrong — an empty array genuinely
is what stops the SDK loading `CLAUDE.md`. What is stale is the framing ("behind
our back", implying that is the app's posture) and the §12.3 citation. The same
stale framing survives in the test name at `config.test.ts:314`.

**Do not touch `config.ts:163-174`**, the comment on `alwaysAllowedTools` saying
"`settingSources` may well be `none` — in which case the SDK has nowhere to write
them". That is a hypothetical about a mode still on offer, not a claim about the
default, and the fact that its reason has weakened is already filed as work in
`two-places-now-record-always-allow.md` and
`the-permission-card-cannot-say-why-it-is-asking.md`. Rewriting it here would
pre-empt a decision those files deliberately left open.

## Sketch

`docs/PROJECT.md:520` has the sentence almost ready: "The config keeps the switch
— nothing / `project` / `user + project + local` — for anyone who wants
isolation; it is simply no longer what everybody gets."

**A second place carries the same withdrawn premise**, and fixing `config.ts`
alone leaves it standing. `docs/core.md:358` argues that both `ultracode` and
`enableWorkflows` are always sent "because `settingSources` is empty, so nothing
else is loaded that could turn `ultracode` back off". Under the current default
that premise is gone — `service.ts:1835` passes `['user','project','local']`, so
a user or project settings file can now carry the flag. **The conclusion still
holds for a different reason**, given at `agent.ts:344` and `:357-360`:
`applyFlagSettings` replaces a top-level key outright rather than merging, so
silence would leave the previous answer standing. Reword the premise, do not
delete the rule.

The same stale premise appears at `agent.test.ts:739` and `:862`, though there it
is literally true — `fakeAgent` passes `settingSources: []`.
