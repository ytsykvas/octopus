import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BranchRequest } from '@core/pullRequestShapes.js'
import type { ResourceReading } from '@core/resources.js'
import type { Project } from '@core/store.js'
import type { WorkspaceChat, WorkspaceView } from '@core/workspaces.js'

import { workspaceView } from '../../test/workspaces.js'
import { StatusBar } from './StatusBar.js'

const PLANNER = { id: 'planner', name: 'planner', color: 'blue' } as Project

const chat = (overrides: Partial<WorkspaceChat> = {}): WorkspaceChat => ({
  id: 'c-1',
  agent: 'claude',
  title: null,
  status: 'idle',
  started: true,
  turnStartedAt: null,
  ...overrides
})

const request = (overrides: Partial<BranchRequest> = {}): BranchRequest => ({
  branch: 'ytsykvas/anna',
  number: 812,
  state: 'open',
  checks: 'passed',
  url: 'https://e.test/812',
  draft: false,
  decision: null,
  mergeable: 'mergeable',
  mergeState: 'clean',
  ...overrides
})

interface Setup {
  readonly open?: boolean
  readonly workspaces?: readonly WorkspaceView[]
  readonly requests?: readonly BranchRequest[]
  readonly resources?: ResourceReading | null
  readonly front?: { readonly workspace: WorkspaceView; readonly chatId: string } | null
}

