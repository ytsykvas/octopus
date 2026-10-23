# State

Hooks own everything that talks to IPC — `useProjects`, `useWorkspaces`,
`useChat`, `useRateLimit`, `usePlugins` and the rest. A component that lays out a window should not also
know what an IPC failure looks like.

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

`useChat` reads the history from disk **once** and then only appends what
arrives as events. Re-reading the file to merge would bring back, as a
duplicate, every entry the UI had already drawn.

The split is not all-or-nothing: `useProjects.remove` asks and deletes, while
`App` clears the selection afterwards — what points at a project is the window's
business.

**A reply is claimed before its await, never after.** A hook that reads for the
workspace on screen has to drop what comes back for one that has been left, and
the guard is a counter bumped per read: `useWorkspaceDiff` and `usePullRequest`
both keep one. Where the number is taken decides whether it works. Taken
**before** the call, a workspace opened in the meantime bumps the counter and
the late reply is dropped. Taken **after**, the late reply bumps it past the
number the new workspace's own read had just claimed, and wins — which is how
the pull request pane came to draw one workspace's branch over another's request
number, with Merge sending exactly that pair.

The same applies to whatever a pane is _doing_, not only to what it reads: the
render-time reset that clears the view clears `creating`, `drafting` and the
action's error with it, or a refusal about the branch just left is shown against
the one arrived at.

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
one project does not follow the reader into another. One transient failure used
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

The empty conversation also offers the **set of variables** the workspace runs
against, beside a `Runs against` label, whenever the project has more than one —
the same `EnvProfileSwitch` and `useEnvProfiles` as the Run row, so the two read
one stored answer and a press on either moves both. Whether the work behind the
first message runs on production or staging data is a question for before it
is asked, not for after a build has pulled the other dump.
