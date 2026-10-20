import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TaskView } from '@core/backgroundTasks.js'

import { agentsOf, NOW, task } from '../../test/tasks.js'
import { AgentsContext } from './agentTasks.js'
import { readChange } from './changeSummary.js'
import { COLLAPSED, ExpandContext, type Expansion, FileLinkContext } from './expansion.js'
import type { ToolCall, ToolResult } from './logBlocks.js'
import { ToolRow } from './ToolRow.js'

// The highlighter loads grammars asynchronously; the rows read as plain text
// until it answers, which is all these tests look at.
vi.mock('../diff/highlight.js', () => ({ highlight: () => Promise.resolve(null) }))

const ROOT = '/tmp/planner/anna'

function called(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolUseId: 'c-1',
    name: 'Read',
    input: { file_path: `${ROOT}/src/App.tsx` },
    uuid: undefined,
    result: null,
    change: null,
    context: null,
    settled: false,
    steps: null,
    ...overrides
  }
}

function answer(overrides: Partial<ToolResult> = {}): ToolResult {
  return { type: 'tool_result', toolUseId: 'c-1', ok: true, content: 'fine', ...overrides }
}

function renderRow(
  call: ToolCall,
  { busy = false, expansion = COLLAPSED }: { busy?: boolean; expansion?: Expansion } = {}
): { onOpenFile: ReturnType<typeof vi.fn>; rerender: (next: Expansion) => void } {
  const onOpenFile = vi.fn()
  const tree = (value: Expansion): React.JSX.Element => (
    <ExpandContext.Provider value={value}>
      <FileLinkContext.Provider value={{ workspacePath: ROOT, onOpenFile }}>
        <ToolRow call={call} busy={busy} />
      </FileLinkContext.Provider>
    </ExpandContext.Provider>
  )
  const { rerender } = render(tree(expansion))

  return {
    onOpenFile,
    rerender: (next) => {
      rerender(tree(next))
    }
  }
}

const toggle = (): HTMLElement => screen.getByRole('button', { expanded: false })

