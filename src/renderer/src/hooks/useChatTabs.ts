import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type AgentKind,
  type Chat,
  type ChatStatus,
  type ClosedChat,
  DEFAULT_AGENT,
  MAX_CHATS_PER_WORKSPACE,
  type WorkingMode
} from '@core/chats.js'
import { formatHandoff } from '@core/handoff.js'
import type { SideExchange } from '@core/sideQuestions.js'

import type { Result } from '../../../preload/index.js'

import { useErrorMessage } from './useErrorMessage.js'
import { useLatest } from './useLatest.js'
import { type ForgetsWorkspaces, type WorkspaceMatch, withoutWorkspaces } from './workspaceSlots.js'

/**
 * One tab of the chat pane.
 *
 * `key` is the invariant the rest of this hook exists to keep: it is fixed for
 * the tab's whole life and, crucially, does **not** change when the record
 * appears. The obvious key — the chat id, falling back to the workspace — moves
 * on the first message of every new workspace, which remounts the pane in the
 * middle of the turn that caused it and throws away the message just drawn, the
 * answer being streamed and the permission being waited on.
 */
export interface ChatTab {
  readonly key: string
  /** Null only for the first tab, before anything has been written to it. */
  readonly id: string | null
  /**
   * The record, for the pane to start from.
   *
   * Carried here rather than read again by each pane: this hook has just asked
   * for the list, and three panes asking for it separately would be three round
   * trips to learn what one already knows. It is a seed and not a live copy —
   * the pane owns its settings once it is showing.
   */
  readonly record: Chat | null
  /** Which agent runs it, which is what the tab is named after by default. */
  readonly agent: AgentKind
  /** A name the user gave it, or null for the one it is given. */
  readonly title: string | null
  readonly status: ChatStatus
  /** Whether there is a session to continue — what makes forking possible. */
  readonly started: boolean
  /** Whether its last turn was cut off by the application exiting — `Chat['interrupted']`. */
  readonly interrupted: boolean
}

export interface ChatTabsController {
  readonly tabs: readonly ChatTab[]
  readonly activeKey: string
  readonly select: (keyOrId: string) => void
  /** Chooses the tab a workspace opens on, before it is the one on screen. */
  readonly selectIn: (workspaceId: string, keyOrId: string) => void
  /** Whether another conversation may be opened here; false at the cap. */
  readonly canCreate: boolean
  /**
   * Opens another conversation and moves to it.
   *
   * `beforeShown` is told the new conversation's id once its record exists and
   * before its tab is drawn — the one moment a draft can be put down for it,
   * since the composer reads its draft once, as it mounts — and is told even
   * when the workspace changed meanwhile. A conversation made here is keyed by
   * its chat id (an unwritten first tab is made real before it, and keeps
   * `first`), so the id is the key the draft is filed under. The tab waits for
   * what it returns, so a message it sends is on disk when the pane mounts, as
   * in `forkThen`.
   */
  readonly create: (beforeShown?: (id: string) => void | Promise<void>) => Promise<void>
  /**
   * Opens a conversation continuing this one, from a side answer when `aside`
   * is given, and moves to it. Says whether it did.
   */
  readonly fork: (chatId: string, aside?: SideExchange) => Promise<boolean>
  /**
   * Opens a conversation continuing this one and has it carry out a plan: in
   * `mode`, told `message`. Says whether the plan is under way there — the
   * caller leaves the source alone otherwise, so its question stays answerable.
   */
  readonly forkPlan: (chatId: string, plan: ForkedPlan) => Promise<boolean>
  /**
   * Puts the conversation on the clipboard as text another one can start from.
   *
   * Says whether it got there: the strip is what shows the answer, because the
   * menu it was asked from has already closed.
   */
  readonly copyTranscript: (chatId: string, title: string) => Promise<boolean>
  readonly close: (chatId: string) => Promise<void>
  /**
   * The conversations closed in this workspace, most recently closed first.
   *
   * Read when the history is opened rather than kept live: each entry costs a
   * read of its transcript for the line that names it, which is not worth doing
   * for a list nobody is looking at.
   */
  readonly history: readonly ClosedChat[]
  readonly refreshHistory: () => Promise<void>
  /** Brings a closed conversation back as a tab and shows it. */
  readonly reopen: (chatId: string) => Promise<void>
  /** Reopens the one closed last, which is what ⌘⇧T asks for. */
  readonly reopenLast: () => Promise<void>
  /** Names a conversation; an empty name gives it back the one it is given. */
  readonly rename: (chatId: string, title: string) => Promise<void>
  /**
   * Which tab is being renamed, if any.
   *
   * Here rather than in the strip because the strip is rebuilt from the core
   * after every create, fork and close — the same reasoning that puts
   * `editingId` on `useWorkspaces` rather than on the row.
   */
  readonly editingKey: string | null
  readonly setEditingKey: (key: string | null) => void
  /**
   * Binds the first tab to the record the pane has just created for it.
   *
   * The first conversation is written by the first thing done to it rather than
   * by opening the workspace, so the pane is what learns its id — and the strip
   * needs it to draw a dot and to offer the menu.
   */
  readonly bind: (key: string, chat: Chat) => void
}

