# State

Hooks own everything that talks to IPC — `useProjects`, `useWorkspaces`,
`useChat`, `useRateLimit`, `usePlugins`, `useBoard` and the rest. A component that lays out a window should not also
know what an IPC failure looks like.

Which screen is in front — Octopus or the Board — is App state that is not
saved, like the workspace list's fold. A card's unsaved description is App state too
(`boardDrafts`), keyed by project and card and handed up when the editor goes, like the
composer's drafts.

Two small hooks hold the clocks. `useVisibleInterval(tick, ms, active)` is
"now, and every so often, while somebody can see it" — the account's limits and
the status bar's resource reading both run on it.

**Nothing the window starts on its own runs while it is hidden.** Agents are
left to work exactly when nobody is looking, and every turn end used to cost the
open tab its whole read — a dozen git processes for the diff — and every poll a
`gh` call, for panes nobody could see. `setVisibleTimeout(run, ms)`
(`hooks/visibleTimeout.ts`) is `setTimeout` with that rule: one that falls due
while the window is hidden waits, and runs once when it is shown. The settle
after a turn and both pull request polls are set with it, and
`useTurnSettled(workspaceId, enabled, onSettled)` is the one subscription to a
workspace's turn ends that the diff, the pull request detail and the Files tab
share. The workspace list holds its own re-reads the same way, per workspace
(`useWorkspaces`). `useNow()` is the
second-by-second time for a running count, held by the component that shows the
count so the tick redraws that line only: the working line and the status bar's
turn timer. That component is mounted only while there is a count to show, so
nothing ticks between turns — and the clock, read when it mounts, starts from
the right time rather than from a stale zero when the front switches to a
conversation already at its turn.

`useRateLimit` is separate from `useChat` because the figure belongs to the
account rather than to a conversation: every workspace reports the same one, and
switching between them must not blank it out.

`useChat` reads the history from disk when the pane opens, after a rewind and
after a send that failed, and otherwise only appends what arrives as events.
A read takes time, and events keep arriving meanwhile: some are in the file it
brings back, some are not. Every event carries `seq` and the history answers
with the `seq` of the last event it can hold (`chats:history` in
[ipc](../ipc.md)), so while a read is out `useChat` holds the events that would
change the log, and when it lands `mergeHistory` draws those numbered past the
history's `seq` on top, so nothing the transcript keeps is lost or drawn twice.
A line it never keeps — a background failure — can go with the read, as it
would with a restart. A read that fails draws what was held onto the log as it
was. A newer read drops an older one, and starts its buffer empty: everything
heard before it was asked for is numbered at or below its `seq`. A read the pane
abandons — its conversation switched away or gone — lets its buffer go at once,
so what the next conversation says is drawn as it arrives.

The split is not all-or-nothing: `useProjects.remove` asks and deletes, while
`App` clears the selection afterwards — the project if it was the open one, the
workspace only if it was one of the project's, so removing another project leaves
the open conversation and its draft alone. What points at a project is the
window's business. So is what the window holds per workspace — drafts, review notes,
quotes from a pull request, notes from the viewer, attached files, open files
and the conversation strip — and workspace ids come back: a removed workspace's
name returns to the pool, and a project added again gets its old slug. There is
one window, so an id comes back only through a creation — `createWorkspace` or a
card's Run — and both open it through `showFresh`, which is where `App` calls
`forgetWorkspaces` for it — the call that guarantees a clean start. `forgetWorkspaces` hands a `WorkspaceMatch` to each store's `forget`
(`hooks/workspaceSlots.ts`). It also runs when `useWorkspaces.remove` or
`useProjects.remove` answers `true`, so nothing is held for an id that is gone;
that call cannot be the guarantee, because removing the open workspace unmounts
its composer only afterwards, and the composer files its draft on the way out. A
new store keyed by workspace returns `ForgetsWorkspaces` and gets a line in
`forgetWorkspaces`.

**A reply is claimed before its await, never after.** A hook that reads for the
workspace on screen has to drop what comes back for one that has been left, and
`useWorkspaceDiff` guards it with a counter bumped per read. Where the number is
taken decides whether it works. Taken **before** the call, a workspace opened in
the meantime bumps the counter and the late reply is dropped. Taken **after**,
the late reply bumps it past the number the new workspace's own read had just
claimed, and wins — which is how the pull request pane came to draw one
workspace's branch over another's request number, with Merge sending exactly
that pair. `usePullRequest` reads in a single effect, so its abort is the guard.

An _action_ is not a read, and is dropped only when the workspace on screen is
no longer the one it was made for — compared through `useLatest`, never through
a read counter. Opening a pull request pushes first, the push moves the branch,
and that reads the pane again while `gh pr create` is still running; a counter
bumped by that read dropped the request just opened and left the pane on the
form saying "Opening…".

The same applies to whatever a pane is _doing_, not only to what it reads: the
render-time reset that clears the view clears `creating`, `drafting` and the
action's error with it, or a refusal about the branch just left is shown against
the one arrived at.

