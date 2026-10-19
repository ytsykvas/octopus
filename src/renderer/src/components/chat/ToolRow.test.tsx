import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

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
      expansion: { all: true, generation: 1 }
    })

    expect(screen.getByRole('region', { name: 'Input' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Bash/ }))
    expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument()

    rerender({ all: true, generation: 2 })
    expect(screen.getByRole('region', { name: 'Input' })).toBeInTheDocument()

    rerender({ all: false, generation: 3 })
    expect(screen.queryByRole('region', { name: 'Input' })).not.toBeInTheDocument()
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
