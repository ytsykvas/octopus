import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskView } from '@core/backgroundTasks.js'
import type { TasksEvent } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import { octopus } from '../test/octopus.js'
import { task } from '../test/tasks.js'
import { stopTask, useChatTasks, useMainWorking, useWorkspaceAgents } from './backgroundTasks.js'

function Chat({
  chatId,
  entries = []
}: {
  readonly chatId: string
  readonly entries?: readonly ChatEntry[]
}): React.JSX.Element {
  const tasks = useChatTasks(chatId, entries)
  seen.push(tasks)
  return (
    <p data-testid={chatId} data-status={tasks.map((each) => each.status).join(',')}>
      {tasks.map((each) => each.taskId).join(',')}
    </p>
  )
}

/** Every list the component was handed, render by render. */
const seen: (readonly TaskView[])[] = []

function MainWorking({ chatId }: { readonly chatId: string | null }): React.JSX.Element {
  return <p data-testid="main">{String(useMainWorking(chatId))}</p>
}

const started = (taskId: string): ChatEntry => ({
  role: 'agent',
  at: '2026-10-20T10:00:00.000Z',
  event: {
    type: 'task_started',
    taskId,
    toolUseId: `call-${taskId}`,
    kind: 'agent',
    description: taskId,
    backgrounded: true,
    ambient: false
  }
})

const said = (text: string): ChatEntry => ({
  role: 'agent',
  at: '2026-10-20T10:00:01.000Z',
  event: { type: 'text', text }
})

function Workspace({ workspaceId }: { readonly workspaceId: string }): React.JSX.Element {
  return <p data-testid={workspaceId}>{useWorkspaceAgents(workspaceId)}</p>
}

const event = (chatId: string, ...ids: string[]): TasksEvent => ({
  chatId,
  workspaceId: 'planner/anna',
  tasks: ids.map((taskId) => task({ taskId })),
  mainWorking: false
})

/** What the store gave the bridge, so a test can push through it. */
function pusher(): (event: TasksEvent) => void {
  const last = vi.mocked(octopus().tasks.onChanged).mock.calls.at(-1)
  if (!last) throw new Error('nothing subscribed')
  return last[0]
}

let release: () => void

beforeEach(() => {
  seen.length = 0
  release = vi.fn<() => void>()
  vi.mocked(octopus().tasks.onChanged).mockReturnValue(release)
})