function renderBar(setup: Setup = {}): {
  onToggle: ReturnType<typeof vi.fn>
  onOpen: ReturnType<typeof vi.fn>
  rerender: (next: Partial<Setup>) => void
} {
  const onToggle = vi.fn()
  const onOpen = vi.fn()
  const { resources = null } = setup
  // The bar takes its own reading; null is one that has not landed yet.
  vi.mocked(window.octopus.resources.read).mockReturnValue(
    resources === null
      ? new Promise(() => undefined)
      : Promise.resolve({ ok: true, value: resources })
  )
  const bar = ({
    open = true,
    workspaces = [],
    requests = [],
    front = null
  }: Setup): React.JSX.Element => (
    <StatusBar
      open={open}
      onToggle={onToggle}
      projects={[PLANNER]}
      workspaces={workspaces}
      requests={new Map([['planner', new Map(requests.map((item) => [item.branch, item]))]])}
      front={front}
      onOpen={onOpen}
    />
  )
  const { rerender } = render(bar(setup))
  return {
    onToggle,
    onOpen,
    rerender: (next) => {
      rerender(bar({ ...setup, ...next }))
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('folding the bar away', () => {
  it('leaves only the chevron that brings it back', async () => {
    const { onToggle } = renderBar({ open: false })

    expect(screen.queryByRole('contentinfo')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show the status bar' }))

    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('folds from the chevron at its right end', async () => {
    const { onToggle } = renderBar()

    await userEvent.click(screen.getByRole('button', { name: 'Hide the status bar' }))

    expect(onToggle).toHaveBeenCalledWith(false)
  })
})

describe('the agents across every project', () => {
  const anna = workspaceView('anna', {
    status: 'waiting_permission',
    chats: [chat({ id: 'c-2', status: 'waiting_permission' })]
  })
  const bob = workspaceView('bob', { status: 'running', chats: [chat({ status: 'running' })] })

  it('counts who is working and who is waiting', () => {
    renderBar({ workspaces: [anna, bob] })

    expect(screen.getByRole('button', { name: '1 working' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 waiting' })).toBeInTheDocument()
  })

  it('opens the waiting conversation from its row and closes the list behind it', async () => {
    const { onOpen } = renderBar({ workspaces: [anna, bob] })

    await userEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    const list = screen.getByRole('dialog', { name: 'Waiting on you' })
    await userEvent.click(within(list).getByRole('button', { name: /planner · anna/ }))

    expect(onOpen).toHaveBeenCalledWith({
      projectId: 'planner',
      workspaceId: anna.id,
      chatId: 'c-2'
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says so when nobody is working', async () => {
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: '0 working' }))

    expect(screen.getByRole('dialog', { name: 'Agents at work' })).toHaveTextContent(
      'No agent is working.'
    )
  })
})

describe('the pull requests of our workspaces', () => {
  const anna = workspaceView('anna')
  const bob = workspaceView('bob')
  const cleo = workspaceView('cleo')

  const requests = [
    request({ checks: 'failed', decision: 'changesRequested' }),
    request({ branch: 'ytsykvas/bob', number: 813 }),
    request({ branch: 'ytsykvas/cleo', number: 814, checks: 'running' })
  ]

  it('counts the open ones, those that need action and those ready to merge', () => {
    renderBar({ workspaces: [anna, bob, cleo], requests })

    expect(screen.getByRole('button', { name: /3 pull requests/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 needs action/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 ready to merge/ })).toBeInTheDocument()
  })

  it('says what stands in the way, and opens the request pane from the row', async () => {
    const { onOpen } = renderBar({ workspaces: [anna, bob, cleo], requests })

    await userEvent.click(screen.getByRole('button', { name: /1 needs action/ }))
    const row = within(
      screen.getByRole('dialog', { name: 'Pull requests that need action' })
    ).getByRole('button')

    expect(row).toHaveTextContent('#812 · a check failed, changes requested')
    await userEvent.click(row)
    expect(onOpen).toHaveBeenCalledWith({
      projectId: 'planner',
      workspaceId: anna.id,
      pullRequest: true
    })
  })

  it('marks one still under way as in progress and a ready one by its number alone', async () => {
    renderBar({ workspaces: [anna, bob, cleo], requests })

    await userEvent.click(screen.getByRole('button', { name: /3 pull requests/ }))
    const rows = within(screen.getByRole('dialog', { name: 'Open pull requests' })).getAllByRole(
      'button'
    )

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('#812 · a check failed'),
      expect.stringMatching(/#813$/),
      expect.stringContaining('#814 · In progress')
    ])
  })

  it('names a conflict', async () => {
    renderBar({ workspaces: [anna], requests: [request({ mergeable: 'conflicting' })] })

    await userEvent.click(screen.getByRole('button', { name: /1 needs action/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('merge conflict')
  })
})

describe('the turn under way', () => {
  it('counts from when the turn in front began', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T09:01:05.000Z'))
    const anna = workspaceView('anna', {
      chats: [chat({ status: 'running', turnStartedAt: '2026-10-20T09:00:00.000Z' })]
    })

    renderBar({ workspaces: [anna], front: { workspace: anna, chatId: 'c-1' } })

    expect(screen.getByRole('timer')).toHaveTextContent('Claude 1 · 1m 5s')
  })

  // Its own clock, a second at a time — and still counting while the turn is
  // stopped on a question, which is part of the turn.
  it('goes on counting while it waits on an answer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T09:00:05.000Z'))
    const anna = workspaceView('anna', {
      chats: [chat({ status: 'waiting_permission', turnStartedAt: '2026-10-20T09:00:00.000Z' })]
    })
    renderBar({ workspaces: [anna], front: { workspace: anna, chatId: 'c-1' } })
    expect(screen.getByRole('timer')).toHaveTextContent('Claude 1 · 5s')

    await act(() => vi.advanceTimersByTimeAsync(2000))

    expect(screen.getByRole('timer')).toHaveTextContent('Claude 1 · 7s')
  })

  it('says nothing between turns', () => {
    const anna = workspaceView('anna', { chats: [chat({ turnStartedAt: null })] })

    renderBar({ workspaces: [anna], front: { workspace: anna, chatId: 'c-1' } })

    expect(screen.queryByRole('timer')).toBeNull()
  })

  // The bar has a clock of its own for the machine's reading; this is about
  // the one the turn adds, which used to tick every second for a line drawing
  // nothing.
  it('sets no clock between turns', () => {
    vi.useFakeTimers()
    const idle = workspaceView('anna', { chats: [chat({ turnStartedAt: null })] })
    const busy = workspaceView('anna', {
      chats: [chat({ status: 'running', turnStartedAt: '2026-10-20T09:00:00.000Z' })]
    })
    // Measured against a bar with nothing in front, so a clock the idle line
    // kept for itself counts as one too many rather than as the baseline.
    const { rerender } = renderBar({ workspaces: [idle] })
    const none = vi.getTimerCount()

    rerender({ front: { workspace: idle, chatId: 'c-1' } })
    expect(vi.getTimerCount()).toBe(none)

    rerender({ workspaces: [busy], front: { workspace: busy, chatId: 'c-1' } })
    expect(vi.getTimerCount()).toBe(none + 1)

    rerender({ workspaces: [idle], front: { workspace: idle, chatId: 'c-1' } })
    expect(vi.getTimerCount()).toBe(none)
  })

  // A clock started when the bar mounted would count this turn from a stale
  // now: zero for a second, then the truth.
  it('starts from the right time when it switches to a turn already under way', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T09:00:00.000Z'))
    const anna = workspaceView('anna', { chats: [chat({ turnStartedAt: null })] })
    const bob = workspaceView('bob', {
      chats: [chat({ status: 'running', turnStartedAt: '2026-10-20T09:00:00.000Z' })]
    })
    const { rerender } = renderBar({
      workspaces: [anna, bob],
      front: { workspace: anna, chatId: 'c-1' }
    })

    vi.setSystemTime(new Date('2026-10-20T09:05:00.000Z'))
    rerender({ front: { workspace: bob, chatId: 'c-1' } })

    expect(screen.getByRole('timer')).toHaveTextContent('Claude 1 · 5m 0s')
  })

  // A turn that failed has a start the core may not have cleared yet; the
  // count would go on climbing over a conversation that has stopped.
  it('says nothing for a conversation that has stopped, whatever start it holds', () => {
    const anna = workspaceView('anna', {
      chats: [chat({ status: 'error', turnStartedAt: '2026-10-20T09:00:00.000Z' })]
    })

    renderBar({ workspaces: [anna], front: { workspace: anna, chatId: 'c-1' } })

    expect(screen.queryByRole('timer')).toBeNull()
  })
})

describe('what the machine is paying', () => {
  const anna = workspaceView('anna')
  const reading: ResourceReading = {
    total: { cpu: 40, memory: 3 * 1024 ** 3 },
    app: { cpu: 5, memory: 512 * 1024 ** 2 },
    parts: [
      { workspaceId: anna.id, kind: 'agent', cpu: 15, memory: 400 * 1024 ** 2 },
      { workspaceId: anna.id, kind: 'server', cpu: 20, memory: 800 * 1024 ** 2 },
      // A workspace removed since the reading was taken.
      { workspaceId: 'planner/gone', kind: 'terminal', cpu: 0, memory: 1024 }
    ]
  }

  it('says it is measuring before the first reading lands', () => {
    renderBar()

    expect(screen.getByRole('button', { name: 'Measuring…' })).toBeInTheDocument()
  })

  it('totals the tree, then breaks it down by workspace with the application last', async () => {
    const { onOpen } = renderBar({ workspaces: [anna], resources: reading })

    await userEvent.click(await screen.findByRole('button', { name: /^CPU 40%/ }))
    const list = screen.getByRole('dialog', { name: 'What octopus is using' })
    const items = within(list).getAllByRole('listitem')

    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('planner · anna')
    expect(items[0]).toHaveTextContent('agent')
    expect(items[0]).toHaveTextContent('server')
    // The application is somewhere to read about, not somewhere to go.
    expect(items[1]).toHaveTextContent('octopus itself')
    expect(within(items[1]!).queryByRole('button')).toBeNull()

    await userEvent.click(within(items[0]!).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith({ projectId: 'planner', workspaceId: anna.id })
  })
})

// A project removed while its last reading was in flight leaves a workspace
// with no project to name; the row still says which workspace it was.
it('names a workspace by itself when its project has gone', async () => {
  const orphan = workspaceView('anna', { projectId: 'gone', status: 'running' })
  renderBar({ workspaces: [orphan] })

  await userEvent.click(screen.getByRole('button', { name: '1 working' }))

  expect(within(screen.getByRole('dialog')).getByRole('button')).toHaveTextContent(/^anna/)
})
