import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AGENT_NAMES,
  type AgentKind,
  type Chat,
  type ChatStatus,
  DEFAULT_AGENT,
  MAX_CHATS_PER_WORKSPACE
} from '@core/chats.js'

import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useErrorMessage } from './useErrorMessage.js'

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
}

export interface ChatTabsController {
  readonly tabs: readonly ChatTab[]
  readonly activeKey: string
  readonly select: (key: string) => void
  /** Whether another conversation may be opened here; false at the cap. */
  readonly canCreate: boolean
  readonly create: () => Promise<void>
  readonly fork: (chatId: string) => Promise<void>
  readonly close: (chatId: string) => Promise<void>
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

/** The key the first tab carries before it has a record of its own. */
const FIRST_TAB = 'first'

function tabOf(chat: Chat): ChatTab {
  return {
    key: chat.id,
    id: chat.id,
    record: chat,
    agent: chat.agent,
    title: chat.title,
    status: chat.status,
    started: chat.sessionId !== null
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
    started: false
  }
]

/**
 * Rebuilds the strip from the core without moving any tab's key.
 *
 * A plain map would hand the first tab a new key the moment its record existed,
 * and remount a pane that is very likely mid-turn — writing the record is what
 * the first message does. So a tab that already knows its id keeps its key, and
 * the one that has none claims the record it has just become: the strip's first
 * tab is the workspace's first conversation, and `listChats` answers in the
 * order they were opened.
 */
function keepKeys(chats: readonly Chat[], current: readonly ChatTab[]): ChatTab[] {
  const claimed = new Set<string>()

  return chats.map((chat) => {
    const known = current.find((tab) => tab.id === chat.id)
    if (known) {
      claimed.add(known.key)
      return { ...tabOf(chat), key: known.key }
    }

    const virgin = current.find((tab) => tab.id === null && !claimed.has(tab.key))
    if (!virgin) return tabOf(chat)

    claimed.add(virgin.key)
    return { ...tabOf(chat), key: virgin.key }
  })
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
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>,
  onChats: (workspaceId: string, chats: readonly ChatTab[]) => void,
  onError: (message: string | null) => void
): ChatTabsController {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [tabs, setTabs] = useState<readonly ChatTab[]>(VIRGIN)
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
  const shown = useRef(workspaceId)

  useEffect(() => {
    shown.current = workspaceId
  }, [workspaceId])

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
    setTabs(VIRGIN)
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
  const load = useCallback(
    async (id: string, abandoned: () => boolean) => {
      const found = await window.octopus.chats.list(id)
      if (abandoned()) return

      if (!found.ok) {
        report.current(describeFailure(found))
        return
      }

      /*
       * An empty answer over a strip that already knows a record is a stale
       * read, not an empty workspace.
       *
       * The list is asked for the moment a workspace opens, and the first
       * message can be sent before the answer arrives — the pane creates the
       * record and says so through `bind`, and this read, which started before
       * any of that, would put the strip back to a workspace nobody had spoken
       * to and take the message with it. Nothing else empties the list: closing
       * refuses the last conversation, and removing the workspace moves the
       * selection elsewhere.
       */
      if (found.value.length === 0 && latestTabs.current.some((tab) => tab.id !== null)) return

      // No chat yet is otherwise the ordinary state of a fresh workspace rather
      // than a failure: the record is created by the first message.
      const next = found.value.length === 0 ? VIRGIN : keepKeys(found.value, latestTabs.current)

      latestTabs.current = next
      setTabs(next)
      publish.current(id, next)
    },
    [describeFailure]
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
    [load]
  )

  useEffect(
    () =>
      window.octopus.chats.onStatus((announced) => {
        // Broadcast to every window and covering every workspace; this strip
        // draws one.
        if (announced.workspaceId !== shown.current) return

        setTabs((current) =>
          current.map((tab) =>
            tab.id === announced.chatId ? { ...tab, status: announced.status } : tab
          )
        )
      }),
    []
  )

  const bind = useCallback((key: string, chat: Chat) => {
    const id = shown.current
    /* v8 ignore next */
    if (id === null) return

    const next = latestTabs.current.map((tab) => (tab.key === key ? { ...tabOf(chat), key } : tab))

    latestTabs.current = next
    setTabs(next)
    publish.current(id, next)
  }, [])

  const select = useCallback((key: string) => {
    const id = shown.current
    /* v8 ignore next */
    if (id === null) return

    setActiveByWorkspace((current) => new Map(current).set(id, key))
  }, [])

  const remembered = workspaceId === null ? undefined : activeByWorkspace.get(workspaceId)
  // The remembered tab may have been closed since, here or in another window,
  // so a key nothing answers to falls back to the first tab rather than to none
  // — a strip with no current tab draws an empty pane.
  //
  // The last fallback answers the type rather than a state: the strip always
  // holds at least one tab, since an empty list is drawn as the virgin one.
  /* v8 ignore next 2 */
  const activeKey = tabs.find((tab) => tab.key === remembered)?.key ?? tabs[0]?.key ?? FIRST_TAB

  /**
   * Opens another conversation, materialising the first if it is still virtual.
   *
   * Two calls rather than one, and the order is the contract. A virtual tab has
   * no id, so it can be neither drawn with a status nor told apart from a second
   * tab nobody has written to yet — and since the array's order is what numbers
   * the tabs, creating the second first would put the older conversation second.
   */
  const create = useCallback(async () => {
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
    if (shown.current !== id) return

    if (!created.ok) {
      report.current(describeFailure(created))
      return
    }

    await load(id, () => shown.current !== id)
    select(created.value.id)
  }, [tabs, load, select, describeFailure])

  const fork = useCallback(
    async (chatId: string) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return

      report.current(null)
      const forked = await window.octopus.chats.fork(chatId)
      if (shown.current !== id) return

      if (!forked.ok) {
        report.current(describeFailure(forked))
        return
      }

      await load(id, () => shown.current !== id)
      select(forked.value.id)
    },
    [load, select, describeFailure]
  )

  const close = useCallback(
    async (chatId: string) => {
      const id = shown.current
      /* v8 ignore next */
      if (id === null) return

      const index = tabs.findIndex((tab) => tab.id === chatId)
      const going = tabs[index]

      // Asked only when there is something to lose. Closing deletes the
      // transcript, and a conversation that has never run has none — while one
      // that has cannot be brought back by anything the application offers.
      if (going?.started === true) {
        // Named as the strip names it, its own name included: a dialog about
        // "Claude 2" over a tab reading "auth refactor" is a dialog about
        // something else.
        const name =
          going.title ?? t('chat.tab', { agent: AGENT_NAMES[going.agent], number: index + 1 })

        const answer = await confirm({
          title: t('chat.closeTabTitle'),
          message: t('chat.closeTabMessage', { name }),
          detail: t('chat.closeTabDetail'),
          confirmLabel: t('chat.closeTabConfirm'),
          cancelLabel: t('chat.closeTabCancel'),
          destructive: true
        })
        if (!answer.confirmed || shown.current !== id) return
      }

      report.current(null)
      const closed = await window.octopus.chats.close(chatId)
      if (shown.current !== id) return

      if (!closed.ok) {
        report.current(describeFailure(closed))
        return
      }

      await load(id, () => shown.current !== id)
    },
    [tabs, load, confirm, t, describeFailure]
  )

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
    [load, describeFailure]
  )

  return {
    tabs,
    activeKey,
    select,
    rename,
    editingKey,
    setEditingKey,
    canCreate: tabs.length < MAX_CHATS_PER_WORKSPACE,
    create,
    fork,
    close,
    bind
  }
}