describe('the window’s store of background tasks', () => {
  it('reads the list once and takes every push after it', async () => {
    vi.mocked(octopus().tasks.list).mockResolvedValue({ ok: true, value: [event('c-1', 'a')] })
    render(
      <>
        <Chat chatId="c-1" />
        <Chat chatId="c-2" />
      </>
    )

    expect(await screen.findByText('a')).toBeInTheDocument()
    expect(octopus().tasks.onChanged).toHaveBeenCalledOnce()

    act(() => {
      pusher()(event('c-2', 'b', 'c'))
    })
    expect(screen.getByTestId('c-2')).toHaveTextContent('b,c')
  })

  // A push says everything about its conversation, so a list that was asked
  // for earlier and lands later must not put back what the push replaced.
  it('lets a push win over a list that answers after it', async () => {
    let answer: (value: { ok: true; value: TasksEvent[] }) => void = () => undefined
    vi.mocked(octopus().tasks.list).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    render(<Chat chatId="c-1" />)

    act(() => {
      pusher()(event('c-1', 'fresh'))
    })
    await act(async () => {
      answer({ ok: true, value: [event('c-1', 'stale')] })
      await Promise.resolve()
    })

    expect(screen.getByTestId('c-1')).toHaveTextContent('fresh')
  })

  it('drops a conversation whose tasks are gone, and ignores a list that failed', async () => {
    vi.mocked(octopus().tasks.list).mockResolvedValue({ ok: false, error: 'x' } as never)
    render(<Chat chatId="c-1" />)
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      pusher()(event('c-1', 'a'))
    })
    act(() => {
      pusher()({ chatId: 'c-1', workspaceId: 'planner/anna', tasks: [], mainWorking: false })
    })

    expect(screen.getByTestId('c-1')).toHaveTextContent('')
  })

  // Read for conversations no pane has open: the workspace list is how a
  // reader learns there is work going on somewhere else.
  it('counts the agents at work in a workspace, and nothing else', () => {
    render(<Workspace workspaceId="planner/anna" />)

    act(() => {
      pusher()({
        chatId: 'c-1',
        workspaceId: 'planner/anna',
        tasks: [
          task(),
          task({ taskId: 'done', status: 'completed' }),
          task({ taskId: 'cmd', kind: 'shell' })
        ],
        mainWorking: false
      })
      pusher()({ chatId: 'c-2', workspaceId: 'planner/other', tasks: [task()], mainWorking: false })
    })

    expect(screen.getByTestId('planner/anna')).toHaveTextContent('1')
  })

  it('gives the bridge back with the last reader, and starts clean after', () => {
    const { unmount } = render(<Chat chatId="c-1" />)
    act(() => {
      pusher()(event('c-1', 'a'))
    })

    unmount()
    expect(release).toHaveBeenCalledOnce()

    render(<Chat chatId="c-1" />)
    expect(screen.getByTestId('c-1')).toHaveTextContent('')
  })

  it('keeps the bridge while another reader is still there', () => {
    const first = render(<Chat chatId="c-1" />)
    render(<Chat chatId="c-2" />)

    first.unmount()

    expect(release).not.toHaveBeenCalled()
  })

  // StrictMode subscribes twice, and a reader can leave before the list lands:
  // a list answering for a bridge given back must put nothing back.
  it('drops a list that answers after the bridge it was asked for went', async () => {
    let answer: (value: { ok: true; value: TasksEvent[] }) => void = () => undefined
    vi.mocked(octopus().tasks.list)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve
        })
      )
      .mockResolvedValue({ ok: true, value: [] })
    const { unmount } = render(<Chat chatId="c-1" />)
    unmount()

    render(<Chat chatId="c-1" />)
    await act(async () => {
      answer({ ok: true, value: [event('c-1', 'stale')] })
      await Promise.resolve()
    })

    expect(screen.getByTestId('c-1')).toHaveTextContent('')
  })

  // After a restart the core has nothing; the transcript remembers.
  it('adds what only the transcript remembers, cut off', () => {
    render(<Chat chatId="c-1" entries={[started('old')]} />)
    act(() => {
      pusher()(event('c-1', 'a'))
    })

    expect(screen.getByTestId('c-1')).toHaveTextContent('a,old')
    expect(screen.getByTestId('c-1')).toHaveAttribute('data-status', 'running,stopped')
  })

  // The log grows with every event; a list rebuilt for each would redraw every
  // row that reads it.
  it('keeps the same list while the log grows and no task moves', () => {
    const entries = [started('old')]
    const { rerender } = render(<Chat chatId="c-1" entries={entries} />)
    rerender(<Chat chatId="c-1" entries={[...entries, said('more')]} />)

    expect(seen.at(-1)).toBe(seen[0])
  })

  it('says whether the main agent is mid-turn, while there are tasks to ask about', () => {
    render(
      <>
        <MainWorking chatId="c-1" />
        <Chat chatId="c-1" />
      </>
    )
    expect(screen.getByTestId('main')).toHaveTextContent('undefined')

    act(() => {
      pusher()({ ...event('c-1', 'a'), mainWorking: true })
    })
    expect(screen.getByTestId('main')).toHaveTextContent('true')
  })

  it('says nothing about the main agent of a pane with no conversation', () => {
    render(<MainWorking chatId={null} />)
    expect(screen.getByTestId('main')).toHaveTextContent('undefined')
  })

  it('stops a task through the bridge', () => {
    stopTask('c-1', 't-1')
    expect(octopus().tasks.stop).toHaveBeenCalledWith('c-1', 't-1')
  })
})
