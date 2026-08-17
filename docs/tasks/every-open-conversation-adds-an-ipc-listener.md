# Every open conversation adds an IPC listener

## What happens

`npm run dev` prints this while the window is being used:

```
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 chats:event listeners added to [IpcRenderer]. MaxListeners is 10.
```

`useChat` subscribes with `window.octopus.chats.onEvent` (`useChat.ts:188`), and
the preload registers one `ipcRenderer.on('chats:event', …)` per call
(`preload/index.ts:232-240`). One conversation pane is one listener, every pane
receives every conversation's events, and each filters by `chatId` itself.

Three conversations per workspace and several workspaces visited in a session is
enough to pass ten.

## Why it matters

The warning is Node saying "this looks like a leak", and here it is at least
half right: the listeners do come off on unmount, but the count grows with how
many panes are mounted at once, so the ceiling is a number nobody chose. Ten is
also low enough that an ordinary session crosses it, which turns a diagnostic
meant to catch real leaks into noise — and noise in a log is a leak nobody will
notice next time.

Fan-out is the other half. Every pane is woken for every fragment of every other
conversation's stream, and drops it after comparing an id. With three agents
streaming that is three times the work each of them needs.

## Sketch

One listener in the renderer, owned where the panes are, dispatching by `chatId`
to whichever pane is registered for it — the shape `useChatTabs` already has the
list for. The preload API stays as it is; what changes is that `useChat` asks a
shared dispatcher for its own id rather than the bridge for everything.

Failing that, `ipcRenderer.setMaxListeners` at least says the number is
deliberate — but it silences the diagnostic without answering the fan-out, so it
is the worse of the two.

## Worth knowing

Whether this is new was not established. It was noticed in a session that had
just restarted the app for an unrelated change, and nothing in that change goes
near the subscription.
