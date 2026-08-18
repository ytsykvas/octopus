# An App test fails about once in five full runs

## What happens

`src/renderer/src/App.test.tsx` › "opens another conversation with ⌘T" failed
twice during one session's work and then passed nine runs in a row — three on
the committed tree with no changes at all, six with them. Run alone, or with
`-t` selecting it, it has never failed: five isolated runs, all green.

So it is the **full** renderer suite that produces it, which points at something
leaking between files rather than at the test.

**A second test now shows it, which makes this a shape rather than one test.**
On 2026-08-18, `src/renderer/src/components/chat/Chat.test.tsx` › "raises it
once that conversation is the one showing" failed the same way in one full run —
`findByText('The plan is ready')` timed out — then passed alone and through
three consecutive full suites. The two have the same build: an agent event
emitted outside `act`, a click, then a read of what the event was supposed to
produce. Whatever the cause, it is not specific to ⌘T, and either test will do
to reproduce it.

## Why it matters

`npm run check` is what every commit goes through, and a gate that goes red
without anyone's change being the cause is worse than a missing test: the next
session spends its time bisecting a diff that was never the problem. That is
exactly what it cost here — the failure arrived in the middle of unrelated work
and had to be ruled out before anything else could proceed.

The same argument as `a-test-calls-the-live-github-api.md`, from the other
direction: that one is red because the network is, this one for a reason nobody
has yet named.

## Where to start

The suite shares one jsdom per file but not across files, so the candidates are
the globals that outlive a render: timers left running, `document`-level
listeners (the diff pane now adds one for `selectionchange`), and
`Element.prototype` methods that tests assign rather than spy on —
`scrollIntoView` in `Composer.test.tsx` and `getBoundingClientRect` in several
diff tests are assigned, and an assignment has no `restoreMocks` to undo it.

`vitest --sequence.shuffle` repeated until it reproduces would name the pair of
files involved faster than reading them will.

One lead from the same session, worth trying first because it is cheap: a
selection test added to `DiffPanel.test.tsx` failed the same way and for a
timing reason, not a leaking one. It read the button with `getByRole` straight
after dispatching the event that creates it, and under a full suite's load the
state change landed a tick later than it does when the file runs alone.
`findByRole` fixed it outright. If ⌘T reads anything that appears from an
effect rather than from the click itself, it may be the same shape of mistake
wearing a different hat.

## What not to do

Do not add a retry. A test that passes on the second attempt is a test that has
stopped saying anything, and this one is about a keyboard shortcut that either
opens a conversation or does not.