describe('where a call is', () => {
  it('runs while the turn is live and nothing has come back', () => {
    renderRow(called(), { busy: true })
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  // Cut off by an interrupt: no answer, and no work either.
  it('says it got no answer once the turn has moved on', () => {
    renderRow(called({ settled: true }), { busy: true })
    expect(screen.getByText('No result — the turn ended first')).toBeInTheDocument()
  })

  it('says it got no answer when the turn is over', () => {
    renderRow(called())
    expect(screen.getByText('No result — the turn ended first')).toBeInTheDocument()
  })

  it('is done or failed once the tool answers', () => {
    renderRow(called({ result: answer() }))
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('shows the head of a failure under the row', () => {
    renderRow(called({ result: answer({ ok: false, content: 'no such file\nat line 3' }) }))

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/no such file/)).toHaveClass('font-mono')
  })
})

describe('the file a row names', () => {
  // As the right pane's tree opens one: a click previews, a second keeps it.
  it('opens in the centre, by the path the tabs know it by', async () => {
    const user = userEvent.setup()
    const { onOpenFile } = renderRow(called())

    await user.click(screen.getByRole('button', { name: 'src/App.tsx' }))
    expect(onOpenFile).toHaveBeenLastCalledWith('src/App.tsx', false)

    await user.dblClick(screen.getByRole('button', { name: 'src/App.tsx' }))
    expect(onOpenFile).toHaveBeenLastCalledWith('src/App.tsx', true)
  })

  it('is plain text when it is not a file of this workspace', () => {
    renderRow(called({ input: { file_path: '/etc/hosts' } }))

    expect(screen.getByText('/etc/hosts').tagName).toBe('SPAN')
    expect(screen.queryByRole('button', { name: '/etc/hosts' })).not.toBeInTheDocument()
  })

  // Opening the file is not opening the row.
  it('does not open the row when it is clicked', async () => {
    const user = userEvent.setup()
    renderRow(called())

    await user.click(screen.getByRole('button', { name: 'src/App.tsx' }))
    expect(screen.getByRole('button', { name: /Read/ })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('the line under a row', () => {
  it('counts what a search found', () => {
    renderRow(
      called({
        name: 'Grep',
        input: { pattern: 'x', path: 'src' },
        result: answer({ stats: { files: 2 } })
      })
    )

    expect(screen.getByText('"x"')).toBeInTheDocument()
    expect(screen.getByText('in src')).toBeInTheDocument()
    expect(screen.getByText('2 files')).toBeInTheDocument()
  })

  // The scope is a path, often absolute, so it has to give way like the target beside it.
  it('lets a long scope shrink instead of widening the row', () => {
    const path = '/Users/someone/workspaces/project/node_modules/package/dist/index.d.ts'
    renderRow(called({ name: 'Grep', input: { pattern: 'x', path } }))

    const scope = screen.getByText(`in ${path}`)
    expect(scope).toHaveClass('min-w-0', 'truncate')
    expect(scope).not.toHaveClass('shrink-0')
    expect(scope).toHaveAttribute('title', `in ${path}`)
  })

  // Cut on disk before the count was kept: all that is known is a floor.
  it('says the count is a floor when only the head was saved and not its length', () => {
    renderRow(called({ result: answer({ content: 'a\nb\nc', truncated: true }) }))
    expect(screen.getByText('at least 3 lines')).toBeInTheDocument()
  })

  // With the row closed, the latest step is the one sign that something is
  // happening inside a subagent.
  it('names a working subagent’s latest step', () => {
    const step = (at: number, name: string, input: unknown): ToolCall['steps'] => [
      { kind: 'tool', at, call: called({ toolUseId: `s-${String(at)}`, name, input }) }
    ]
    renderRow(
      called({ name: 'Agent', input: { description: 'Dig' }, steps: step(1, 'TodoWrite', {}) }),
      { busy: true }
    )
    expect(screen.getByTitle('TodoWrite')).toBeInTheDocument()
  })

  it('counts the matches of a search that counted them', () => {
    renderRow(
      called({
        name: 'Grep',
        input: { pattern: 'x' },
        result: answer({ stats: { files: 1, matches: 5 } })
      })
    )
    expect(screen.getByText('5 matches')).toBeInTheDocument()
  })

  it('says how much more there was than the head it shows', () => {
    const content = Array.from({ length: 9 }, (_, i) => `line ${String(i)}`).join('\n')
    renderRow(called({ name: 'Bash', input: { command: 'ls' }, result: answer({ content }) }))

    expect(screen.getByText('… +5 lines')).toBeInTheDocument()
  })

  it('says a command printed nothing', () => {
    renderRow(called({ name: 'Bash', input: { command: 'true' }, result: answer({ content: '' }) }))
    expect(screen.getByText('(no output)')).toBeInTheDocument()
  })

  it('gives the first line of a fetch', () => {
    renderRow(
      called({
        name: 'WebFetch',
        input: { url: 'https://example.com' },
        result: answer({ content: 'Fetched 3 KB' })
      })
    )
    expect(screen.getByText('Fetched 3 KB')).toBeInTheDocument()
  })

  it('says nothing more for a subagent that reported no counts', () => {
    renderRow(called({ name: 'Agent', input: { description: 'Dig' }, result: answer() }))
    expect(screen.queryByText(/tool use/)).not.toBeInTheDocument()
  })
})

describe('an opened row', () => {
  it('shows the whole command and what it printed', async () => {
    const user = userEvent.setup()
    renderRow(
      called({
        name: 'Bash',
        input: { command: 'npm test\nnpm run lint', description: 'Run tests' },
        result: answer({ content: 'all green' })
      })
    )

    expect(screen.getByText('npm test')).toHaveAttribute('title', 'Run tests')
    await user.click(toggle())

    expect(screen.getByRole('region', { name: 'Input' })).toHaveTextContent('npm run lint')
    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('all green')
  })

  it('shows the whole of a failure, not only its head', async () => {
    const user = userEvent.setup()
    const content = ['one', 'two', 'three', 'four', 'five'].join('\n')
    renderRow(called({ name: 'Edit', input: {}, result: answer({ ok: false, content }) }))

    await user.click(toggle())
    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('five')
  })

  // ⌘O opens every row; a row closed by hand afterwards stays closed only
  // until the next press — that is what "show everything" means.
  it('follows the log’s “show everything”, and a click after it', async () => {
    const user = userEvent.setup()
    const { rerender } = renderRow(called({ name: 'Bash', input: { command: 'ls' } }), {
      expansion: { ...COLLAPSED, all: true, generation: 1 }
    })

    expect(screen.getByRole('region', { name: 'Input' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Bash/ }))
    expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument()

    rerender({ ...COLLAPSED, all: true, generation: 2 })
    expect(screen.getByRole('region', { name: 'Input' })).toBeInTheDocument()

    rerender({ ...COLLAPSED, all: false, generation: 3 })
    expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument()
  })

  /*
   * "Show in conversation" opens the rows above a nested agent, and only
   * those, without touching a choice the reader made elsewhere — and a click
   * afterwards still works on the row it hits.
   */
  it('opens when a reveal names it, and a click after it still counts', async () => {
    const user = userEvent.setup()
    const call = called({ toolUseId: 'c-1', name: 'Bash', input: { command: 'ls' } })
    const { rerender } = renderRow(call)
    expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument()

    rerender({ ...COLLAPSED, reveal: new Set(['other']), revealed: 1 })
    expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument()

    rerender({ ...COLLAPSED, reveal: new Set(['c-1']), revealed: 2 })
    expect(screen.getByRole('region', { name: 'Input' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Bash/ }))
    expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument()

    rerender({ ...COLLAPSED, reveal: new Set(['c-1']), revealed: 3 })
    expect(screen.getByRole('region', { name: 'Input' })).toBeInTheDocument()
  })
})

describe('a change', () => {
  const edit = {
    file_path: `${ROOT}/a.ts`,
    old_string: 'one',
    new_string: Array.from({ length: 14 }, (_, i) => `line ${String(i)}`).join('\n')
  }

  it('draws its first lines under the row, and all of them when opened', async () => {
    const user = userEvent.setup()
    renderRow(called({ name: 'Edit', input: edit, change: readChange('Edit', edit) }))

    expect(screen.getByText('+14')).toBeInTheDocument()
    expect(screen.getByText('5 more lines')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Edit/ }))
    expect(screen.queryByText(/more lines/)).not.toBeInTheDocument()
    expect(screen.getByText('line 13')).toBeInTheDocument()
  })

  // It changed nothing, and the failure says why.
  it('draws no diff for an edit that failed', () => {
    renderRow(
      called({
        name: 'Edit',
        input: edit,
        change: readChange('Edit', edit),
        result: answer({ ok: false, content: 'old_string not found' })
      })
    )

    expect(screen.queryByText('line 0')).not.toBeInTheDocument()
    expect(screen.getByText(/old_string not found/)).toBeInTheDocument()
  })
})

describe('a subagent’s row', () => {
  it('shows its text along the way as one line, and nothing of its other events', async () => {
    const user = userEvent.setup()
    renderRow(
      called({
        name: 'Agent',
        input: { description: 'Dig' },
        result: answer({ report: 'Done digging.' }),
        steps: [
          { kind: 'entry', at: 1, entry: { role: 'user', at: '', text: 'never drawn' } },
          {
            kind: 'entry',
            at: 2,
            entry: { role: 'agent', at: '', event: { type: 'thinking', text: 'hmm' } }
          },
          {
            kind: 'entry',
            at: 3,
            entry: { role: 'agent', at: '', event: { type: 'text', text: 'Found\nmore' } }
          }
        ]
      })
    )

    await user.click(toggle())

    expect(screen.getByText('Found')).toBeInTheDocument()
    expect(screen.queryByText('hmm')).not.toBeInTheDocument()
    expect(screen.queryByText('never drawn')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Report' })).toHaveTextContent('Done digging.')
  })
})

/*
 * A call that started a background task answers at once — `async_launched` —
 * and goes on working. The row follows the task rather than the answer.
 */
describe('a row that started a background task', () => {
  const launched = answer({ content: 'Async agent launched', stats: { background: true } })

  function renderTask(
    current: TaskView,
    call: ToolCall = called({
      name: 'Agent',
      input: { description: 'Audit', prompt: 'p' },
      toolUseId: 'call-1',
      result: launched
    })
  ): void {
    render(
      <AgentsContext.Provider value={agentsOf([current])}>
        <ToolRow call={call} busy={false} />
      </AgentsContext.Provider>
    )
  }

  it('spins while the task works, saying what it is doing, its model and its time', () => {
    vi.useFakeTimers({ now: NOW })
    renderTask(task())
    vi.useRealTimers()

    expect(screen.getByText('Running', { selector: '.sr-only' })).toBeInTheDocument()
    expect(screen.getByText('Reading src/routes/auth.ts')).toBeInTheDocument()
    expect(screen.getByText('Haiku 5.5 · 1:42 · 18k tokens')).toBeInTheDocument()
  })

  // Nothing from the CLI yet: its own latest step in the log, then the plain fact.
  it('falls back to the latest step, and then to saying it works in the background', () => {
    renderTask(
      task({ activity: null, model: null, tokens: 0 }),
      called({
        name: 'Agent',
        toolUseId: 'call-1',
        result: launched,
        steps: [
          {
            kind: 'tool',
            at: 1,
            call: called({ toolUseId: 's-1', name: 'Grep', input: { pattern: 'auth' } })
          },
          {
            kind: 'tool',
            at: 2,
            call: called({ toolUseId: 's-2', name: 'TodoWrite', input: { todos: [] } })
          }
        ]
      })
    )
    expect(screen.getByText(/^TodoWrite|Update todos/)).toBeInTheDocument()
  })

  it('names the latest step with what it acted on', () => {
    renderTask(
      task({ activity: null }),
      called({
        name: 'Agent',
        toolUseId: 'call-1',
        result: launched,
        steps: [
          {
            kind: 'tool',
            at: 1,
            call: called({ toolUseId: 's-1', name: 'Read', input: { file_path: 'src/a.ts' } })
          }
        ]
      })
    )
    expect(screen.getByText(/src\/a\.ts$/)).toBeInTheDocument()
  })

  it('says it works in the background with nothing else to say', () => {
    renderTask(task({ activity: null }))
    expect(screen.getByText('Running in the background')).toBeInTheDocument()
  })

  it('says it is waiting on an answer', () => {
    renderTask(task({ waiting: true }))
    expect(screen.getAllByText('Needs your answer')).not.toHaveLength(0)
  })

  it('says how it ended and how many calls it took', () => {
    renderTask(task({ status: 'completed', toolUses: 5, durationMs: 12_000 }))

    expect(screen.getByText('Done · 5 tool calls')).toBeInTheDocument()
    expect(screen.getByText('Haiku 5.5 · 0:12 · 18k tokens')).toBeInTheDocument()
    expect(screen.getByText('Done', { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('says a failure and a stop in their own words', () => {
    renderTask(task({ status: 'failed', toolUses: 0 }))
    expect(screen.getAllByText('Failed')).toHaveLength(2)
  })

  it('says a stopped task was stopped', () => {
    renderTask(task({ status: 'stopped', toolUses: 0 }))
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  // A foreground subagent's call came back with the work: the row says what
  // came back, as any call does, and the task adds only its model and time.
  it('says what a foreground agent came back with once it is over', () => {
    renderTask(
      task({ status: 'completed', backgrounded: false, durationMs: 12_000 }),
      called({
        name: 'Agent',
        input: { description: 'Audit', prompt: 'p' },
        toolUseId: 'call-1',
        result: answer({ content: 'All read.', stats: { toolUses: 4 } })
      })
    )

    expect(screen.getByText('4 tool uses')).toBeInTheDocument()
    expect(screen.queryByText(/^Done ·/)).not.toBeInTheDocument()
    expect(screen.getByText('Haiku 5.5 · 0:12 · 18k tokens')).toBeInTheDocument()
  })

  // Its steps run on after the turn that started it, so a step without an
  // answer yet is under way rather than cut off.
  it('draws the steps of an agent still at work as running', async () => {
    const user = userEvent.setup()
    renderTask(
      task(),
      called({
        name: 'Agent',
        input: { description: 'Audit', prompt: 'p' },
        toolUseId: 'call-1',
        result: launched,
        steps: [
          {
            kind: 'tool',
            at: 1,
            call: called({ toolUseId: 's-1', name: 'Grep', input: { pattern: 'auth' } })
          }
        ]
      })
    )

    await user.click(screen.getByRole('button', { name: /Agent/ }))

    expect(screen.getAllByText('Running', { selector: '.sr-only' })).toHaveLength(2)
  })

  // A launch the CLI refused is a failure of the call, whatever the task says.
  it('reads a failed call as failed', () => {
    renderTask(
      task(),
      called({
        name: 'Agent',
        toolUseId: 'call-1',
        result: answer({ ok: false, content: 'Concurrent subagent limit reached' })
      })
    )
    expect(screen.getByText('Failed', { selector: '.sr-only' })).toBeInTheDocument()
  })
})
