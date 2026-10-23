# The interface

```
┌──────────────────────────────────────────────────────────────────────┐
│ ●●●   sport   /Users/…/sport                                  ▶ │ ⊞  │  title bar
├────┬──────────────┬──────────────────────────┬──────────────────────┤
│ TG │  sport       │                          │ Changes Terminal …   │
│ SP │  ⑂ develop   │        agent chat        │                      │
│ OC ├──────────────┤                          │                      │
│    │  ● anna      │                          │                      │
│ +  │  ○ maria     │                          │                      │
│ ✣  │              │                          │                      │  ✣ plugins
├────┴──────────────┤                          │                      │
│ Claude   5h 31%   │                          │                      │
│ ⚙               ⊟ │                          │                      │
└───────────────────┴──────────────────────────┴──────────────────────┘
  tabs   workspaces           centre                 right pane
```

| File                                                             | Read it when                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [title-bar-and-project-tabs.md](title-bar-and-project-tabs.md)   | the title bar, its Run button, the project tab strip, a tile's attention dot, toasts and sounds |
| [workspace-list.md](workspace-list.md)                           | the left column's list: Help, the branch header, change counts, a branch's pull request state   |
| [account-and-status.md](account-and-status.md)                   | the foot of the left column, the usage reading and the status bar                               |
| [chat-tabs-and-viewer.md](chat-tabs-and-viewer.md)               | the centre's tab strip, file tabs and the file viewer                                           |
| [chat-log.md](chat-log.md)                                       | how the conversation log is drawn                                                               |
| [composer.md](composer.md)                                       | the composer, the context strip, `@` and `/`, side questions                                    |
| [chat-blocks-and-permissions.md](chat-blocks-and-permissions.md) | how blocks render, permission cards, the plan dialog, an MCP server's question                  |
| [chat-pickers.md](chat-pickers.md)                               | the model, effort and mode pickers                                                              |
| [right-pane.md](right-pane.md)                                   | the right pane itself: its tabs, folding, resizing, the terminal and notes tabs                 |
| [scripts-tab.md](scripts-tab.md)                                 | the Scripts tab: build, server, logs, the env editor                                            |
| [pull-request-tab.md](pull-request-tab.md)                       | the Pull request tab                                                                            |
| [settings-window.md](settings-window.md)                         | plugins, what a repository may run, About, file editors                                         |
| [files-tab.md](files-tab.md)                                     | the Files tab                                                                                   |
| [diff.md](diff.md)                                               | the Changes tab's diff and review notes                                                         |
| [colour.md](colour.md)                                           | tokens, project colours, contrast                                                               |
| [selection.md](selection.md)                                     | how a selected row, tab or rail item is drawn                                                   |
| [empty-panes.md](empty-panes.md)                                 | what a pane shows with nothing in it                                                            |
| [motion.md](motion.md)                                           | animation and reduced motion                                                                    |
| [classes-and-components.md](classes-and-components.md)           | the ready-made classes and shared components to reach for first                                 |
| [state.md](state.md)                                             | where the window keeps state and how it follows the core                                        |
| [lint-and-localisation.md](lint-and-localisation.md)             | the two lint rules that stop a build, and localising a string                                   |

## Across the window

**The page itself never scrolls, from script included.** `body` and `#root` are
`overflow: clip` rather than `hidden` (`styles.css`, pinned by `page.test.ts`):
`hidden` only removes the scrollbar, and `focus()` or `scrollIntoView()` still
move the box. The room for that move is always there — a tool row's `sr-only`
label is absolute with no positioned ancestor inside the log, so it is placed
against the row around the panes, escapes the log's scroller and hangs
thousands of pixels below the status bar — and one scroll that landed
in it carried the whole window up and left it there. Inside a pane, scroll the
pane's own list by `scrollTop`, and focus with `preventScroll` when the target is
already on screen: `scrollIntoView` aligns in every scrollable ancestor, not
only the nearest.

**A quit waits for what the sessions were writing, for up to a second.** A
transcript is append-only JSONL, so a write cut in half leaves a partial line the
reader refuses — and the reader is what a reopened conversation is drawn from.
`will-quit` is synchronous, so waiting means refusing the first pass, quitting
again once the promise settles, and a flag so the second falls through
(`src/main/quit.ts`).

**The second quit waits for the next turn of the loop.** With nothing to close,
the wait settles at once and its callback ran as a microtask inside the refused
`will-quit`, while Electron still counted itself as quitting — and it ignores a
quit asked for then. The window went and the process stayed, measured at more
than four minutes after a `SIGTERM`; a relaunch onto it lost the single-instance
lock and showed the old build. Deferred with `setTimeout`, the same quit takes
about a second.

The ceiling is `SHUTDOWN_GRACE_MS`, and what ends at it is the **waiting**
rather than the write: a filesystem write in flight cannot be called back, and
`within` says "I stopped waiting" rather than "it stopped". A truncated
transcript is worse than a slow quit up to about a second and worse than nothing
after it, which is where the number comes from rather than from any measurement.

**It waits for the terminals too, and only a stubborn run makes that longer.**
They are signalled first and synchronously, and the second quit also waits until every process group has emptied — a run
stopped a moment before the quit included, which leaves the list at once and
was not waited for at first. Signalling is not the same as having
gone: a quit that left 50 ms after the SIGTERM went long before the kill was
due, and a run's child that ignored SIGTERM kept its port after the app had
gone. Tabs are hung up on at once, and a polite server leaves on SIGTERM, so an
ordinary quit stays as fast as it was (measured at 52 ms with a tab and a server
open). A run that ignores SIGTERM holds it for 2.5 s, until its group is killed,
and `dispose`'s own ceiling bounds the wait at 3.5 s.

**Only the ⌥ shortcuts ask where the focus is.** ⌘ and ⌃ are not typing
gestures, so a shortcut on them is unambiguous wherever it is pressed — but on
macOS ⌥ is how a great many characters are typed, and ⌥1 in the composer was
switching conversation while swallowing the `¡` somebody meant to write. The
terminal is one of the surfaces that counts: xterm.js takes its input through a
hidden `textarea`, so a key pressed at a shell belongs to the shell.

**Every shortcut first asks whether a dialog is open**, and does nothing if one
is. `Modal` is the only `<dialog>` in the renderer and `showModal()` is how each
one opens, so `dialog[open]` in the DOM is the one source of truth — and it
covers the confirmation dialog, whose hook does not expose its state, which is
the hole threading a handful of booleans through `App` would have left. Before
this, ⌃2 pressed behind Project settings changed the selected workspace, which
re-read the checkout's scripts into the list sitting above the trust checkbox.
The `role="dialog"` popovers are dismissable and deliberately not matched.

**Shift+Tab in the composer moves to the next mode**, ahead of the command list
that completes on plain Tab, and an IME composition is left alone as with Enter.

**Enter sends, Shift+Enter breaks the line, and an Enter that is composing does
neither.** For anyone typing through an input method — Japanese, Chinese,
Korean among others — Enter confirms a candidate, and it used to send the
message with it: every committed word went out. `isComposing` on the native
event is the check, in the three places that have this key: the composer, the
plan dialog's field, and the rename field, which writes to disk.
