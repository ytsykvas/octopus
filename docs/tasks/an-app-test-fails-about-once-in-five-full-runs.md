# An App test fails about once in five full runs

## What happens

`src/renderer/src/App.test.tsx` › "opens another conversation with ⌘T" failed
twice during one session's work and then passed nine runs in a row — three on
the committed tree with no changes at all, six with them. Run alone, or with
`-t` selecting it, it has never failed: five isolated runs, all green.

So it was thought to be the **full** renderer suite that produces it, which
pointed at something leaking between files rather than at the test.

**That is now wrong, and it is the most useful thing known about this.** On
2026-08-18 the ⌘T test failed on a run of `App.test.tsx` **alone** — one file,
no other suite around it — and then passed four consecutive runs of that same
file. Nothing leaking between files can explain that. Whatever this is lives
inside the one file, or in the machine's load at the moment it runs, so the
hunt for a global left behind by another test can stop.

**A second test now shows it, which makes this a shape rather than one test.**
On 2026-08-18, `src/renderer/src/components/chat/Chat.test.tsx` › "raises it
once that conversation is the one showing" failed the same way in one full run —
`findByText('The plan is ready')` timed out — then passed alone and through
three consecutive full suites. The two have the same build: an agent event
emitted outside `act`, a click, then a read of what the event was supposed to
produce. Whatever the cause, it is not specific to ⌘T, and either test will do
to reproduce it.

**They can fail together, which the "something inside the one file" reading does
not explain.** On 2026-08-27 a single `npm run check` failed both at once — ⌘T
in `App.test.tsx` and the plan in `Chat.test.tsx` — and each passed alone
immediately after, with the next full run green. Two files failing in the same
run and neither failing on its own points at the state of the machine at that
moment rather than at anything either file does. That makes the timing lead
below the one worth trying first, and `--sequence.shuffle` the weaker bet.

**And it is not the renderer's problem.** On 2026-08-28 the failure landed in
the **core** suite instead — `service.test.ts` › "falls back to the real gh when
no executor is supplied" — during a run made while the dev app and a second node
process were both busy. It passed alone, and the next full run was green. Core
tests share no jsdom, no `document`, and no `Element.prototype`, so every
candidate under "Where to start" below is ruled out for that one; whatever this
is reaches both suites.

**Two core tests failed together on 2026-08-31**, in one `npm run check` —
`pullRequests.test.ts` › "says GitHub could not be asked rather than inventing an
answer" and › "refuses an answer shaped like something else". The file passed
alone immediately after (54 tests, 8.9s) and the next full run was green, 1847
for 1847. Same shape, core suite again, and again on a machine that was busy —
the dev app was running and a full renderer suite had just finished.

Worth one number: that file takes **8.9 seconds for 54 tests on its own**, which
is an order of magnitude more per test than the rest of the core suite. If the
cause is a deadline being missed under load, the slowest file is where it would
show first, and this is the slowest file. Reading what those 8.9 seconds are
spent on is cheap and has not been done.

The assertion messages were not captured here either — the run's output was
read through a filter that kept only the `FAIL` lines. Same mistake as below;
next time, keep the message.

Recorded with a caveat, because it is worth less than it looks: the run's output
was read from a tail and **the assertion message was not captured**. What the
`gh` test could plausibly fail on is not obvious either — it writes a fake `gh`
to a temp directory, puts it on `PATH` and restores it in a `finally`, and
`defaultExec` allows 15 seconds, which a shell script running `cat` will not
reach however loaded the machine is. Next time it appears, keep the message.

**It happens on GitHub's machines too, and it now blocks merging.** On
2026-08-28 the `check` workflow failed on a pull request that touched only the
pull request pane — `Chat.test.tsx` › "goes on drawing what a background
conversation says", the same shape as the two above. It passed on a re-run of
the same commit, and the file passed alone locally, fourteen for fourteen.

Two things follow. The runner is a clean machine with nothing else on it, so
"the developer's laptop was busy" is not the whole story. And since `main`
became protected, a green `check` is a merge requirement — so a one-in-five
flake is now a one-in-five pull request that cannot land without somebody
noticing it is not their fault and pressing re-run.

**The obvious explanation is now ruled out, with numbers.** On 2026-09-02 the
deadline theory — that a test misses its timeout under load — was tested and
does not hold. Nothing in this repository sets `testTimeout` (Vitest's default
is 5 000 ms) or `asyncUtilTimeout` (`@testing-library/dom`'s default is
1 000 ms), so both suites do run on ceilings nobody chose. But the headroom
under those ceilings is large:

- Core, with the whole renderer suite running beside it for contention: the
  slowest test of 2 099 was **1 167 ms**, and none passed half the deadline.
