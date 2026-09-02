# The window's error banner never goes away

**Found:** 2026-09-02, in a review of the whole repository.

## What happens

`App` holds one `error` string and hands `setError` to four hooks and
`RightPanel`, and writes it directly twice — seven sites, none of them clearing.

Nothing ever writes `null` back. `setError(null)` appears nowhere in the file,
there is no clearing effect, no `key` that would remount `App`, and the banner is
a bare `<div>` with no dismiss control. Neither switching workspace nor switching
project nor a later success clears it.

**This is not an omitted call — it is a typed impossibility.** `onError` is
`(message: string) => void` in all five consumers, so `null` is not assignable
and no hook or pane is _able_ to clear the banner. The contract has to be widened
or a separate clear added.

The banner renders inside `<main>` above every branch, so it survives a project
switch, a workspace switch, and even the removal of the project it referred to.

## Why it matters

One transient failure — a config write that lost a race, a `gh` that was not
signed in yet, a rename git refused — pins a red sentence to the top of the
centre pane for the rest of the session, above conversations in projects it has
nothing to do with.

Because the next failure only replaces the text, there is no way to tell a fresh
error from the one that has been sitting there for an hour, which is the state in
which people stop reading the banner at all.

The only in-app way to clear it is View → Reload, **and that is expensive**:
`src/main/index.ts:47-52` disposes every terminal belonging to that WebContents
on `did-start-loading`, so clearing a stale sentence costs every running dev
server and shell in the window.

It also takes vertical space (`m-6 mb-0`), so it permanently shortens the centre
pane — `docs/ui.md:153` records that the log, composer and banner share the 72rem
cap, meaning the banner is a designed part of that column whose lifecycle was
simply never specified.

## Evidence

- `src/renderer/src/App.tsx:89` — the state; a case-insensitive grep for `error`
  across the 960-line file returns only lines 34, 79, 89, 104, 105, 109, 148,
  235, 477, 690, 692, 793.
- `src/renderer/src/App.tsx:690-694` — the banner, with no control of any kind.
- `useProjects.ts:31`, `useWorkspaces.ts:58`, `useFileRevert.ts:35`,
  `useChatTabs.ts:148`, `RightPanel.tsx:176` — the `(message: string) => void`
  contract.
- `src/renderer/src/App.tsx:625-632` — `onSelect` sets the selection, clears
  the workspace and opens the sidebar; none of the three clears the error.
- `App.test.tsx:645` and `:824` assert the banner appears. No test asserts it can
  leave, and none asserts it should persist — so this is not documented intent.
  `docs/ui.md` mentions it twice and never says it is meant to be permanent.

## What is already decided

**The codebase already contains the pattern that fixes this, one layer down.**
`usePullRequest.ts:128` and `:152` call `setActionError(null)` at the start of
each attempt, and `NewPullRequestForm.tsx:175` renders that error locally. The
window-level banner is the outlier, which is evidence of oversight rather than
design.

Matching that convention — widen `onError` to `(message: string | null) => void`
and call it with `null` on entry — is a smaller change than adding a dismiss
button, and fixes the "cannot tell a fresh error from an hour-old one" half at
the same time.

## Sketch

Two constraints on the obvious fix:

1. **A close button needs a new key in `en.ts` and `uk.ts`** — uk is typed against
   en, so a missing key is a compile error — plus a test, since coverage is
   100%-enforced and `App.test.tsx` currently only asserts the banner's arrival.
   Do not reuse `close: 'Close'` at `en.ts:251` or `:443`; both are section-scoped
   to the modal header and the PR pane.
2. **Clearing on workspace/project switch alone is not sufficient.** The two
   direct writers — `updateConfig` at `:235` and `finishRequest` at `:477` — are
   not tied to a workspace at all, so a config failure raised with no workspace
   selected would still stick until the next selection change.