/** What a fork carrying out a plan is started with. */
export interface ForkedPlan {
  readonly mode: WorkingMode
  readonly message: string
}

// Drafts, notes and attached files are filed under it, so a conversation that
// inherited it from a closed one would inherit those too.
const FIRST_TAB = 'first'

function tabOf(chat: Chat): ChatTab {
  return {
    key: chat.id,
    id: chat.id,
    record: chat,
    agent: chat.agent,
    title: chat.title,
    status: chat.status,
    started: chat.sessionId !== null,
    interrupted: chat.interrupted
  }
}

/** What a workspace nobody has spoken to shows: one tab, and no record. */
const VIRGIN: readonly ChatTab[] = [
  // Claude, because that is what `openChat` will create for it. A tab with no
  // record still has to be called something, and calling it nothing would make
  // the first conversation of every workspace the odd one out.
  {
    key: FIRST_TAB,
    id: null,
    record: null,
    agent: DEFAULT_AGENT,
    title: null,
    status: 'idle',
    started: false,
    interrupted: false
  }
]

// Known tabs keep their keys, so a pane mid-turn is never remounted.
function keepKeys(
  chats: readonly Chat[],
  current: readonly ChatTab[],
  owner: string | undefined
): ChatTab[] {
  let claimable = owner === undefined && current.some((tab) => tab.id === null)

  return chats.map((chat) => {
    const known = current.find((tab) => tab.id === chat.id)
    if (known) return { ...tabOf(chat), key: known.key }
    if (chat.id !== owner && !claimable) return tabOf(chat)

    claimable = false
    return { ...tabOf(chat), key: FIRST_TAB }
  })
}

function answersTo(tab: ChatTab, keyOrId: string | undefined): boolean {
  return tab.key === keyOrId || tab.id === keyOrId
}

function withoutGone(
  active: ReadonlyMap<string, string>,
  workspaceId: string,
  tabs: readonly ChatTab[]
): ReadonlyMap<string, string> {
  const held = active.get(workspaceId)
  if (held === undefined || tabs.some((tab) => answersTo(tab, held))) return active

  const rest = new Map(active)
  rest.delete(workspaceId)
  return rest
}

function stripOf(
  strips: ReadonlyMap<string, readonly ChatTab[]>,
  workspaceId: string | null
): readonly ChatTab[] {
  return (workspaceId === null ? undefined : strips.get(workspaceId)) ?? VIRGIN
}

function rememberFirst(
  owners: Map<string, string>,
  workspaceId: string,
  tabs: readonly ChatTab[]
): void {
  const owner = tabs.find((tab) => tab.key === FIRST_TAB)?.id
  if (typeof owner === 'string') owners.set(workspaceId, owner)
}

/**
 * The conversations of one workspace, and which of them is on screen.
 *
 * Held by `App` rather than by the chat pane because `App` owns the keyboard
 * listener, and ⌥1–⌥3 need the list to turn a digit into a tab. It is also
 * where the drafts live, which are now kept per tab rather than per workspace.
 */
