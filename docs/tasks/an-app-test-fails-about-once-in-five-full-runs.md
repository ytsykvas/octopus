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
three consecutive full suites. The two do not have the same build, though it
read that way for a while: the ⌘T test (`App.test.tsx:1584`) emits no agent
event at all — clicks, a `keyDown` on `window`, then a `waitFor` on a mock
call — and the events the chat tests do emit are wrapped in `act`
(`src/renderer/src/test/chat.ts:116`). What they share is thinner than that: an
assertion reading something an effect has to land first. Whatever the cause, it
is not specific to ⌘T, and either test will do to reproduce it.

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

**It happens on GitHub's machines too.** On 2026-08-28 the `check` workflow
failed on a pull request that touched only the pull request pane —
`Chat.test.tsx` › "goes on drawing what a background conversation says", the
same shape as the two above. It passed on a re-run of the same commit, and the
file passed alone locally, fourteen for fourteen.

Two things follow. The runner is a clean machine with nothing else on it, so
"the developer's laptop was busy" is not the whole story. And `main` is
unprotected while the repository is private, so a red `check` blocks no merge
today — it costs a re-run and the minutes somebody spends believing their own
change was at fault.

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
  `useWorkspaces` tests that deliberately wait 400 ms (`useWorkspaces.test.tsx:55`).

So the named tests have four to five times the time they need, and closing that
gap would take a machine five times slower at exactly that moment. Raising the
ceilings would not have fixed anything, and would have been the paper over the
crack this note warns against. Recorded so nobody spends the afternoon on it
again.

**And the reason no message ever explained it is now fixed.** `emitAgentEvent`
and `emitChatStatus` (`src/renderer/src/test/chat.ts`) read their handlers from
the stub's `mock.calls` and looped over them. When nothing had subscribed the
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
that is only a cursor'` (`DiffPanel.test.tsx:636`) and `'offers nothing when
the browser reports no selection'` (`DiffPanel.test.tsx:756`) had the same
shape and have since been given the same guard.

**The suite was then swept for the whole class.** Of 485 absence assertions, 228
follow an interaction; the great majority are prop-wired, where a render that
never happened throws at `getByRole` before the assertion is reached, so they
cannot hide anything. Nine reached a listener registered by an effect. Two more
of those are now proven live before they assert — `useDismiss.test.tsx` dismisses
from outside first, `DropdownMenu.test.tsx` closes the menu first — and
`App.test.tsx:1638` fires ⌥2 and waits for the conversation to change before
pressing ⌘T.

**The class is closed rather than the instances, where that was possible.**
`refuseSilence` (`src/renderer/src/test/chat.ts`) is now exported, and the five
test files that rolled their own emit helper call it: `useWorkspaceDiff`,
`useSessionUsage`, `useModels`, `useCommands` and `useWorkspaces`. All of them
delivered through `subscriber?.(…)` or a loop over an empty array, which is
silent for exactly the reason the helpers in `chat.ts` were. Two of the nine
candidates were only at risk because of those helpers and needed no other change.

**Three are knowingly left vacuous**, because proving the listener would mean
contriving the setup rather than testing anything: `App.test.tsx:613` and
`:1972` have no project selected, so no shortcut does anything observable to
assert on, and `:1708` has one conversation, so the ⌥ trick has nowhere to move
to. They are lower risk than the rest — `App.tsx:392`'s dependency array
re-registers the listener on almost every render, and two positive siblings in
the same `describe` exercise it — but they would not notice a dead listener, and
that is worth knowing rather than assuming otherwise.

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
listeners, and prototype methods that tests assign rather than spy on. The diff
pane's `selectionchange` listener is not one of them — `DiffPanel.tsx:150` adds
it and `:154` removes it in the same effect's cleanup. The two assignments are
`Element.prototype.scrollIntoView` (`Composer.test.tsx:136`) and
`Range.prototype.getBoundingClientRect` (`DiffPanel.test.tsx:573`), and an
assignment has no `restoreMocks` to undo it; the other two diff tests that touch
`getBoundingClientRect` (`DiffPanel.test.tsx:360` and `:1220`) use `vi.spyOn`,
which the `vi.restoreAllMocks()` in `setup.ts:33` does undo.

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

**Eighteen clean runs in one session, which the title's rate does not survive.**
On 2026-09-02 and 2026-09-03 a single session ran `npm run check` to completion —
both suites, coverage and all — **at least eighteen times, every one green**.
A floor rather than an exact count: the logs were written to the same handful of
paths and overwritten, so the true number is higher. Under one-in-five, eighteen
consecutive passes is about a 1.4% outcome.

Nothing was done to fix this, so do not read that as fixed. What it does mean is
that **the title is now the least reliable line in this file**, and a rate is
what decides how long somebody sits waiting for a reproduction. Either the rate
was always lower than three sightings in a busy week suggested, or something
between 2026-08-31 and now changed it — the `pullRequests.test.ts` spawn count
went from eight to five in that window, which is the only measured change to the
suite's timing.

The session also ran with the dev app up throughout, which is the condition the
sightings above kept blaming.

**A sighting with the message, at last, and it is not a timeout.** On
2026-09-05 a `npm run check` failed `pullRequests.test.ts` ›
`'refuses an answer that is not JSON'` with:

    Error: ENOTEMPTY: directory not empty, rmdir
      '/var/folders/…/T/octopus-pr-zANjA9/work/.git'

The next identical run was green, 2198 for 2198. The change in flight was
renderer-only and could not reach this file.

That is a **teardown race**, not a deadline: `rm` of the temp checkout ran while
something was still writing inside `.git`. It fits everything recorded above
better than the timing theory the measurements ruled out — it explains why the
slowest file by spawn count is the repeat victim, why two files can fail in one
run on a busy machine and neither alone, why a clean CI runner sees it too, and
why the assertion messages never explained anything: the failure is in `afterEach`,
not in the test.

