import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chat } from '../../test/chat.js'
import type { ChatTab, ChatTabsController } from '../../hooks/useChatTabs.js'
import { type ClosedChat, MAX_CHAT_TITLE } from '@core/chats.js'

import { ChatTabs } from './ChatTabs.js'

function tab(overrides: Partial<ChatTab> = {}): ChatTab {
  return {
    key: 'chat-1',
    id: 'chat-1',
    record: chat(),
    agent: 'claude',
    title: null,
    status: 'idle',
    started: true,
    ...overrides
  }
}

function controller(overrides: Partial<ChatTabsController> = {}): ChatTabsController {
  return {
    tabs: [tab()],
    activeKey: 'chat-1',
    select: vi.fn(),
    selectIn: vi.fn(),
    canCreate: true,
    create: vi.fn(() => Promise.resolve()),
    fork: vi.fn(() => Promise.resolve(true)),
    copyTranscript: vi.fn(() => Promise.resolve(true)),
    close: vi.fn(() => Promise.resolve()),
    history: [],
    refreshHistory: vi.fn(() => Promise.resolve()),
    reopen: vi.fn(() => Promise.resolve()),
    reopenLast: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
    editingKey: null,
    setEditingKey: vi.fn(),
    bind: vi.fn(),
    ...overrides
  }
}

/** Opens a tab's menu, which is where the two actions live. */
async function openMenu(name = 'Claude 1'): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name }))
}

describe('the strip', () => {
  it('names each conversation after the agent that runs it, and numbers it', () => {
    render(
      <ChatTabs
        tabs={controller({
          tabs: [tab(), tab({ key: 'chat-2', id: 'chat-2' })]
        })}
      />
    )

    expect(screen.getByText('Claude 1')).toBeInTheDocument()
    expect(screen.getByText('Claude 2')).toBeInTheDocument()
  })

  // `aria-current` rather than a tablist, which is what every other switch in
  // this window uses.
  it('marks the one that is showing', () => {
    render(
      <ChatTabs
        tabs={controller({
          tabs: [tab(), tab({ key: 'chat-2', id: 'chat-2' })],
          activeKey: 'chat-2'
        })}
      />
    )

    const [first, second] = screen.getAllByRole('button', { name: /^Claude \d: / })
    expect(first).not.toHaveAttribute('aria-current')
    expect(second).toHaveAttribute('aria-current', 'page')
  })

  it('says what each conversation is doing, since a dot says nothing aloud', () => {
    render(<ChatTabs tabs={controller({ tabs: [tab({ status: 'waiting_permission' })] })} />)

    expect(
      screen.getByRole('button', { name: 'Claude 1: Waiting for your answer' })
    ).toBeInTheDocument()
  })

  it('switches on a click', async () => {
    const user = userEvent.setup()
    const tabs = controller({ tabs: [tab(), tab({ key: 'chat-2', id: 'chat-2' })] })
    render(<ChatTabs tabs={tabs} />)

    await user.click(screen.getByRole('button', { name: /^Claude 2: / }))

    expect(tabs.select).toHaveBeenCalledWith('chat-2')
  })
})

describe('opening another', () => {
  it('offers to while there is room', async () => {
    const user = userEvent.setup()
    const tabs = controller()
    render(<ChatTabs tabs={tabs} />)

    await user.click(screen.getByRole('button', { name: 'New conversation' }))

    expect(tabs.create).toHaveBeenCalled()
  })

  // Three share a worktree; past that the tabs stop being a way to work in
  // parallel and become a way to lose track of who changed what.
  it('stops offering at the cap', () => {
    render(<ChatTabs tabs={controller({ canCreate: false })} />)

    expect(screen.queryByRole('button', { name: 'New conversation' })).not.toBeInTheDocument()
  })
})

describe('a conversation with a name of its own', () => {
  it('is called what it was called, rather than after its agent', () => {
    render(<ChatTabs tabs={controller({ tabs: [tab({ title: 'auth refactor' })] })} />)

    expect(screen.getByText('auth refactor')).toBeInTheDocument()
    expect(screen.queryByText('Claude 1')).not.toBeInTheDocument()
  })

  it('says its own name when asked what it is doing', () => {
    render(
      <ChatTabs tabs={controller({ tabs: [tab({ title: 'auth refactor', status: 'running' })] })} />
    )

    expect(
      screen.getByRole('button', { name: 'auth refactor: The agent is working here' })
    ).toBeInTheDocument()
  })
})