export function useChatTabs(
  workspaceId: string | null,
  onChats: (workspaceId: string, chats: readonly ChatTab[]) => void,
  onError: (message: string | null) => void
): ChatTabsController & ForgetsWorkspaces {
  const describeFailure = useErrorMessage()

  const [tabs, setTabs] = useState<readonly ChatTab[]>(VIRGIN)
  const [strips, setStrips] = useState<ReadonlyMap<string, readonly ChatTab[]>>(new Map())
  const [history, setHistory] = useState<readonly ClosedChat[]>([])
  const [shownWorkspaceId, setShownWorkspaceId] = useState(workspaceId)

  /*
   * Which tab each workspace was left on.
   *
   * The same argument the drafts make: looking at another workspace mid-task is
   * this application's premise, and coming back to conversation 1 when you left
   * on conversation 3 is losing your place for no reason.
   */
  const [activeByWorkspace, setActiveByWorkspace] = useState<ReadonlyMap<string, string>>(new Map())
  const [editingKey, setEditingKey] = useState<string | null>(null)

  // The workspace on screen, for the callbacks to check against. Updated in an
  // effect and read only inside a callback, never during render.
  const shown = useLatest(workspaceId)

  /*
   * The strip as it stands, for the callbacks that rebuild it.
   *
   * Read from a ref rather than from inside a `setTabs` updater, because these
   * callbacks also have to tell `onChats` — and an updater has to be pure. Under
   * React's double-invoked updaters in development, telling the parent from
   * inside one announces the same list twice.
   */
  const latestTabs = useRef(tabs)

  useEffect(() => {
    latestTabs.current = tabs
  }, [tabs])

  const firstChatByWorkspace = useRef(new Map<string, string>())
  const bindCount = useRef(0)

  /*
   * The two callbacks out, held rather than depended on.
   *
   * `load` runs in an effect keyed on the workspace. A caller that builds these
   * inline — which is the ordinary way to write a callback — would change their
   * identity every render, and the effect would re-read the conversations on
   * each one: the strip flickered back to a workspace's untouched state in the
   * middle of its first message.
   */
  const report = useRef(onError)
  const publish = useRef(onChats)

  useEffect(() => {
    report.current = onError
    publish.current = onChats
  }, [onError, onChats])

  // Reset during render rather than in an effect, the house pattern: an effect
  // runs after the paint, so switching workspace would draw the previous one's
  // tabs for a frame.
  if (workspaceId !== shownWorkspaceId) {
    setShownWorkspaceId(workspaceId)
    setTabs(stripOf(strips, workspaceId))
    // The previous workspace's closed conversations would be offered here, and
    // reopening one would fail against a workspace it does not belong to.
    setHistory([])
    // A field left open over a conversation that is no longer on screen would
    // rename whichever tab took its place.
    setEditingKey(null)
  }

  /**
   * Reads the conversations, and hands the answer up as well as keeping it.
   *
   * Up, so the workspace row can draw a dot per conversation: `workspaces.list`
   * would put git to work on every workspace of the project to learn something
   * this hook has just been told.
   */
  const keep = useCallback((id: string, next: readonly ChatTab[]) => {
    rememberFirst(firstChatByWorkspace.current, id, next)
    latestTabs.current = next
    setTabs(next)
    setStrips((current) => new Map(current).set(id, next))
    publish.current(id, next)
  }, [])

  const load = useCallback(
    async (id: string, abandoned: () => boolean) => {
      const before = bindCount.current
      const found = await window.octopus.chats.list(id)
      if (abandoned()) return

      if (!found.ok) {
        report.current(describeFailure(found))
        return
      }

      // Empty because it was read before the first message bound its record: applying
      // it would take that tab back to untouched, mid-turn.
      if (found.value.length === 0 && bindCount.current !== before) return

      // Otherwise empty is a workspace with no conversations, perhaps one made anew
      // under a removed one's id, which must inherit neither its owner nor its strip.
      if (found.value.length === 0) firstChatByWorkspace.current.delete(id)
      const next =
        found.value.length === 0
          ? VIRGIN
          : keepKeys(found.value, latestTabs.current, firstChatByWorkspace.current.get(id))
      keep(id, next)
      // Held on, a tab that has gone would pull the view back to it when it returns.
      setActiveByWorkspace((current) => withoutGone(current, id, next))
    },
    [describeFailure, keep]
  )

  useEffect(() => {
    const controller = new AbortController()
    if (workspaceId === null) return

    void (async () => {
      await load(workspaceId, () => controller.signal.aborted)
    })()

    return () => {
      controller.abort()
    }
  }, [workspaceId, load])

  /*
   * The set of conversations moved, in this workspace or another's.
   *
   * Re-read rather than patched: the announcement says the set changed, not
   * how, and a tab created in the other window has a title and a status this
   * one has never seen. `load` is the same read the workspace effect makes.
   */
  useEffect(
    () =>
      window.octopus.chats.onChanged((announced) => {
        // Broadcast to every window and covering every workspace; this strip
        // draws one.
        if (announced.workspaceId !== shown.current) return

        void load(announced.workspaceId, () => shown.current !== announced.workspaceId)
      }),
    [load, shown]
  )

  useEffect(
    () =>
      window.octopus.chats.onStatus((announced) => {
        // Broadcast to every window and covering every workspace; this strip
        // draws one.
        if (announced.workspaceId !== shown.current) return

        // The list as it was when nothing in it moved: a status is announced
        // several times a turn, and every tab in the strip is memoised on it.
        // The flag is copied rather than cleared here: when a move ends it is
        // the core's rule, and it says so on the event.
        const { chatId, status, interrupted } = announced
        setTabs((current) =>
          current.some(
            (tab) => tab.id === chatId && (tab.status !== status || tab.interrupted !== interrupted)
          )
            ? current.map((tab) => (tab.id === chatId ? { ...tab, status, interrupted } : tab))
            : current
        )
      }),
    [shown]
  )

  const bind = useCallback(
    (key: string, chat: Chat) => {
      const id = shown.current
      // The pane that asked may belong to a workspace left before its record came.
      if (id !== chat.workspaceId) return

      bindCount.current += 1
      keep(
        id,
        latestTabs.current.map((tab) => (tab.key === key ? { ...tabOf(chat), key } : tab))
      )
    },
    [shown, keep]
  )

  const select = useCallback(
    (keyOrId: string) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return

      setActiveByWorkspace((current) => new Map(current).set(id, keyOrId))
    },
    [shown]
  )

  const selectIn = useCallback((workspaceId: string, keyOrId: string) => {
    setActiveByWorkspace((current) => new Map(current).set(workspaceId, keyOrId))
  }, [])

  const forget = useCallback(
    (gone: WorkspaceMatch) => {
      for (const id of firstChatByWorkspace.current.keys()) {
        if (gone(id)) firstChatByWorkspace.current.delete(id)
      }
      setStrips((current) => withoutWorkspaces(current, gone))
      setActiveByWorkspace((current) => withoutWorkspaces(current, gone))
      // A removed workspace can stay the selected id, and one made under it draws no reset.
      const id = shown.current
      if (id !== null && gone(id)) setTabs(VIRGIN)
    },
    [shown]
  )

  const remembered = workspaceId === null ? undefined : activeByWorkspace.get(workspaceId)
  // The remembered tab may have been closed since, here or in another window,
  // so a key nothing answers to falls back to the first tab rather than to none
  // — a strip with no current tab draws an empty pane.
  //
  // The last fallback answers the type rather than a state: the strip always
  // holds at least one tab, since an empty list is drawn as the virgin one.
  const onScreen = tabs.find((tab) => answersTo(tab, remembered)) ?? tabs[0]
  /* v8 ignore next */
  const activeKey = onScreen?.key ?? FIRST_TAB

  /**
   * Opens another conversation, materialising the first if it is still virtual.
   *
   * Two calls rather than one, and the order is the contract. A virtual tab has
   * no id, so it can be neither drawn with a status nor told apart from a second
   * tab nobody has written to yet — and since the array's order is what numbers
   * the tabs, creating the second first would put the older conversation second.
   */
  const create = useCallback(
    async (beforeShown?: (id: string) => void | Promise<void>) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return

      if (tabs.some((tab) => tab.id === null)) {
        const opened = await window.octopus.chats.open(id)
        if (shown.current !== id) return

        if (!opened.ok) {
          report.current(describeFailure(opened))
          return
        }
      }

      report.current(null)
      const created = await window.octopus.chats.create(id)
      // Whatever is on screen by now: the conversation exists and holds a
      // place, and a draft is filed under its own workspace, so the text is
      // there when that workspace is opened again.
      if (created.ok) await beforeShown?.(created.value.id)
      if (shown.current !== id) return

      if (!created.ok) {
        report.current(describeFailure(created))
        return
      }

      await load(id, () => shown.current !== id)
      select(created.value.id)
    },
    [tabs, load, select, describeFailure, shown]
  )

  /*
   * Forks, then optionally starts the fork on something before showing it.
   *
   * The start comes before the tab is loaded rather than after: the message is
   * on disk by the time `send` answers, so the pane that mounts reads it with
   * the rest of the history instead of racing the core to draw it. A failed
   * start still shows the fork — it exists, and hiding it would leave a tab
   * the user never saw open.
   */
  const forkThen = useCallback(
    async (make: () => Promise<Result<Chat>>, start?: (chat: Chat) => Promise<Result<unknown>>) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return false

      report.current(null)
      const forked = await make()
      if (shown.current !== id) return false

      if (!forked.ok) {
        report.current(describeFailure(forked))
        return false
      }

      const started = start === undefined ? null : await start(forked.value)
      if (shown.current !== id) return false
      if (started !== null && !started.ok) report.current(describeFailure(started))

      await load(id, () => shown.current !== id)
      select(forked.value.id)
      return started?.ok ?? true
    },
    [load, select, describeFailure, shown]
  )

  const fork = useCallback(
    (chatId: string, aside?: SideExchange) =>
      forkThen(() => window.octopus.chats.fork(chatId, aside)),
    [forkThen]
  )

  const forkPlan = useCallback(
    (chatId: string, { mode, message }: ForkedPlan) =>
      // The mode is the new chat's own from the start, so the message that
      // opens its first turn already runs in it.
      forkThen(
        () => window.octopus.chats.handOffPlan(chatId, mode),
        (chat) => window.octopus.chats.send(chat.id, message)
      ),
    [forkThen]
  )

  const copyTranscript = useCallback(
    async (chatId: string, title: string): Promise<boolean> => {
      report.current(null)
      const history = await window.octopus.chats.history(chatId)

      if (!history.ok) {
        report.current(describeFailure(history))
        return false
      }

      try {
        await navigator.clipboard.writeText(formatHandoff(history.value, { title }))
        return true
      } catch {
        // A refused clipboard is real — an unfocused document is enough.
        return false
      }
    },
    [describeFailure]
  )

  const refreshHistory = useCallback(async () => {
    const id = shown.current
    /* v8 ignore next */
    if (id === null) return

    const closed = await window.octopus.chats.closed(id)
    if (shown.current !== id) return

    if (closed.ok) setHistory(closed.value)
    else report.current(describeFailure(closed))
  }, [describeFailure, shown])

  /*
   * No confirmation. Closing used to discard the conversation, and asking was
   * the only protection a slip had; it now moves it to the history, where
   * reopening is the protection — and a dialog saying "this cannot be brought
   * back" would be untrue.
   */
  const close = useCallback(
    async (chatId: string) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return

      report.current(null)
      const closed = await window.octopus.chats.close(chatId)
      if (shown.current !== id) return

      if (!closed.ok) {
        report.current(describeFailure(closed))
        return
      }

      // The history is not read here: it is read when it is opened, which is
      // what the menu does, and each entry costs a read of its transcript.
      await load(id, () => shown.current !== id)
    },
    [load, describeFailure, shown]
  )

  const reopen = useCallback(
    async (chatId: string) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return

      report.current(null)
      const reopened = await window.octopus.chats.reopen(chatId)
      if (shown.current !== id) return

      if (!reopened.ok) {
        report.current(describeFailure(reopened))
        return
      }

      await load(id, () => shown.current !== id)
      select(reopened.value.id)
    },
    [load, select, describeFailure, shown]
  )

  const reopenLast = useCallback(async () => {
    const id = shown.current
    /* v8 ignore next */
    if (id === null) return

    // Asked rather than taken from `history`, which is only as fresh as the
    // last time the menu was opened.
    const closed = await window.octopus.chats.closed(id)
    if (shown.current !== id) return

    if (!closed.ok) {
      report.current(describeFailure(closed))
      return
    }

    const [latest] = closed.value
    if (latest) await reopen(latest.chat.id)
  }, [reopen, describeFailure, shown])

  const rename = useCallback(
    async (chatId: string, title: string) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return

      setEditingKey(null)

      report.current(null)
      const renamed = await window.octopus.chats.rename(chatId, title)
      if (shown.current !== id) return

      if (!renamed.ok) {
        report.current(describeFailure(renamed))
        return
      }

      await load(id, () => shown.current !== id)
    },
    [load, describeFailure, shown]
  )

  return {
    tabs,
    activeKey,
    select,
    selectIn,
    rename,
    editingKey,
    setEditingKey,
    canCreate: tabs.length < MAX_CHATS_PER_WORKSPACE,
    create,
    fork,
    forkPlan,
    copyTranscript,
    close,
    history,
    refreshHistory,
    reopen,
    reopenLast,
    bind,
    forget
  }
}
