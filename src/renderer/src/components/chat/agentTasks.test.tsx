import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { TaskView } from '@core/backgroundTasks.js'

import { agentsOf, task } from '../../test/tasks.js'
import {
  AgentsContext,
  createAgentsStore,
  useAgentTasks,
  useMenuTasks,
  useTaskById,
  useTaskFor
} from './agentTasks.js'

const reading = task({ taskId: 't-1', toolUseId: 'call-1', activity: 'Reading' })
const writing = task({ taskId: 't-2', toolUseId: 'call-2', activity: 'Writing' })

describe('the store the pane publishes into', () => {
  it('tells its readers when the list moves, and not when the same list is published again', () => {
    const store = createAgentsStore()
    const reader = vi.fn()
    store.subscribe(reader)

    const list = [reading]
    store.publish(list)
    store.publish(list)

    expect(reader).toHaveBeenCalledTimes(1)
    expect(store.read().tasks).toBe(list)
    expect(store.read().byToolUse.get('call-1')).toBe(reading)
    expect(store.read().byId.get('t-1')).toBe(reading)
  })

  // Clearing moves the menu alone: the log's list is the same object throughout.
  it('tells its readers when only the menu moves', () => {
    const store = createAgentsStore()
    const reader = vi.fn()
    store.subscribe(reader)

    const list = [reading, writing]
    store.publish(list)
    store.publish(list, [writing])

    expect(reader).toHaveBeenCalledTimes(2)
    expect(store.read().tasks).toBe(list)
    expect(store.read().menu).toEqual([writing])
  })

  it('stops telling a reader that left', () => {
    const store = createAgentsStore()
    const reader = vi.fn()
    const leave = store.subscribe(reader)

    leave()
    store.publish([reading])

    expect(reader).not.toHaveBeenCalled()
  })
})

/*
 * Progress arrives for every working agent up to five times a second, and each
 * arrival used to redraw every tool row in the log. A row now takes its own
 * task from the store, and is left alone while only another one moves.
 */
describe('a row reading its own task', () => {
  function Row({ toolUseId, drawn }: { toolUseId: string; drawn: () => void }): React.JSX.Element {
    drawn()
    const task = useTaskFor(toolUseId)
    return <span>{task?.activity ?? 'no task'}</span>
  }

  it('is drawn again when its task moves, and not when another does', () => {
    const store = createAgentsStore()
    store.publish([reading, writing])
    const drawn = vi.fn()
    render(
      <AgentsContext.Provider value={{ ...agentsOf([]), store }}>
        <Row toolUseId="call-1" drawn={drawn} />
      </AgentsContext.Provider>
    )
    expect(screen.getByText('Reading')).toBeInTheDocument()
    const before = drawn.mock.calls.length

    act(() => {
      store.publish([reading, { ...writing, activity: 'Still writing' }])
    })
    expect(drawn.mock.calls.length).toBe(before)

    act(() => {
      store.publish([{ ...reading, activity: 'Editing' }, writing])
    })
    expect(screen.getByText('Editing')).toBeInTheDocument()
    expect(drawn.mock.calls.length).toBeGreaterThan(before)
  })

  it('has no task for a call that started none', () => {
    const { result } = renderHook(() => useTaskFor('call-9'), {
      wrapper: ({ children }) => (
        <AgentsContext.Provider value={agentsOf([reading])}>{children}</AgentsContext.Provider>
      )
    })

    expect(result.current).toBeNull()
  })
})

describe('the other readings', () => {
  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <AgentsContext.Provider value={agentsOf([reading, writing])}>{children}</AgentsContext.Provider>
  )

  it('hand over every task, the menu, and one by its id', () => {
    const all = renderHook(() => useAgentTasks(), { wrapper })
    const menu = renderHook(() => useMenuTasks(), { wrapper })
    const one = renderHook(() => useTaskById('t-2'), { wrapper })
    const none = renderHook(() => useTaskById(null), { wrapper })

    expect(all.result.current).toEqual([reading, writing] satisfies readonly TaskView[])
    expect(menu.result.current).toEqual([reading, writing])
    expect(one.result.current).toBe(writing)
    expect(none.result.current).toBeUndefined()
  })
})