- Core again at `--maxWorkers=32` on ten cores, a 3.2× oversubscription: the
  slowest was **937 ms**. All 2 099 passed.
- Core at `testTimeout: 1500` — a third of the real ceiling — passed in full,
  both alone and as the whole suite.
- Renderer at `asyncUtilTimeout: 200`, a fifth of the real ceiling: ⌘T and both
  `Chat.test.tsx` victims **passed**. The only four failures were the
  `useWorkspaces` tests that deliberately wait 400 ms (`useWorkspaces.test.tsx:54`).

So the named tests have four to five times the time they need, and closing that
gap would take a machine five times slower at exactly that moment. Raising the
ceilings would not have fixed anything, and would have been the paper over the
crack this note warns against. Recorded so nobody spends the afternoon on it
again.

**And the reason no message ever explained it is now fixed.** `emitAgentEvent`
and `emitChatStatus` (`src/renderer/src/test/chat.ts`) read their handlers from
`onEvent`'s `mock.calls` and looped over them. When nothing had subscribed the
loop did nothing **silently**, and the test then failed at its own assertion
with "element never appeared" — a message about the symptom that could never
name the cause. Both now throw when the handler list is empty. The next
occurrence will say whether the event went nowhere, and that distinguishes a
missing subscription from a slow render, which is the fork in the road this note
has never been able to take.

The subscription is worth suspecting on its own: `chatEvents.ts:31` holds
`release` as module state and `:60` takes it only once per module lifetime
(`release ??= window.octopus.chats.onEvent(deliver)`), while `setup.ts:28`
installs a fresh bridge stub every `beforeEach`. A listener that fails to
unsubscribe leaves `release` non-null, and the next test's emit then finds no
handlers at all.

**It can turn the gate red without failing a single test, and that happened on
2026-09-02.** A `npm run check` reported `1864 passed` and then failed on
coverage: `DiffPanel.tsx:430` — the `if (anchor === null) return null` arm of
`passageIn` — was not reached. The very next identical run covered it. Nothing
had changed between them.

The mechanism is exact, and it is the one this note has been looking for.
`DiffPanel.tsx:142-157` registers the `selectionchange` listener from an effect
keyed on `[diff]`. `selectAcross` in the test dispatches that event
synchronously. Until the effect has run there is no listener, so `passageIn` is
never called at all — and the test that owns that branch,
`'offers nothing for a selection that touched no code'`, **asserts an absence**.
An absence holds just as well when nothing happened, so the test passed either
way and only the coverage counter could tell the difference.

That is the shape to hunt elsewhere: an event dispatched at a listener that an
effect may not have attached yet, read by an assertion that cannot tell the
difference. The positive half of the same file was already fixed this way once —
see the comment at `DiffPanel.test.tsx:615-618`, which describes the identical
race for the case where the button _does_ appear. The negative half could not be
fixed by awaiting, because there is nothing to await for; it now selects real
code first and waits for the button, so the listener is proven live before the
absence is asserted.

Two things follow. A run can be red with every test green, so "which test
failed" is the wrong first question. And an absence assertion anywhere in this
suite is a candidate, not merely this one — `'offers nothing for a selection
that is only a cursor'` (`DiffPanel.test.tsx:636`) has the same shape and has
not been touched.

## Why it matters

`npm run check` is what every commit goes through, and a gate that goes red
without anyone's change being the cause is worse than a missing test: the next
session spends its time bisecting a diff that was never the problem. That is
exactly what it cost here — the failure arrived in the middle of unrelated work
and had to be ruled out before anything else could proceed.

The same argument as the test that used to call the live GitHub API, from the
other direction: that one was red because the network was, and it was fixed by
putting a fake `gh` on `PATH` — see the comment on `falls back to the real gh
when no executor is supplied` in `service.test.ts`. This one is red for a reason
nobody has yet named.

## Where to start

The suite shares one jsdom per file but not across files, so the candidates are
the globals that outlive a render: timers left running, `document`-level
listeners (the diff pane now adds one for `selectionchange`), and
`Element.prototype` methods that tests assign rather than spy on —
`scrollIntoView` in `Composer.test.tsx` and `getBoundingClientRect` in several
diff tests are assigned, and an assignment has no `restoreMocks` to undo it.

`vitest --sequence.shuffle` repeated until it reproduces would name the pair of
files involved faster than reading them will.

**The cheapest next move is now to wait for it.** The guard added on 2026-09-02
means the next occurrence in a renderer file either names a missing
subscription or does not, and either answer halves the search. Until then,
keep the run's whole output rather than a tail — that mistake has now cost
three separate sightings.

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