An action already on its way is not reset, because it is still running, so it
is held per workspace instead. `usePendingIn` keeps a set of
workspace-and-action pairs. `PullRequestPanel` holds its actions in it, and
`App` the header's Merge and Close. A merge in one workspace disables nothing in
the next, and coming back finds `Merging…` still drawn. Each pair goes when its
own call answers, so the set needs no `forget`. What runs after the answer asks
`useShownWorkspace` what is on screen by then. A refusal for a workspace that
was left reaches the banner named for it (`errors.inWorkspace`). The pane does
not read again (`readAgain`), because `refresh` reads whichever workspace is
showing, and coming back reads anyway. The project's list of requests is read
either way: it marks every branch, not the one on screen.

The counter also settles two reads of one thing that overlap, where the one that
answers last is not the one asked last. There a reply is dropped only where a
newer one has been drawn: dropped for a newer read that then fails, it would
leave nothing drawn at all. `useWorkspaces` numbers every listing — a change of
projects, each `refresh`, and the project read when a turn ends in a workspace
that has gone — and keeps, per project, the number whose answer is drawn, so an older listing still fills in a
project a newer one failed to read; the projects it draws are the window's, not
the listing's, so a `refresh` that read them before a removal cannot bring the
removed one back. A listing that fails for a project keeps the workspaces it had
and reports why, since emptying it unmounted the open conversation; a project
with none, or never listed, stays empty and silent. `useChatTabs.load` numbers
every read of the strip, so a read started before `create` cannot take the new
tab away. In both, only the newest read reports a failure.

**A hook that listens to chat events says whose it is listening for.** Events are
broadcast to every window and cover every conversation, so a subscription that
takes them all takes another project's too. There are three honest shapes and no
fourth: name the chat, and `onChatEvent` delivers only that one's — what the
conversation, its usage and its commands do; filter on `workspaceId` inside the
handler, for anything about the worktree rather than the talking, since any chat
there writes to the same files — what the diff pane and the checks list do; or
take everything deliberately, for what belongs to the account rather than to any
conversation, like the rate limit and the model catalogue. Taking everything by
omission is the one that reads the same and is a bug: the composer offered
another project's slash commands that way for a release.

**A list only a running session can answer is re-read when the session starts.**
A session starts on the first message, after the read the pane opened with, so
until something reads again the list describes a conversation with no agent
behind it. `useSessionStarted(chatId, onStart)` is that moment, subscribed for
the one chat: the commands and the skills both use it. Before it, the skills
count stayed at what the disk holds and jumped the first time the panel was
opened — the read on open was the only one that found a session to ask.

**The error banner clears itself, twice over.** Every hook that reports a
failure to the window takes `(message: string | null) => void` and sends `null`
as an attempt begins, so what the banner shows is always the latest attempt's;
and `App` clears it during render when the selection moves, so a failure about
one project does not follow the reader into another. Except when the move is a
creation's own: opening the new workspace counts as already shown, or the one
line a creation can leave — that its branch went round one named after its kind
— was wiped as it was written. One transient failure used
to pin a red sentence to the top of the centre pane for the rest of the session
— seven writers and nothing that ever wrote `null`. Not a dismiss control: a
banner here clears on the next thing that happens, which is where the reader's
attention is anyway.

**An operation that waits is guarded in the hook, not on the button.** Creating
a workspace fetches its base branch first, so it is no longer over before a
second press is possible — and the three places that offer it (the sidebar's
`+`, the centre's empty state, ⌘⇧N) would otherwise each need their own guard,
with the shortcut having nothing to hang one on. `useWorkspaces.create` holds
the latch in a ref rather than in state, because state is what a second press in
the same tick would not have seen yet, and exposes `creating` for the buttons to
show. Two presses do worse than make two workspaces: both read the same list of
taken names, so the second is refused over a path the first has claimed.
A card's Run is guarded the same way, by a ref in `App` (`launching`): the panel
closed and opened again offers the button afresh, and a second press must not
start a second run.

A button that stops responding also has to say why. The `+` swaps its plus for a
turning mark while it waits — a still, dimmed icon reads as the app having hung
rather than as it working.

**A new workspace opens on its empty conversation.** All three places go
through `App.createWorkspace`, which selects what `useWorkspaces.create` answers
with and gives that conversation's composer the caret. It used to land in the
list unselected, with its name open for editing — but what somebody knows at
that moment is the task, not a name for it; the name stays a double-click away.
The caret is taken once: `App` forgets the workspace was new as soon as the
selection leaves it, so coming back later does not pull the caret out of
wherever it was.

A workspace a board card's **Run** made opens the same way, through the same
`showFresh(projectId, workspaceId, draft)`, with the card's text already in that
field. One already started from the card is opened as it is, nothing of it
forgotten, and the text is offered only to an empty field (`offerDraft`).

The empty conversation also offers the **set of variables** the workspace runs
against, beside a `Runs against` label, whenever the project has more than one —
the same `EnvProfileSwitch` and `useEnvProfiles` as the Run row, so the two read
one stored answer and a press on either moves both. Whether the work behind the
first message runs on production or staging data is a question for before it
is asked, not for after a build has pulled the other dump.