describe('renaming a conversation', () => {
  // The same gesture as renaming a workspace one pane to the left, so it is
  // learned once.
  it('opens the field on a double click', async () => {
    const user = userEvent.setup()
    const tabs = controller()
    render(<ChatTabs tabs={tabs} />)

    await user.dblClick(screen.getByRole('button', { name: /^Claude 1: / }))

    expect(tabs.setEditingKey).toHaveBeenCalledWith('chat-1')
  })

  it('offers it in the menu as well', async () => {
    const user = userEvent.setup()
    const tabs = controller()
    render(<ChatTabs tabs={tabs} />)

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Rename…' }))

    expect(tabs.setEditingKey).toHaveBeenCalledWith('chat-1')
  })

  // Opening on what the tab says is what makes a small correction a small edit.
  it('opens on the name the tab is showing', () => {
    render(<ChatTabs tabs={controller({ editingKey: 'chat-1' })} />)

    expect(screen.getByRole('textbox')).toHaveValue('Claude 1')
  })

  /*
   * The field carries the same bound the boundary parses with, and asserting
   * them against one constant is what keeps them in step: bounded only at the
   * far end, an ordinary keystroke came back as a refusal a round trip later,
   * where every rename box in every application simply stops.
   *
   * jsdom does not enforce `maxLength` on a programmatic value, so this reads
   * the attribute rather than typing 61 characters and asserting a length — a
   * test that would pass whatever the attribute said.
   */
  it('bounds the field by the same number the boundary refuses past', () => {
    render(<ChatTabs tabs={controller({ editingKey: 'chat-1' })} />)

    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', String(MAX_CHAT_TITLE))
  })

  it('keeps what was typed', async () => {
    const user = userEvent.setup()
    const tabs = controller({ editingKey: 'chat-1' })
    render(<ChatTabs tabs={tabs} />)

    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'auth refactor{Enter}')

    expect(tabs.rename).toHaveBeenCalledWith('chat-1', 'auth refactor')
  })

  /*
   * Emptying the field is a request rather than a slip, unlike a workspace's
   * name: a conversation has a name it is given when it has none of its own.
   */
  it('takes the name back when the field is emptied', async () => {
    const user = userEvent.setup()
    const tabs = controller({ editingKey: 'chat-1', tabs: [tab({ title: 'auth refactor' })] })
    render(<ChatTabs tabs={tabs} />)

    await user.clear(screen.getByRole('textbox'))
    await user.keyboard('{Enter}')

    expect(tabs.rename).toHaveBeenCalledWith('chat-1', '')
  })

  it('closes the field on Escape without renaming anything', async () => {
    const user = userEvent.setup()
    const tabs = controller({ editingKey: 'chat-1' })
    render(<ChatTabs tabs={tabs} />)

    await user.type(screen.getByRole('textbox'), 'never mind{Escape}')

    expect(tabs.rename).not.toHaveBeenCalled()
    expect(tabs.setEditingKey).toHaveBeenCalledWith(null)
  })

  // Nothing to rename until there is a record to hang the name on.
  it('does not open for a conversation with no record', async () => {
    const user = userEvent.setup()
    const tabs = controller({ tabs: [tab({ key: 'first', id: null, record: null })] })
    render(<ChatTabs tabs={tabs} />)

    await user.dblClick(screen.getByRole('button', { name: /^Claude 1: / }))

    expect(tabs.setEditingKey).not.toHaveBeenCalled()
  })
})

describe('what a tab’s menu offers', () => {
  it('continues the conversation in a new tab', async () => {
    const user = userEvent.setup()
    const tabs = controller({ tabs: [tab(), tab({ key: 'chat-2', id: 'chat-2' })] })
    render(<ChatTabs tabs={tabs} />)

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: /Continue in a new conversation/ }))

    expect(tabs.fork).toHaveBeenCalledWith('chat-1')
  })

  it('copies the conversation under the name the tab shows', async () => {
    const user = userEvent.setup()
    const tabs = controller()
    render(<ChatTabs tabs={tabs} />)

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: /Copy transcript/ }))

    expect(tabs.copyTranscript).toHaveBeenCalledWith('chat-1', 'Claude 1')
  })

  it('does not offer to copy a conversation that has not started', async () => {
    render(
      <ChatTabs
        tabs={controller({ tabs: [tab({ started: false }), tab({ key: 'b', id: 'b' })] })}
      />
    )

    await openMenu()

    expect(screen.queryByRole('menuitem', { name: /Copy transcript/ })).not.toBeInTheDocument()
  })

  it('closes it', async () => {
    const user = userEvent.setup()
    const tabs = controller({ tabs: [tab(), tab({ key: 'chat-2', id: 'chat-2' })] })
    render(<ChatTabs tabs={tabs} />)

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Close conversation' }))

    expect(tabs.close).toHaveBeenCalledWith('chat-1')
  })

  /*
   * A menu item that never works is a promise the interface does not keep. The
   * last conversation cannot be closed — a workspace with none has no way back
   * to one but the first message.
   */
  it('does not offer to close the only conversation', async () => {
    render(<ChatTabs tabs={controller()} />)

    await openMenu()

    expect(screen.queryByRole('menuitem', { name: 'Close conversation' })).not.toBeInTheDocument()
  })

  it('does not offer to continue a conversation that has not started', async () => {
    render(
      <ChatTabs
        tabs={controller({ tabs: [tab({ started: false }), tab({ key: 'b', id: 'b' })] })}
      />
    )

    await openMenu()

    expect(
      screen.queryByRole('menuitem', { name: /Continue in a new conversation/ })
    ).not.toBeInTheDocument()
  })

  // A tab with no record has neither: there is nothing to continue and nothing
  // to close, so the trigger itself has no reason to be there.
  it('offers nothing at all for a conversation with no record', () => {
    render(
      <ChatTabs tabs={controller({ tabs: [tab({ key: 'first', id: null, record: null })] })} />
    )

    expect(screen.queryByRole('button', { name: 'Claude 1' })).not.toBeInTheDocument()
  })
})