What it does **not** explain is the renderer sightings, where no temp directory
is removed. So this is either a second flake wearing the same clothes, or the
shared cause is one level up — a process this suite spawns outliving the test
that spawned it.

Where to look first, now that there is something specific: every `git` this file
runs goes through `execFile`, and a rejected one is not awaited anywhere the
`finally` can see. A spawn whose promise is dropped keeps the child alive past
the `rm`.

## A third file, and a cause that was ours

**2026-09-06.** `service.test.ts` failed twice in one run, both times in
`afterEach`:

    Error: ENOTEMPTY: directory not empty, rmdir
      '/var/folders/…/T/octopus-service-CNgRaz'

Both were tests written minutes earlier, and both did the same thing: raise a
permission request with `agent().ask(...)` and never answer it. An open request
is a turn held open — `canUseTool` blocks on a promise — so the transcript write
behind it was still going when the directory was removed.

Answering the request at the end of each made both stop failing. That is the
first sighting with a cause anybody could point at, and it is the same shape as
the `pullRequests.test.ts` one: **work still running when `rm` starts**, not a
deadline.

**And again, the same week.** A test written for the standing-permission work
raised a request and never answered it, and `service.test.ts` failed in
`afterEach` exactly as before. Twice is a pattern rather than a slip: **a test
that raises a permission request answers it**, unless leaving it open is the
thing being tested. The cost of forgetting is not a failure in that test — it is
a failure in whichever test the runner tore down next.

It does not close the note. The `⌘T` sighting has no unanswered request in it,
and the renderer ones have no directory. But it does say what to look for in
those: something the test starts and nothing waits for.

## The `ENOTEMPTY` half is closed, structurally

**2026-09-07.** The cause above was fixed as a class rather than a test at a
time, and the fix is in the service rather than in the suite.

`closeChats` — the one path that ends every session, called when the application
quits — did two things less than `closeOneChat`:

- it **left the open questions unanswered**. `canUseTool` blocks on the promise
  a question holds, so a session closed with one open leaves the turn behind it
  running, and whatever that turn was writing goes on writing.
- it **did not wait for anything the sessions had started**. Writes go out from
  event handlers through `background`, which was fire-and-forget. `background`
  now keeps what it starts, and `closeChats` waits for it — a loop, since
  finishing one piece of work starts another.

Both suites that build a service now wrap `createService` under its own name,
keep what it made, and close it all in `afterEach` before the temporary
directory goes: `service.test.ts` and `ipc.test.ts`. So a test can no longer
leave work running for the next one to be blamed for, whether or not whoever
wrote it remembered.

That removes the whole mechanism behind every `ENOTEMPTY` sighting in this
file — the unanswered permission requests of 2026-09-06, and the
`pullRequests.test.ts` one of 2026-09-05 in so far as it shares the shape.

**What was left after that was the renderer half and this file**, and this file
is now accounted for below. The renderer sightings — `⌘T` in `App.test.tsx` and
the two in `Chat.test.tsx` — have no temporary directory, and the guard added on
2026-09-02, `refuseSilence`, is still the thing that will name them.

**2026-09-08: it appeared, and the message was thrown away again.** One renderer
suite reported `1 failed | 2182 passed` inside a `npm run check`; the run's
output was read through a `grep` that kept only the count, so which test failed
is unknown. The same file passed immediately after, twice, and the next full
`check` was green.

That is the third sighting lost the same way, and the instruction two paragraphs
up said exactly not to do it. **Write the run to a file and read the file** —
`npm run check > check.log 2>&1` — because a filter on the pipe is how every one
of these has escaped.

## The `pullRequests.test.ts` half is closed, with the message that named it

**2026-09-08, one run later**, doing exactly that:

    FAIL  src/core/pullRequests.test.ts > reading a branch > refuses an answer that is not JSON
    Error: ENOTEMPTY: directory not empty, rmdir '…/octopus-pr-tuqi5Y/work/.git'

The lead in the section above was right, and the mechanism is exact.
`readPullRequest` makes four reads at once: one `gh` and **three `git`**. The
tests this note has named as victims every time — `refuses an answer that is not
JSON`, `refuses an answer shaped like something else`, `says GitHub could not be
asked rather than inventing an answer` — are precisely the ones where the `gh`
half **rejects**. `Promise.all` rejects the moment it does, the assertion passes,
the test ends, and three `git` processes are still making files inside `.git`
while `afterEach` removes it.

That explains every recorded oddity at once: why this file is the repeat victim
(it spawns the most), why the failure lands in whichever test is torn down next
rather than in the one that caused it, why a busy machine makes it likelier, and
why a clean CI runner sees it too.

`parallel.ts` carries the fix — `allOf`, which waits for all of them and then
reports the first failure in the order written — and the four places that run a
child process beside a fallible read use it: `pullRequests.ts`, `accounts.ts`
twice, `diff.ts` and `workspaces.ts`. `pullRequests.test.ts` has a test that
fails under `Promise.all` and passes under `allOf`.

**What is left is the renderer half only**, which has no temporary directory,
no service and no spawn. Nothing recorded here explains it.

**And one thing this exposed rather than fixed**, recorded separately in
`a-quit-does-not-wait-for-the-record-it-is-writing.md`: `main` calls
`closeChats` as `void service.closeChats()` on `will-quit`, so the waiting the
service now does reaches the tests and not the application.

## What not to do

Do not add a retry. A test that passes on the second attempt is a test that has
stopped saying anything, and this one is about a keyboard shortcut that either
opens a conversation or does not.