describe('the history of closed conversations', () => {
  const closed = (id: string, preview: string): ClosedChat => ({
    chat: chat({ id, closedAt: '2026-08-20T10:00:00.000Z' }),
    closedAt: '2026-08-20T10:00:00.000Z',
    preview
  })

  const historyButton = (): HTMLElement =>
    screen.getByRole('button', { name: 'Closed conversations' })

  // Read when opened rather than kept live, because each entry costs a read of
  // its transcript.
  it('is read when it is opened', async () => {
    const user = userEvent.setup()
    const refreshHistory = vi.fn(() => Promise.resolve())
    render(<ChatTabs tabs={controller({ refreshHistory })} />)

    expect(refreshHistory).not.toHaveBeenCalled()
    await user.click(historyButton())

    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  it('names each conversation by what was said first', async () => {
    const user = userEvent.setup()
    render(
      <ChatTabs
        tabs={controller({
          history: [closed('chat-8', 'fix the login bug'), closed('chat-7', '')]
        })}
      />
    )

    await user.click(historyButton())

    expect(screen.getByRole('menuitem', { name: /fix the login bug/ })).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /Conversation with no messages/ })
    ).toBeInTheDocument()
  })

  it('brings one back when it is chosen', async () => {
    const user = userEvent.setup()
    const reopen = vi.fn(() => Promise.resolve())
    render(
      <ChatTabs tabs={controller({ history: [closed('chat-8', 'fix the login bug')], reopen })} />
    )

    await user.click(historyButton())
    await user.click(screen.getByRole('menuitem', { name: /fix the login bug/ }))

    expect(reopen).toHaveBeenCalledExactlyOnceWith('chat-8')
  })

  // Three tabs are open. The row says why it cannot be chosen rather than
  // failing after the click.
  it('cannot be chosen from while the strip is full, and says why', async () => {
    const user = userEvent.setup()
    const reopen = vi.fn(() => Promise.resolve())
    render(
      <ChatTabs
        tabs={controller({
          canCreate: false,
          history: [closed('chat-8', 'fix the login bug')],
          reopen
        })}
      />
    )

    await user.click(historyButton())

    expect(screen.getByText('Close a tab first — 3 are open')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /fix the login bug/ })).toBeDisabled()
  })

  it('says when there is nothing, and asks again if the row is chosen', async () => {
    const user = userEvent.setup()
    const refreshHistory = vi.fn(() => Promise.resolve())
    render(<ChatTabs tabs={controller({ refreshHistory })} />)

    await user.click(historyButton())
    refreshHistory.mockClear()
    await user.click(screen.getByRole('menuitem', { name: 'Nothing closed yet' }))

    expect(refreshHistory).toHaveBeenCalledOnce()
  })
})

describe('what the strip says once a transcript is copied', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function copy(copied: boolean): Promise<void> {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ChatTabs tabs={controller({ copyTranscript: vi.fn(() => Promise.resolve(copied)) })} />)

    await user.click(screen.getByRole('button', { name: 'Claude 1' }))
    await user.click(screen.getByRole('menuitem', { name: /Copy transcript/ }))
  }

  it('confirms it, aloud as well, and then goes back to being a menu', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await copy(true)

    expect(await screen.findByRole('status')).toHaveTextContent('Copied')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says it failed when the copy did not happen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await copy(false)

    expect(await screen.findByRole('status')).toHaveTextContent('Copy failed')
  })
})
