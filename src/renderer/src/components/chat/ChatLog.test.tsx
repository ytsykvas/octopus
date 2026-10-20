import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TaskView } from '@core/backgroundTasks.js'
import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { agentsOf, task } from '../../test/tasks.js'
import { highlight } from '../diff/highlight.js'
import { AgentsContext } from './agentTasks.js'
import { ChatLog } from './ChatLog.js'
import { COLLAPSED } from './expansion.js'

// Stood in for, as every pane that colours code is tested: the real one loads a
// grammar, and its answer would land after the test that drew the card.
vi.mock('../diff/highlight.js', () => ({ highlight: vi.fn(() => Promise.resolve(null)) }))

const AT = '2026-08-11T09:00:00.000Z'

function fromAgent(event: AgentEvent): ChatEntry {
  return { role: 'agent', at: AT, event }
}

/** No message held in the agent's queue, which is every log but one. */
const NOT_WAITING: ReadonlySet<string> = new Set()

/** No question open, which is every log but the ones about questions. */
const NOTHING_ASKED: ReadonlySet<string> = new Set()

/**
 * The turn a footer closes.
 *
 * A footer at the head of the log draws nothing — it closes a turn the log does
 * not have, which is what `/clear` used to leave behind — so a test about what
 * a footer says has to give it a turn to be the footer of.
 */
const TURN: ChatEntry = fromAgent({ type: 'text', text: 'that is done' })

/**
 * A line of a drawn change as it reads: its number, its sign and its text.
 * Found by the text, which is a span of its own beside the gutter.
 */
function diffRow(text: string): string {
  return screen.getByText(text).closest('div')?.textContent ?? ''
}

/** The checkout the agent works in, which the paths in these fixtures sit under. */
const WORKSPACE = '/tmp/planner/anna'

function renderLog({
  pendingRequestId = null,
  tasks = [],
  ...overrides
}: Partial<React.ComponentProps<typeof ChatLog>> & {
  /** The one question open, for the tests about one. */
  readonly pendingRequestId?: string | null
  readonly tasks?: readonly TaskView[]
} = {}): {
  onAnswer: ReturnType<typeof vi.fn>
  onAnswerElicitation: ReturnType<typeof vi.fn>
  onAnswerQuestions: ReturnType<typeof vi.fn>
  onExecutePlan: ReturnType<typeof vi.fn>
  onRewind: ReturnType<typeof vi.fn>
  onOpenFile: ReturnType<typeof vi.fn>
} {
  const onOpenFile = vi.fn()
  const onAnswer = vi.fn()
  const onAnswerElicitation = vi.fn()
  const onAnswerQuestions = vi.fn()
  const onExecutePlan = vi.fn()
  const onRewind = vi.fn()

  render(
    <AgentsContext.Provider value={agentsOf(tasks)}>
      <ChatLog
        entries={[]}
        streaming={{ text: '', thinking: '' }}
        busy={false}
        answerable={pendingRequestId === null ? NOTHING_ASKED : new Set([pendingRequestId])}
        pendingElicitationId={null}
        onAnswer={onAnswer}
        onAnswerElicitation={onAnswerElicitation}
        onAnswerQuestions={onAnswerQuestions}
        onExecutePlan={onExecutePlan}
        onRewind={onRewind}
        waiting={NOT_WAITING}
        expansion={COLLAPSED}
        workspacePath={WORKSPACE}
        onOpenFile={onOpenFile}
        {...overrides}
      />
    </AgentsContext.Provider>
  )

  return { onAnswer, onAnswerElicitation, onAnswerQuestions, onExecutePlan, onRewind, onOpenFile }
}

describe('a subagent’s work', () => {
  const TASK = 'toolu_task'

  const entries: ChatEntry[] = [
    fromAgent({
      type: 'tool_use',
      toolUseId: TASK,
      name: 'Task',
      input: { description: 'Look around' }
    }),
    fromAgent({
      type: 'tool_use',
      toolUseId: 'r-1',
      name: 'Grep',
      input: { pattern: 'TODO' },
      parentToolUseId: TASK
    }),
    fromAgent({
      type: 'text',
      text: 'Three matches in auth.rb.\nNothing else.',
      parentToolUseId: TASK
    }),
    fromAgent({
      type: 'tool_result',
      toolUseId: 'r-1',
      ok: false,
      content: 'no such directory',
      parentToolUseId: TASK
    }),
    fromAgent({ type: 'thinking', text: 'Let me think.', parentToolUseId: TASK }),
    fromAgent({
      type: 'tool_result',
      toolUseId: 'r-2',
      ok: true,
      content: 'fine',
      parentToolUseId: TASK
    })
  ]

  it('is one row for the call that started it, closed', () => {
    renderLog({ entries })

    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('Look around')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Task/ })).toHaveAttribute('aria-expanded', 'false')
    // Inside the closed row: there for whoever opens it.
    expect(screen.queryByText('Grep')).not.toBeInTheDocument()
  })

  it('shows what it did and said when opened, with the same rows', async () => {
    const user = userEvent.setup()
    renderLog({ entries })

    await user.click(screen.getByRole('button', { name: /Task/ }))

    expect(screen.getByText('Grep')).toBeVisible()
    expect(screen.getByText('"TODO"')).toBeVisible()
    // One line of what it said; the whole answer is the report.
    expect(screen.getByText('Three matches in auth.rb.')).toBeVisible()
    expect(screen.queryByText(/Nothing else/)).not.toBeInTheDocument()
    // Its failure under its own row, as every failure is.
    expect(screen.getByText(/no such directory/)).toBeVisible()
    // Its reasoning stays its own.
    expect(screen.queryByText('Let me think.')).not.toBeInTheDocument()
  })

  it('does not draw them again at the top level', () => {
    renderLog({ entries })

    expect(screen.queryByText('Grep')).not.toBeInTheDocument()
    expect(screen.queryByText('Three matches in auth.rb.')).not.toBeInTheDocument()
  })

  // Its own words, without the trailer the CLI appends to the result for the
  // model — the agent's id and a usage block.
  it('ends with the subagent’s report once it has answered', async () => {
    const user = userEvent.setup()
    renderLog({
      entries: [
        ...entries,
        fromAgent({
          type: 'tool_result',
          toolUseId: TASK,
          ok: true,
          content: 'It is **fixed**.\nagentId: a-1',
          report: 'It is **fixed**.',
          stats: { toolUses: 3 }
        })
      ]
    })

    expect(screen.getByText('3 tool uses')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Task/ }))

    expect(screen.getByRole('region', { name: 'Report' })).toHaveTextContent('It is fixed.')
    expect(screen.getByText('fixed').tagName).toBe('STRONG')
    expect(screen.queryByText(/agentId/)).not.toBeInTheDocument()
  })

  it('says a subagent sent off on its own is running in the background', () => {
    renderLog({
      entries: [
        entries[0] ?? fromAgent({ type: 'text', text: '' }),
        fromAgent({
          type: 'tool_result',
          toolUseId: TASK,
          ok: true,
          content: 'Launched',
          stats: { background: true }
        })
      ]
    })

    expect(screen.getByText('Running in the background')).toBeInTheDocument()
  })

  // With the row closed, the latest step is the one sign that something is
  // happening inside it.
  it('names its latest step while it is still working', () => {
    renderLog({ entries: entries.slice(0, 2), busy: true })

    expect(screen.getByText(/Grep/)).toBeInTheDocument()
  })

  it('nests one subagent inside another', async () => {
    const user = userEvent.setup()
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: TASK,
          name: 'Task',
          input: { description: 'Look around' }
        }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'inner',
          name: 'Task',
          input: { description: 'Dig' },
          parentToolUseId: TASK
        }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'g-1',
          name: 'Read',
          input: { file_path: '/deep.ts' },
          parentToolUseId: 'inner'
        })
      ]
    })

    await user.click(screen.getByRole('button', { name: /Task/ }))
    const [, inner] = screen.getAllByRole('button', { name: /Task/ })
    if (inner) await user.click(inner)

    expect(screen.getByText('/deep.ts')).toBeVisible()
  })
})

describe('a plan the user rewrote', () => {
  // What the agent was actually told to do, named so it is not mistaken for the
  // one it wrote above — and carried out from here like any other.
  it('is drawn as the plan it is, under its own name', async () => {
    const user = userEvent.setup()
    const { onExecutePlan } = renderLog({
      entries: [fromAgent({ type: 'plan_edited', plan: '# Only the tests' })]
    })

    expect(screen.getByText('Plan, as you edited it')).toBeInTheDocument()
    expect(screen.getByText('Only the tests')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Execute' }))
    expect(onExecutePlan).toHaveBeenCalledExactlyOnceWith('# Only the tests')
  })
})

// Kyiv time (`vitest.shared.ts`): 09:00 UTC on 11 August is noon there.
describe('when things were said', () => {
  it('writes the hour under a message, with the whole moment on hover', () => {
    renderLog({ entries: [{ role: 'user', at: AT, text: 'rename the helper' }] })

    const time = screen.getByText('12:00')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('dateTime', AT)
    expect(time).toHaveAttribute('title', expect.stringContaining('11 August 2026'))
  })

  it('marks where each day begins, and only there', () => {
    renderLog({
      entries: [
        { role: 'user', at: '2025-03-02T09:00:00.000Z', text: 'first' },
        { role: 'agent', at: '2025-03-02T09:01:00.000Z', event: { type: 'text', text: 'on it' } },
        { role: 'user', at: '2025-03-02T10:00:00.000Z', text: 'same day' },
        { role: 'user', at: '2025-03-04T09:00:00.000Z', text: 'two days on' }
      ]
    })

    const days = document.querySelectorAll('[data-day]')
    expect([...days].map((day) => day.getAttribute('data-day'))).toEqual([
      '2025-03-02',
      '2025-03-04'
    ])
    // Another year than the reader's, so the year is written out.
    expect(screen.getByText('2 March 2025')).toBeInTheDocument()
    expect(screen.getByText('4 March 2025')).toBeInTheDocument()
  })
})

describe('a message the agent has not taken yet', () => {
  const MESSAGE = '22222222-2222-4222-8222-222222222222'

  it('says it is queued beside its hour, and what Stop will not do', () => {
    renderLog({
      entries: [{ role: 'user', at: AT, text: 'also rename the test', uuid: MESSAGE }],
      waiting: new Set([MESSAGE])
    })

    const mark = screen.getByText('Queued')
    expect(mark).toBeVisible()
    expect(mark).toHaveAttribute('title', expect.stringContaining('Stop does not withdraw it'))
  })

  it('says nothing of a message the agent has taken', () => {
    renderLog({
      entries: [{ role: 'user', at: AT, text: 'also rename the test', uuid: MESSAGE }],
      waiting: new Set(['someone-else'])
    })

    expect(screen.queryByText('Queued')).not.toBeInTheDocument()
  })
})

describe('rewinding from a message', () => {
  const MESSAGE = '11111111-1111-4111-8111-111111111111'

  // The log only offers it; the pane asks the question and does the work.
  it('offers it on a message that has an id, and hands the id up', async () => {
    const user = userEvent.setup()
    const { onRewind } = renderLog({
      entries: [{ role: 'user', at: AT, text: 'rename the helper', uuid: MESSAGE }]
    })

    await user.click(screen.getByRole('button', { name: 'Rewind to before this message' }))

    expect(onRewind).toHaveBeenCalledExactlyOnceWith(MESSAGE)
  })

  // Sent before ids were kept: there is nothing to rewind to.
  it('offers nothing on a message that has none', () => {
    renderLog({ entries: [{ role: 'user', at: AT, text: 'an old message' }] })

    expect(
      screen.queryByRole('button', { name: 'Rewind to before this message' })
    ).not.toBeInTheDocument()
  })

  // The core would refuse it, and a button that can only fail is a promise the
  // interface does not keep.
  it('offers nothing while the agent is working', () => {
    renderLog({
      busy: true,
      entries: [{ role: 'user', at: AT, text: 'rename the helper', uuid: MESSAGE }]
    })

    expect(
      screen.queryByRole('button', { name: 'Rewind to before this message' })
    ).not.toBeInTheDocument()
  })

  it('records that it happened, with how much', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'files_rewound',
          messageId: MESSAGE,
          files: 3,
          insertions: 12,
          deletions: 4,
          skippedLinks: 0
        })
      ]
    })

    expect(
      screen.getByText('Files put back to an earlier message: 3 changed, +12 −4')
    ).toBeInTheDocument()
  })

  // "5 changed" alone reads as though everything the checkpoint tracked had come
  // back, and the rewind never follows a link.
  it('says how many files a link kept it from restoring', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'files_rewound',
          messageId: MESSAGE,
          files: 3,
          insertions: 12,
          deletions: 4,
          skippedLinks: 2
        })
      ]
    })

    expect(screen.getByText(/2 left alone — a link sat at their path/)).toBeInTheDocument()
  })
})

/*
 * The message is what the agent was sent and is never rewritten; this is only
 * how it is drawn. A note on code becomes a card and a reference a chip, and
 * anything else reads exactly as it was typed.
 */
describe('a message carrying notes on code', () => {
  const user = (text: string): ChatEntry => ({ role: 'user', at: AT, text })

  it('draws each note as a card: where, the lines, and what was said', async () => {
    vi.mocked(highlight).mockResolvedValueOnce([
      [{ text: 'const a = 1', light: '#111', dark: '#eee' }],
      [{ text: 'const b = 2', light: '#222', dark: '#ddd' }]
    ])
    renderLog({
      entries: [
        user(
          'Look at these.\n\nsrc/core/a.ts:12-13\n> const a = 1\n> const b = 2\nWhy two?\n\nsrc/b.ts:4 (as it was)\n> gone\n\nLook.'
        )
      ]
    })

    expect(screen.getByText('Look at these.')).toBeInTheDocument()
    const first = screen.getByText('src/core/a.ts:12-13')
    expect(first).toHaveAttribute('title', 'src/core/a.ts')
    const card = first.closest('div')
    expect(card?.querySelector('pre')?.textContent).toBe('const a = 1\nconst b = 2')
    expect(card).toHaveTextContent('Why two?')
    // A note with nothing said is its place and its lines, and no empty line.
    const second = screen.getByText('src/b.ts:4').closest('div')
    expect(second).toHaveTextContent('(as it was)')
    expect(second?.querySelectorAll('p')).toHaveLength(1)
    expect(screen.getByText('Look.')).toBeInTheDocument()

    // The lines in their file's colours, as the viewer and the diff draw them:
    // a few lines out of context are where colour helps most.
    await waitFor(() => {
      expect(
        card?.querySelector<HTMLElement>('pre span')?.style.getPropertyValue('--shiki-light')
      ).toBe('#111')
    })
    expect(highlight).toHaveBeenCalledWith('typescript', 'const a = 1\nconst b = 2')
    expect(card?.querySelector('pre')).toHaveClass('diff-code')
    expect(card?.querySelector('pre')?.textContent).toBe('const a = 1\nconst b = 2')
  })

  it('draws a reference in running text as a chip', () => {
    renderLog({ entries: [user('the bug is at src/a.ts:12-18, I think')] })

    expect(screen.getByText('src/a.ts:12-18').tagName).toBe('CODE')
    expect(screen.getByText(/the bug is at/).textContent).toBe(
      'the bug is at src/a.ts:12-18, I think'
    )
  })

  it('leaves a message with nothing of the sort exactly as typed', () => {
    const typed = '\n  indented\n\nat 10:30'
    renderLog({ entries: [user(typed)] })

    expect(document.querySelector('.bubble-sent')?.textContent).toBe(typed)
    expect(document.querySelector('.bubble-sent p')).toBeNull()
  })
})

describe('what the log shows', () => {
  it('shows what the user said and what came back', () => {
    renderLog({
      entries: [
        { role: 'user', at: AT, text: 'add a test' },
        fromAgent({ type: 'text', text: 'Looking at auth.rb' })
      ]
    })

    expect(screen.getByText('add a test')).toBeInTheDocument()
    expect(screen.getByText('Looking at auth.rb')).toBeInTheDocument()
  })

  /*
   * The model writes markdown, and shown as characters that is punctuation in
   * the way of the words: `**7/10**` read as asterisks, a command came with its
   * backticks, a list was a column of hyphens.
   */
  it('draws what the agent wrote as the agent wrote it', () => {
    const { container } = render(
      <ChatLog
        entries={[
          fromAgent({
            type: 'text',
            text: '**7/10**\n\n- checked the code\n- ran `npm run check`'
          })
        ]}
        streaming={{ text: '', thinking: '' }}
        busy={false}
        answerable={NOTHING_ASKED}
        pendingElicitationId={null}
        onAnswer={vi.fn()}
        onAnswerElicitation={vi.fn()}
        onAnswerQuestions={vi.fn()}
        onExecutePlan={vi.fn()}
        onRewind={vi.fn()}
        waiting={NOT_WAITING}
        expansion={COLLAPSED}
        workspacePath={WORKSPACE}
        onOpenFile={vi.fn()}
      />
    )

    expect(container.querySelector('strong')?.textContent).toBe('7/10')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByText('npm run check').tagName).toBe('CODE')
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  // The whole of the previous change, arriving on ordinary answers: an answer
  // with a command in it becomes one you can take the command out of.
  it('gives a fenced block in an answer its copy button', () => {
    renderLog({ entries: [fromAgent({ type: 'text', text: '```sh\nnpm run dev\n```' })] })

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  // The buffer is drawn by the same component, so this would be easy to leave
  // behind — and it is what the reader looks at for most of a turn.
  it('draws it the same way while it is still arriving', () => {
    const { container } = render(
      <ChatLog
        entries={[]}
        streaming={{ text: '**still writing**', thinking: '' }}
        busy
        answerable={NOTHING_ASKED}
        pendingElicitationId={null}
        onAnswer={vi.fn()}
        onAnswerElicitation={vi.fn()}
        onAnswerQuestions={vi.fn()}
        onExecutePlan={vi.fn()}
        onRewind={vi.fn()}
        waiting={NOT_WAITING}
        expansion={COLLAPSED}
        workspacePath={WORKSPACE}
        onOpenFile={vi.fn()}
      />
    )

    expect(container.querySelector('strong')?.textContent).toBe('still writing')
  })

  /*
   * The one place markup stays text.
   *
   * These characters came from the composer, and drawing their asterisks as
   * bold would make the log disagree with what the person wrote.
   */
  it('leaves what the user typed exactly as they typed it', () => {
    renderLog({ entries: [{ role: 'user', at: AT, text: 'is it **bold** or not?' }] })

    expect(screen.getByText('is it **bold** or not?')).toBeInTheDocument()
  })

  /*
   * A long message used to be laid out at its full single-line width, and since
   * the bubble hangs off the right edge the overflow went left — off the pane,
   * under the sidebar, taking the start of every line with it.
   *
   * Asserted on the classes because jsdom has no layout: it computes no widths,
   * so the only thing a test can hold here is that the cap and the break
   * opportunity are still on the element.
   */
  it('keeps a message with nowhere to wrap inside the column', () => {
    const unbroken = `{"issuer":"${'x'.repeat(400)}"}`

    renderLog({ entries: [{ role: 'user', at: AT, text: unbroken }] })

    expect(screen.getByText(unbroken)).toHaveClass('max-w-full', 'wrap-anywhere')
  })

  // The row has to say what the agent did to the working tree, not just that
  // it did something.
  it('names the tool and what it acted on', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Edit',
          input: { file_path: '/src/auth.rb' }
        })
      ]
    })

    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('/src/auth.rb')).toBeInTheDocument()
  })

  it('shows the tool alone when its arguments say nothing readable', () => {
    renderLog({
      entries: [fromAgent({ type: 'tool_use', toolUseId: 'c-1', name: 'TodoWrite', input: {} })]
    })

    expect(screen.getByText('TodoWrite')).toBeInTheDocument()
  })

  // The list itself under the row, as Claude Code draws it: what is done, what
  // is under way, what is left.
  it('draws a task list as a checklist under its row', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'a', status: 'completed', activeForm: 'A' },
              { content: 'b', status: 'in_progress', activeForm: 'B' },
              { content: 'c', status: 'pending', activeForm: 'C' }
            ]
          }
        })
      ]
    })

    expect(screen.getByText('TodoWrite')).toBeInTheDocument()
    expect(screen.getByText('a')).toHaveClass('line-through')
    expect(screen.getByText('b')).not.toHaveClass('line-through')
    // The marks are read aloud, since a tick and a spinner say nothing alone.
    expect(screen.getByText('in progress', { selector: '.sr-only' })).toBeInTheDocument()
    expect(screen.getByText('to do', { selector: '.sr-only' })).toBeInTheDocument()
  })

  /*
   * Every call is its own row, with what came back under it — the shape of
   * Claude Code's own transcript. A successful result used to draw nothing at
   * all, so the log said what the agent looked at and never what it found.
   */
  it('draws every call as its own row, with what came back under it', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Grep',
          input: { pattern: 'octopus' }
        }),
        fromAgent({ type: 'tool_result', toolUseId: 'c-1', ok: true, content: 'lots' }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-2',
          name: 'Read',
          input: { file_path: '/a.ts' }
        }),
        fromAgent({
          type: 'tool_result',
          toolUseId: 'c-2',
          ok: true,
          content: 'one',
          stats: { lines: 120 }
        })
      ]
    })

    expect(screen.getByText('Grep')).toBeVisible()
    expect(screen.getByText('lots')).toBeVisible()
    expect(screen.getByText('/a.ts')).toBeVisible()
    expect(screen.getByText('120 lines')).toBeVisible()
  })

  /*
   * The log used to say a file was edited and never what the edit did.
   *
   * Drawn under its row without opening anything, as Claude Code draws it. The
   * counts matter most — they are what gets trusted at a glance, so a diff that
   * miscounts is a lie in the place most likely to be read.
   */
  it('shows what an edit changed, in the open', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'tool_use', toolUseId: 'c-1', name: 'Grep', input: { pattern: 'x' } }),
        fromAgent({ type: 'tool_use', toolUseId: 'c-2', name: 'Grep', input: { pattern: 'y' } }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-3',
          name: 'Edit',
          input: {
            file_path: '/src/core/service.ts',
            old_string: 'one\ntwo\nthree',
            new_string: 'one\nTWO\nthree'
          }
        })
      ]
    })

    expect(screen.getByText('/src/core/service.ts')).toBeVisible()
    expect(diffRow('two')).toBe('-two')
    expect(diffRow('TWO')).toBe('+TWO')
    expect(screen.getByText('+1')).toBeVisible()
    expect(screen.getByText('−1')).toBeVisible()
  })

  /*
   * The numbers are the part to guard hardest.
   *
   * A line number is read as fact, and one out by the length of a removed run
   * would be the most quietly wrong thing on the screen. The removed line takes
   * none at all: it belongs to the file as it was, which is not something we
   * kept.
   */
  it('numbers the context and what replaced it, but not what was removed', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Edit',
          input: { file_path: '/a.ts', old_string: 'two', new_string: 'TWO\nEXTRA' }
        }),
        fromAgent({
          type: 'change_context',
          toolUseId: 'c-1',
          context: { before: ['one'], after: ['four'], startLine: 2 }
        })
      ]
    })

    expect(diffRow('one')).toBe('1 one')
    // Gone from the file, so there is no line of the file to point at.
    expect(diffRow('two')).toBe('-two')
    expect(diffRow('TWO')).toBe('2+TWO')
    expect(diffRow('EXTRA')).toBe('3+EXTRA')
    expect(diffRow('four')).toBe('4 four')
  })

  // An older transcript, or a file since changed. The change is drawn without
  // numbers rather than with invented ones.
  it('leaves the numbers off when the surrounding lines were never recorded', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Edit',
          input: { file_path: '/a.ts', old_string: 'one', new_string: 'two' }
        })
      ]
    })

    expect(diffRow('one')).toBe('-one')
    expect(diffRow('two')).toBe('+two')
  })

  /*
   * A rename goes through `replace_all`, and the call says nothing about how
   * many places it touched — it carries one pair of fragments. Drawn as a count
   * that was `+1 −1` over twelve changed lines, which is not incomplete but
   * wrong: the block is what gets read instead of the diff.
   */
  it('says an edit replaced its text everywhere rather than counting once', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Edit',
          input: {
            file_path: '/a.ts',
            old_string: 'oldName',
            new_string: 'newName',
            replace_all: true
          }
        })
      ]
    })

    expect(screen.getByText('replaced everywhere')).toBeVisible()
    expect(screen.queryByText('+1')).not.toBeInTheDocument()
    expect(screen.queryByText('−1')).not.toBeInTheDocument()

    // The lines stay: they are exactly right for each place it landed.
    expect(diffRow('oldName')).toBe('-oldName')
    expect(diffRow('newName')).toBe('+newName')
  })

  // What stood there before is not in the call, so a `Write` says only what it
  // knows: everything is new.
  it('shows a written file as all additions', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Write',
          input: { file_path: '/a.ts', content: 'one\ntwo\n' }
        })
      ]
    })

    expect(screen.getByText('+2')).toBeVisible()
    expect(screen.queryByText('−0')).not.toBeInTheDocument()
    expect(diffRow('one')).toBe('+one')
  })

  /*
   * The same hazard the diff pane names, on the surface a small change is
   * actually read: a right-to-left override reorders what is on screen without
   * changing what runs, so the character is drawn as its code point instead.
   */
  it('names a character that would not draw as itself', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Write',
          input: { file_path: '/auth.ts', content: 'if (user.isAdmin) { \u202E\n' }
        })
      ]
    })

    expect(screen.getByText('U+202E')).toBeVisible()
  })

  // The path is drawn from the same bytes and reorders the same way, so a file
  // can be named to read as an image while ending in `.js`.
  it('names one in the path of the file that changed', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Write',
          input: { file_path: '/report\u202Egnp.js', content: 'ok\n' }
        })
      ]
    })

    expect(screen.getByText('U+202E')).toBeVisible()
  })

  /*
   * Seen in a real conversation: a refused tool call showed its first 400
   * characters, ending mid-word, with the agent side's own `<tool_use_error>`
   * envelope drawn as though it were part of the message. What went was the
   * sentence saying what to do about it.
   */
  it('shows both ends of a long failure, and not the envelope', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_result',
          toolUseId: 'c-1',
          ok: false,
          content: `<tool_use_error>InputValidationError: ${'x'.repeat(900)} Give each question two choices.</tool_use_error>`
        })
      ]
    })

    const shown = screen.getByText(/InputValidationError/)
    expect(shown).toHaveTextContent('Give each question two choices.')
    expect(shown).not.toHaveTextContent('tool_use_error')
  })

  // Folded into "1 step", a lone call would be more work to read than the row
  // it replaced.
  it('leaves a lone tool call in the open', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Read',
          input: { file_path: '/a.ts' }
        })
      ]
    })

    expect(screen.getByText('Read')).toBeVisible()
    expect(screen.queryByText(/step/)).not.toBeInTheDocument()
  })

  /*
   * Every plain string the agent wrote, in one test on purpose.
   *
   * `shown` returns ordinary text untouched, so wrapping a surface in it adds
   * no branch and coverage stays at 100% whether the call is there or not — a
   * test per surface is the only thing that stops one being dropped. That is
   * how the gap arose in the first place: the change block had it, the
   * permission card did not, and nothing said so.
   *
   * Four chips: the folded tool row, the failure, the note against a plan and
   * the error. The card is in its own describe, with the plan's own dialog and
   * everything else drawn as markdown still to come.
   *
   * The tooltip is checked too. It is laid out by the same algorithm as the row
   * it hangs off, so a raw `title` is the same misreading with a delay.
   */
  it('names such a character on every plain surface the agent writes to', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Bash',
          input: { command: 'npm run \u202Ehctap' }
        }),
        fromAgent({
          type: 'tool_result',
          toolUseId: 'c-1',
          ok: false,
          content: 'refused: \u202Ehctap'
        }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-2',
          name: 'ExitPlanMode',
          input: { plan: '## The plan' }
        }),
        fromAgent({
          type: 'tool_result',
          toolUseId: 'c-2',
          ok: false,
          content: 'do it \u202Eesiwrehto'
        }),
        fromAgent({ type: 'error', message: 'claude exited \u202E1 edoc htiw' })
      ]
    })

    expect(screen.getAllByText('U+202E')).toHaveLength(4)
    expect(screen.getByTitle(/U\+202E/)).toBeInTheDocument()
  })

  // A successful Read returns the file; pasting that into the chat would bury
  // the conversation in the codebase.
  it('shows a failed tool result and stays quiet about a successful one', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'tool_result', toolUseId: 'c-1', ok: true, content: 'the whole file' }),
        fromAgent({ type: 'tool_result', toolUseId: 'c-2', ok: false, content: 'no such file' })
      ]
    })

    expect(screen.queryByText('the whole file')).not.toBeInTheDocument()
    expect(screen.getByText('no such file')).toBeInTheDocument()
    expect(screen.getByText('no such file')).toHaveClass('text-danger')
  })

  /*
   * A stack trace, a validation error listing what it refused, a compiler's
   * three lines of context — every failure worth reading arrives with newlines
   * in it, and `readFailure` keeps them. They were dying at the CSS: no
   * `white-space` here, none in `styles.css`, and Tailwind's preflight sets
   * none on a `p`, so the whole thing collapsed into one paragraph.
   *
   * `wrap-anywhere` rather than the `break-all` this replaces, which chops
   * ordinary words mid-character; and pre-*wrap* rather than `pre`, which
   * would scroll the log sideways.
   */
  it('keeps the line breaks a failure arrived with', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_result',
          toolUseId: 'c-1',
          ok: false,
          content: 'Error: one\n  at two\n  at three'
        })
      ]
    })

    const failure = screen.getByText(/Error: one/)
    expect(failure).toHaveClass('whitespace-pre-wrap')
    expect(failure).toHaveClass('wrap-anywhere')
    expect(failure).not.toHaveClass('break-all')
  })

  /*
   * A plan sent back for another round is a refusal in the SDK's bookkeeping
   * and nothing else: the note travels as the reason, so it lands in the log as
   * a failed `ExitPlanMode`. Drawn like a failure it read as though the user's
   * own sentence had crashed something.
   */
  it('draws a note against a plan as a note, not as a failure', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'ExitPlanMode',
          input: { plan: '## The plan\n\nRefactor the callback.' }
        }),
        fromAgent({
          type: 'tool_result',
          toolUseId: 'c-1',
          ok: false,
          content: 'Do it without the new component.'
        })
      ]
    })

    const note = screen.getByText('Do it without the new component.')
    expect(note).toHaveClass('text-warning')
    expect(note).not.toHaveClass('text-danger')
    // A path or URL has no space to break at.
    expect(note).toHaveClass('wrap-anywhere')
  })

  // Transcripts written before the mapping learned to drop these already hold
  // them, and they are read back on every launch.
  it('draws no disclosure for empty reasoning read back from disk', () => {
    renderLog({ entries: [fromAgent({ type: 'thinking', text: '' })] })

    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
  })

  it('keeps reasoning folded away until it is asked for', async () => {
    const user = userEvent.setup()
    renderLog({ entries: [fromAgent({ type: 'thinking', text: 'weighing it up' })] })

    expect(screen.queryByText('weighing it up')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Thinking' }))
    expect(screen.getByText('weighing it up')).toBeVisible()
  })

  // Claude Code's ctrl+o: every row and every piece of reasoning at once.
  it('opens everything when the log is asked to show every step', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'thinking', text: 'weighing it up' }),
        fromAgent({ type: 'tool_use', toolUseId: 'c-1', name: 'Bash', input: { command: 'ls' } }),
        fromAgent({ type: 'tool_result', toolUseId: 'c-1', ok: true, content: 'a.ts' })
      ],
      expansion: { ...COLLAPSED, all: true, generation: 1 }
    })

    expect(screen.getByText('weighing it up')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Input' })).toHaveTextContent('ls')
    expect(screen.getByRole('region', { name: 'Output' })).toHaveTextContent('a.ts')
  })

  it('closes a turn with how long it took and what the exchange took', () => {
    renderLog({
      entries: [
        TURN,
        fromAgent({
          type: 'result',
          ok: true,
          costUsd: 0.0421,
          durationMs: 3200,
          inputTokens: 48_120,
          outputTokens: 1180,
          terminalReason: 'completed'
        })
      ]
    })

    expect(screen.getByText('3.2s · 49k tokens')).toBeInTheDocument()
  })

  // `213 tokens` on a turn whose prompt went unreported would read as the whole
  // of what the exchange took, and be out by two orders of magnitude.
  it('shows no total when only one half was reported', () => {
    renderLog({
      entries: [
        TURN,
        fromAgent({
          type: 'result',
          ok: true,
          costUsd: null,
          durationMs: 900,
          inputTokens: null,
          outputTokens: 213,
          terminalReason: 'completed'
        })
      ]
    })

    expect(screen.getByText('0.9s')).toBeInTheDocument()
  })

  // The SDK's figure is what the same tokens would have cost through the API —
  // its own docs call it an estimate, not a billing statement — and on a
  // subscription nothing of the sort is charged. Showing it would be a made-up
  // number in a currency.
  it('never shows a price', () => {
    renderLog({
      entries: [
        TURN,
        fromAgent({
          type: 'result',
          ok: true,
          costUsd: 0.2513,
          durationMs: 3200,
          inputTokens: null,
          outputTokens: null,
          terminalReason: null
        })
      ]
    })

    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/0\.2513/)).not.toBeInTheDocument()
  })

  // A row saying "completed" beside a tick is the same thing said twice.
  it('stays quiet about a turn that simply finished', () => {
    renderLog({
      entries: [
        TURN,
        fromAgent({
          type: 'result',
          ok: true,
          costUsd: null,
          durationMs: 900,
          inputTokens: null,
          outputTokens: null,
          terminalReason: 'completed'
        })
      ]
    })

    expect(screen.getByText('0.9s')).toBeInTheDocument()
  })

  // Until now this was a silent ⚠ with no explanation of what went wrong.
  it('says why a turn ended when it did not simply finish', () => {
    renderLog({
      entries: [
        TURN,
        fromAgent({
          type: 'result',
          ok: false,
          costUsd: null,
          durationMs: 900,
          inputTokens: null,
          outputTokens: null,
          terminalReason: 'max_turns'
        })
      ]
    })

    expect(screen.getByText('0.9s · hit a limit')).toBeInTheDocument()
  })

  it('says nothing when the turn reported no numbers at all', () => {
    renderLog({
      entries: [
        TURN,
        fromAgent({
          type: 'result',
          ok: false,
          costUsd: null,
          durationMs: null,
          inputTokens: null,
          outputTokens: null,
          terminalReason: null
        })
      ]
    })

    expect(screen.queryByText(/s$/)).not.toBeInTheDocument()
  })

  it('shows an error where the user is looking', () => {
    renderLog({ entries: [fromAgent({ type: 'error', message: 'claude exited with code 1' })] })

    expect(screen.getByText('claude exited with code 1')).toBeInTheDocument()
  })

  // "exited with code 143" is exact and says nothing to the person reading it.
  it('says in words that the agent was stopped from outside', () => {
    renderLog({
      entries: [fromAgent({ type: 'error', message: 'Claude Code process exited with code 143' })]
    })

    expect(screen.getByText(/Claude Code was stopped from outside/)).toBeInTheDocument()
    // The SDK's own line stays under it, for anyone who has to look it up.
    expect(screen.getByText('Claude Code process exited with code 143')).toBeInTheDocument()
  })

  it('names the code when the agent failed on its own', () => {
    renderLog({
      entries: [fromAgent({ type: 'error', message: 'Claude Code process exited with code 1' })]
    })

    expect(screen.getByText(/Claude Code stopped with an error \(code 1\)/)).toBeInTheDocument()
  })

  // The session id is bookkeeping; a row for it would say nothing to anyone.
  it('draws nothing for events that are not part of the conversation', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'session_started', sessionId: 'sess-1' }),
        fromAgent({ type: 'text_delta', text: 'partial' })
      ]
    })

    expect(screen.queryByText('sess-1')).not.toBeInTheDocument()
    expect(screen.queryByText('partial')).not.toBeInTheDocument()
  })

  /*
   * A reset the user did not ask for — the agent left plan mode, or started a
   * fresh session of its own. The exchange above it happened and is worth
   * reading; what changed is that the agent no longer has any of it. Without
   * the line, a conversation continuing past this point looks like one the
   * agent can refer back to.
   */
  it('marks where the agent stopped remembering', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'text', text: 'Renamed the module' }),
        fromAgent({ type: 'conversation_reset', cleared: false })
      ]
    })

    expect(screen.getByText('Renamed the module')).toBeVisible()
    expect(
      screen.getByText('The agent’s memory of this conversation starts again here')
    ).toBeVisible()
  })

  /*
   * The same event with the memory partly kept rather than wholly discarded.
   *
   * Without the row a compacted conversation reads as an intact one, and the
   * two behave differently: "do what we agreed earlier" works in one and fails
   * in the other, which looks like the agent ignoring an instruction.
   */
  it('marks where the conversation was summarised, and by how much', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'text', text: 'Renamed the module' }),
        fromAgent({
          type: 'conversation_compacted',
          trigger: 'auto',
          preTokens: 73984,
          postTokens: 16023
        })
      ]
    })

    expect(screen.getByText(/summarised/)).toBeVisible()
    // The same formatter the turn footer uses: `74k`, not `73,984`.
    expect(screen.getByText(/74k/)).toBeVisible()
  })

  /*
   * The agent's working directory moved, and the window's did not: Changes,
   * Files and the terminal still show the workspace. Drawn as a tool name with
   * nothing beside it, the one call that makes the rest of the window stale
   * read like a `Glob`.
   */
  it('says when the agent moves into another worktree, and when it comes back', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'enter',
          name: 'EnterWorktree',
          input: { name: 'spike' }
        }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'exit',
          name: 'ExitWorktree',
          input: { action: 'remove' }
        })
      ]
    })

    expect(screen.getByText(/moving into another worktree, spike/)).toBeVisible()
    expect(screen.getByText(/stay on this workspace/)).toBeVisible()
    expect(screen.getByText(/leaving the other worktree and removing it/)).toBeVisible()
  })

  // Without a name the CLI makes one up, which only its result says.
  it('says a move into a new worktree, and leaving one that is kept', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'tool_use', toolUseId: 'enter', name: 'EnterWorktree', input: {} }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'exit',
          name: 'ExitWorktree',
          input: { action: 'keep' }
        })
      ]
    })

    expect(screen.getByText(/moving into a new worktree/)).toBeVisible()
    expect(screen.getByText(/leaving the other worktree and keeping it/)).toBeVisible()
  })

  // The boundary is worth drawing on its own: metadata in a shape nothing here
  // recognises degrades the row rather than losing it.
  it('marks it even when the agent said nothing about the size', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'conversation_compacted',
          trigger: null,
          preTokens: null,
          postTokens: null
        })
      ]
    })

    expect(screen.getByText(/summarised/)).toBeVisible()
  })

  /*
   * A model changing itself mid-conversation is the one change neither the user
   * nor the agent chose, and the composer's chip moves on its own to show it.
   * Without this line the turn above reads as an ordinary one with an odd
   * answer.
   */
  it('says which model took a turn the first one declined', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'model_refusal_fallback',
          originalModel: 'claude-opus-5',
          fallbackModel: 'claude-sonnet-5',
          scope: 'session',
          category: 'cyber',
          explanation: null
        })
      ]
    })

    expect(screen.getByText(/claude-opus-5 declined this turn/)).toBeVisible()
    expect(screen.getByText(/the rest of this conversation/)).toBeVisible()
  })

  /* A subagent or a side question fell back and the session model is unchanged,
     so the chip has not moved — saying "the rest of this conversation" there
     would send the reader after a change that is not there. */
  it('keeps a local swap apart from one that outlives the turn', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'model_refusal_fallback',
          originalModel: 'claude-opus-5',
          fallbackModel: 'claude-sonnet-5',
          scope: 'local',
          category: null,
          explanation: null
        })
      ]
    })

    expect(screen.getByText(/declined part of this turn/)).toBeVisible()
    expect(screen.queryByText(/the rest of this conversation/)).not.toBeInTheDocument()
  })

  /* Shown as given. The SDK calls it "unstable human prose — display only,
     never parse", so nothing here reads anything out of it. */
  it('shows the refusal\u2019s own words when there are any', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'model_refusal_fallback',
          originalModel: 'claude-opus-5',
          fallbackModel: 'claude-sonnet-5',
          scope: 'session',
          category: 'cyber',
          explanation: 'The request looked like credential harvesting.'
        })
      ]
    })

    expect(screen.getByText('The request looked like credential harvesting.')).toBeVisible()
  })

  // Absent more often than not, and an empty line under the sentence would
  // read as prose that failed to load.
  it('draws no second line where the refusal said nothing', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'model_refusal_fallback',
          originalModel: 'claude-opus-5',
          fallbackModel: 'claude-sonnet-5',
          scope: 'session',
          category: null,
          explanation: '   '
        })
      ]
    })

    expect(
      screen.getByText(/claude-opus-5 declined this turn/).parentElement?.children
    ).toHaveLength(1)
  })

  /*
   * The other refusal, and the one the log used to say nothing at all about:
   * the turn ends with no answer, and silence is left to be interpreted as the
   * agent still thinking or the app having dropped something.
   */
  it('says so when a turn was declined and nothing took it', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'model_refusal_no_fallback',
          originalModel: 'claude-opus-5',
          category: 'cyber',
          explanation: 'The request looked like credential harvesting.'
        })
      ]
    })

    expect(screen.getByText(/no other model took it/)).toBeVisible()
    expect(screen.getByText(/credential harvesting/)).toBeVisible()
    // And not the sentence for a turn something else answered.
    expect(screen.queryByText(/the rest of this conversation/)).not.toBeInTheDocument()
  })

  it('draws no second line where that refusal said nothing either', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'model_refusal_no_fallback',
          originalModel: 'claude-opus-5',
          category: null,
          explanation: null
        })
      ]
    })

    expect(screen.getByText(/no other model took it/).parentElement?.children).toHaveLength(1)
  })

  /*
   * A call auto mode's classifier refused. Without the line it shows only as a
   * tool that failed, and a mode that decides for the user has to leave its
   * decisions where they can be read.
   */
  it('says when auto mode blocked a call, and why', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'permission_denied',
          toolName: 'Bash',
          byClassifier: true,
          reason: 'Downloads and runs a remote script'
        })
      ]
    })

    expect(screen.getByText('Auto mode blocked Bash')).toBeVisible()
    expect(screen.getByText('Downloads and runs a remote script')).toBeVisible()
  })

  it('names a rule rather than auto mode when a rule refused the call', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'permission_denied',
          toolName: 'Write',
          byClassifier: false,
          reason: null
        })
      ]
    })

    expect(screen.getByText('Write was refused without asking')).toBeVisible()
    expect(screen.queryByText(/Auto mode/)).not.toBeInTheDocument()
  })

  it('says why the chip left auto mode', () => {
    renderLog({
      entries: [fromAgent({ type: 'auto_mode_unavailable', reason: null, fallback: 'default' })]
    })

    expect(
      screen.getByText('Auto mode is not available here, so this chat is on Manual now')
    ).toBeVisible()
  })

  /*
   * A model refused, the CLI retried, and what the first had already said is
   * taken back. Struck through rather than dropped: the work was really done
   * and abandoned, and a log that quietly loses it reads as though the agent
   * never started down that road — while the file on disk would still hold it.
   */
  it('strikes through what the agent took back', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'text', text: 'Half an answer', uuid: 'u-1' }),
        fromAgent({ type: 'retracted', uuids: ['u-1'] }),
        fromAgent({ type: 'text', text: 'The real one', uuid: 'u-2' })
      ]
    })

    expect(screen.getByText('Half an answer').closest('.line-through')).not.toBeNull()
    expect(screen.getByText('The real one').closest('.line-through')).toBeNull()
  })

  // A tool call is a row of its own now, and is struck through the same way.
  it('strikes through a tool call the agent took back', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Grep',
          input: { pattern: 'first' },
          uuid: 'u-1'
        }),
        fromAgent({ type: 'retracted', uuids: ['u-1'] }),
        fromAgent({
          type: 'tool_use',
          toolUseId: 'c-2',
          name: 'Grep',
          input: { pattern: 'second' },
          uuid: 'u-2'
        })
      ]
    })

    expect(screen.getByText('"first"').closest('.line-through')).not.toBeNull()
    expect(screen.getByText('"second"').closest('.line-through')).toBeNull()
  })

  // An id nothing matches is ordinary: the CLI names everything it evicted, and
  // some of it may never have reached this transcript.
  it('leaves the log alone for an id it does not have', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'text', text: 'Still standing', uuid: 'u-1' }),
        fromAgent({ type: 'retracted', uuids: ['u-elsewhere'] })
      ]
    })

    expect(screen.getByText('Still standing').closest('.line-through')).toBeNull()
  })

  // A record, not a row: what it names is struck through above it, and a line
  // of its own would say the same thing twice.
  it('draws no row for the retraction itself', () => {
    renderLog({ entries: [fromAgent({ type: 'retracted', uuids: ['u-1'] })] })

    expect(screen.queryByText(/took this back/)).not.toBeInTheDocument()
  })

  // The reset the user did ask for takes the whole log with it, so there is
  // nothing left for a line to sit in.
  it('says nothing about a reset that emptied the log', () => {
    renderLog({ entries: [fromAgent({ type: 'conversation_reset', cleared: true })] })

    expect(
      screen.queryByText('The agent’s memory of this conversation starts again here')
    ).not.toBeInTheDocument()
  })
})

describe('while an answer is arriving', () => {
  it('shows the text as it is written', () => {
    renderLog({ busy: true, streaming: { text: 'Looking at aut', thinking: '' } })

    expect(screen.getByText('Looking at aut')).toBeInTheDocument()
  })

  it('shows reasoning as it is written', () => {
    renderLog({ busy: true, streaming: { text: '', thinking: 'weighing it' } })

    expect(screen.getByText('Thinking')).toBeInTheDocument()
  })

  it('says it is working while nothing has arrived yet', () => {
    renderLog({ busy: true })

    expect(screen.getByText('Working…')).toBeInTheDocument()
  })

  // Kept while text arrives, as the CLI keeps its spinner: text arriving says
  // the agent is talking, not that the turn is over.
  it('keeps saying it is working while text arrives', () => {
    renderLog({ busy: true, streaming: { text: 'Looking', thinking: '' } })

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('counts how long the turn has been going', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.parse(AT) + 12_000))
    try {
      renderLog({ busy: true, entries: [{ role: 'user', at: AT, text: 'go' }] })

      expect(screen.getByRole('status')).toHaveTextContent('Working… 12s')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a permission request', () => {
  const request = fromAgent({
    type: 'permission_request',
    requestId: 'r-1',
    toolName: 'Bash',
    input: { command: 'rm -rf build' }
  })

  it('says what the agent wants and on what', () => {
    renderLog({ entries: [request], pendingRequestId: 'r-1' })

    expect(screen.getByText('The agent wants to use Bash')).toBeInTheDocument()
    expect(screen.getByText('rm -rf build')).toBeInTheDocument()
  })

  it('wraps a long tool name rather than letting it run past the card', () => {
    const name = 'mcp__plugin_playwright_playwright__browser_run_code_unsafe'
    renderLog({
      entries: [
        fromAgent({ type: 'permission_request', requestId: 'r-1', toolName: name, input: {} })
      ],
      pendingRequestId: 'r-1'
    })

    expect(screen.getByText(`The agent wants to use ${name}`)).toHaveClass(
      'min-w-0',
      'wrap-anywhere'
    )
  })

  /*
   * The one sentence that tells this request from fifty silent ones. Measured
   * against a live session: under `acceptEdits` an ordinary edit passes without
   * a word and a file inside `.claude/` is asked about, because the CLI guards
   * the agent's own instructions separately — and the mode looked broken until
   * this line was drawn.
   */
  it('says why it is asking, when the bridge says', () => {
    const explained = fromAgent({
      type: 'permission_request',
      requestId: 'r-2',
      toolName: 'Edit',
      input: { file_path: '/w/.claude/skills/demo/SKILL.md' },
      reason: 'Claude requested permissions to write to it, but you have not granted it yet.'
    })
    renderLog({ entries: [explained], pendingRequestId: 'r-2' })

    expect(screen.getByText(/but you have not granted it yet/)).toBeInTheDocument()
  })

  /* Most requests have nothing particular behind them, and a card with an empty
     line under the path would read as a sentence that failed to load. */
  it('draws no explanation where the bridge sent none', () => {
    renderLog({ entries: [request], pendingRequestId: 'r-1' })

    expect(screen.getByText('The agent wants to use Bash')).toBeInTheDocument()
    expect(screen.queryByText(/granted/)).not.toBeInTheDocument()
  })

  it('offers all three answers', async () => {
    const user = userEvent.setup()
    const { onAnswer } = renderLog({ entries: [request], pendingRequestId: 'r-1' })

    await user.click(screen.getByRole('button', { name: 'Allow' }))
    await user.click(screen.getByRole('button', { name: 'Always allow' }))
    await user.click(screen.getByRole('button', { name: 'Decline' }))

    expect(onAnswer.mock.calls).toEqual([
      ['r-1', 'allow'],
      ['r-1', 'always'],
      ['r-1', 'deny']
    ])
  })

  /* The bridge said the rule "Always" would write is wider than this question,
     so the card does not offer it — the other two answers still stand. */
  it('offers no "Always" where the bridge forbade a standing answer', () => {
    const suppressed = fromAgent({
      type: 'permission_request',
      requestId: 'r-1',
      toolName: 'Bash',
      input: { command: 'ls' },
      suppressAlways: true
    })
    renderLog({ entries: [suppressed], pendingRequestId: 'r-1' })

    expect(screen.queryByRole('button', { name: 'Always allow' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  // A request read back from the transcript was answered long ago; offering
  // buttons would let the user answer a question nobody is waiting on.
  it('offers no buttons for a request nobody is blocked on', () => {
    renderLog({ entries: [request], pendingRequestId: null })

    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
    expect(screen.getByText('Already answered.')).toBeInTheDocument()
  })

  it('offers no buttons for an older request while a newer one waits', () => {
    renderLog({ entries: [request], pendingRequestId: 'r-2' })

    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
  })

  /*
   * The one place in the app where somebody authorises a command to run
   * against their working tree, and until now the only surface in the chat
   * that drew agent text raw. A right-to-left override reorders what is on
   * screen while the string handed to the agent is untouched, so the reader
   * approves one command and another runs.
   *
   * Worse than it looks: "Always allow" writes the tool *name*, so answering
   * it on a misread Bash command approves every future Bash call in every
   * workspace.
   */
  it('names a character in the command that would not draw as itself', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'permission_request',
          requestId: 'r-9',
          toolName: 'Bash',
          input: { command: 'echo safe # \u202Erm -rf /' }
        })
      ],
      pendingRequestId: 'r-9'
    })

    expect(screen.getByText('U+202E')).toBeVisible()
  })

  it('shows the tool alone when its arguments say nothing readable', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'permission_request',
          requestId: 'r-1',
          toolName: 'TodoWrite',
          input: {}
        })
      ],
      pendingRequestId: 'r-1'
    })

    expect(screen.getByText('The agent wants to use TodoWrite')).toBeInTheDocument()
  })
})

// The complaint that started this: "plan mode does not work, the chat shows no
// plan". It did work — the plan was arriving inside an `ExitPlanMode` call and
// being drawn as a bare tool row, so it never reached the screen.
describe('a plan the agent worked out', () => {
  const PLAN = '# Add a farewell\n\nOne more export in greet.js.'

  it('is shown as prose rather than as a tool nobody can read', () => {
    renderLog({
      entries: [
        {
          role: 'agent',
          at: '2026-08-13T09:00:00.000Z',
          event: {
            type: 'tool_use',
            toolUseId: 'call-1',
            name: 'ExitPlanMode',
            input: { plan: PLAN }
          }
        }
      ]
    })

    expect(screen.getByText(/One more export in greet\.js/)).toBeInTheDocument()
    expect(screen.queryByText('ExitPlanMode')).not.toBeInTheDocument()
  })

  /*
   * The way back to a plan that was set aside.
   *
   * The dialog asks once; closing it answers the request, and after that the
   * block in the log is all that survives. Changing your mind then meant
   * typing the whole request again.
   */
  it('offers to carry the plan out', async () => {
    const user = userEvent.setup()
    const { onExecutePlan } = renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'call-1',
          name: 'ExitPlanMode',
          input: { plan: PLAN }
        })
      ]
    })

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    expect(onExecutePlan).toHaveBeenCalledExactlyOnceWith(PLAN)
  })

  // It would be queued behind the turn in flight — and that turn may be the
  // agent already redoing the very plan being pointed at.
  it('does not offer it while the agent is working', () => {
    renderLog({
      busy: true,
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 'call-1',
          name: 'ExitPlanMode',
          input: { plan: PLAN }
        })
      ]
    })

    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()
  })

  it('leaves every other tool call as the one line it was', () => {
    renderLog({
      entries: [
        {
          role: 'agent',
          at: '2026-08-13T09:00:00.000Z',
          event: {
            type: 'tool_use',
            toolUseId: 'call-1',
            name: 'Read',
            input: { file_path: '/a.ts' }
          }
        }
      ]
    })

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('/a.ts')).toBeInTheDocument()
  })

  /*
   * The plan is drawn once, from the tool call that carried it, and the
   * request to leave planning adds nothing to the log at all.
   *
   * Both events are recorded, so before this the plan appeared twice — once as
   * itself and once inside a permission card, with a second set of buttons
   * under it. The question is asked in a dialog now.
   */
  it('says nothing twice when the request to leave planning arrives', () => {
    renderLog({
      pendingRequestId: 'req-1',
      entries: [
        {
          role: 'agent',
          at: '2026-08-13T09:00:00.000Z',
          event: {
            type: 'permission_request',
            requestId: 'req-1',
            toolName: 'ExitPlanMode',
            input: { plan: PLAN }
          }
        }
      ]
    })

    expect(screen.queryByText('Normalising the locales')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/wants to use/)).not.toBeInTheDocument()
  })
})

describe('deciding on an ordinary tool', () => {
  function requestAwaitingAnswer(): ReturnType<typeof renderLog> {
    return renderLog({
      pendingRequestId: 'req-1',
      entries: [
        {
          role: 'agent',
          at: '2026-08-13T09:00:00.000Z',
          event: {
            type: 'permission_request',
            requestId: 'req-1',
            toolName: 'Edit',
            input: { file_path: '/a.ts' }
          }
        }
      ]
    })
  }

  // The card is about tools again. Every plan branch it used to carry moved to
  // the dialog, and what is left has to still work.
  it('names the tool, what it would touch, and the three ways out', () => {
    requestAwaitingAnswer()

    expect(screen.getByText(/wants to use/)).toBeInTheDocument()
    expect(screen.getByText('/a.ts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  it('sends the answer that was chosen', async () => {
    const user = userEvent.setup()
    const { onAnswer } = requestAwaitingAnswer()

    await user.click(screen.getByRole('button', { name: 'Allow' }))

    expect(onAnswer).toHaveBeenCalledWith('req-1', 'allow')
  })
})

/*
 * A question is a permission request in shape only: the user is not being asked
 * whether the agent may act, but what it should do. It gets its own card, and
 * the call that carried it draws nothing — the card is already the question.
 */
/*
 * A rewind cuts the log back, and the next turn is drawn at positions the cut
 * turn held. Rows are keyed by position, so whatever a row was holding must not
 * pass to the different thing now standing where it stood.
 */
describe('a log cut back and written again', () => {
  const asked = (requestId: string, question: string): ChatEntry =>
    fromAgent({
      type: 'permission_request',
      requestId,
      toolName: 'AskUserQuestion',
      input: {
        questions: [
          {
            question,
            header: 'Pick',
            multiSelect: false,
            options: [{ label: 'date-fns' }, { label: 'Luxon' }]
          }
        ]
      }
    })

  it('draws a new question in the old one’s place with nothing chosen', async () => {
    const user = userEvent.setup()
    const said: ChatEntry = { role: 'user', at: AT, text: 'pick a library' }
    const props = {
      streaming: { text: '', thinking: '' },
      busy: false,
      pendingElicitationId: null,
      onAnswer: vi.fn(),
      onAnswerElicitation: vi.fn(),
      onAnswerQuestions: vi.fn(),
      onExecutePlan: vi.fn(),
      onRewind: vi.fn(),
      waiting: NOT_WAITING,
      expansion: COLLAPSED,
      workspacePath: WORKSPACE,
      onOpenFile: vi.fn()
    }
    const { rerender } = render(
      <ChatLog
        {...props}
        entries={[said, asked('r-1', 'Which one?')]}
        answerable={new Set(['r-1'])}
      />
    )
    await user.click(screen.getByRole('radio', { name: /Luxon/ }))
    expect(screen.getByRole('radio', { name: /Luxon/ })).toBeChecked()

    rerender(<ChatLog {...props} entries={[said]} answerable={NOTHING_ASKED} />)
    rerender(
      <ChatLog
        {...props}
        entries={[said, asked('r-2', 'Which one now?')]}
        answerable={new Set(['r-2'])}
      />
    )

    expect(screen.getByText('Which one now?')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Luxon/ })).not.toBeChecked()
  })
})

describe('a question the agent asked', () => {
  const ASKED = {
    questions: [
      {
        question: 'Which library should we use?',
        header: 'Library',
        multiSelect: false,
        options: [{ label: 'date-fns' }, { label: 'Luxon' }]
      }
    ]
  }

  const request = {
    type: 'permission_request' as const,
    requestId: 'r-1',
    toolName: 'AskUserQuestion',
    input: ASKED
  }

  it('draws the options rather than an allow-or-decline card', () => {
    renderLog({ entries: [fromAgent(request)], pendingRequestId: 'r-1' })

    expect(screen.getByText('Which library should we use?')).toBeVisible()
    expect(screen.getByRole('radio', { name: /Luxon/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
  })

  it('sends the answer with the request it belongs to', async () => {
    const user = userEvent.setup()
    const { onAnswerQuestions } = renderLog({
      entries: [fromAgent(request)],
      pendingRequestId: 'r-1'
    })

    await user.click(screen.getByRole('radio', { name: /date-fns/ }))
    await user.click(screen.getByRole('button', { name: 'Answer' }))

    expect(onAnswerQuestions).toHaveBeenCalledExactlyOnceWith('r-1', [
      { question: 'Which library should we use?', selected: ['date-fns'], other: null }
    ])
  })

  // Skipping is the ordinary approval: the tool runs with its arguments
  // untouched, and the agent reads that as "nobody answered".
  it('skips by approving the tool as it stands', async () => {
    const user = userEvent.setup()
    const { onAnswer, onAnswerQuestions } = renderLog({
      entries: [fromAgent(request)],
      pendingRequestId: 'r-1'
    })

    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('r-1', 'allow')
    expect(onAnswerQuestions).not.toHaveBeenCalled()
  })

  // The call itself is the same question a second time, and it arrives beside
  // the request that draws it.
  it('draws nothing for the call that carried the question', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'tool_use', toolUseId: 'c-1', name: 'AskUserQuestion', input: ASKED })
      ]
    })

    expect(screen.queryByText('AskUserQuestion')).not.toBeInTheDocument()
  })

  // And it is not a tool row either: the card is the whole of it, and a row
  // beside it would be the same question twice.
  it('draws no row of its own among the tool calls around it', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'tool_use', toolUseId: 'c-1', name: 'Grep', input: { pattern: 'x' } }),
        fromAgent({ type: 'tool_use', toolUseId: 'c-2', name: 'AskUserQuestion', input: ASKED }),
        fromAgent({ type: 'tool_use', toolUseId: 'c-3', name: 'Read', input: { file_path: '/a' } })
      ]
    })

    expect(screen.getByText('Grep')).toBeVisible()
    expect(screen.getByText('Read')).toBeVisible()
    expect(screen.queryByText('AskUserQuestion')).not.toBeInTheDocument()
  })

  /*
   * Read back from the transcript. The answer is a record of its own, which is
   * the only place the choice survives: the call above holds the questions as
   * they were before anyone answered.
   */
  it('shows what was chosen when the question is history', () => {
    renderLog({
      entries: [
        fromAgent(request),
        fromAgent({
          type: 'question_answered',
          requestId: 'r-1',
          answers: [{ question: 'Which library should we use?', selected: ['Luxon'], other: null }]
        })
      ],
      pendingRequestId: null
    })

    expect(screen.getByRole('radio', { name: /Luxon/ })).toBeChecked()
    expect(screen.getByText('Answered.')).toBeVisible()
  })

  // The turn ended while it was still on screen. Saying so is the truth, and it
  // is not the same as saying it was answered.
  it('says a question was never answered when nothing was recorded', () => {
    renderLog({ entries: [fromAgent(request)], pendingRequestId: null })

    expect(screen.getByText('Left unanswered.')).toBeVisible()
  })
})

describe('the answer to /usage', () => {
  const report = {
    session: {
      costUsd: 0,
      apiDurationMs: 0,
      wallDurationMs: 0,
      linesAdded: 0,
      linesRemoved: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    },
    subscriptionType: 'max',
    limitsApply: true,
    modelWindowsKnown: true,
    limits: [
      {
        key: 'five_hour' as const,
        label: null,
        utilization: 32,
        resetsAt: null,
        severity: null,
        binding: false
      }
    ],
    extraUsage: null,
    contributing: null
  }

  it('draws a card rather than a paragraph', () => {
    renderLog({ entries: [fromAgent({ type: 'usage', report })] })

    expect(screen.getByRole('progressbar', { name: 'Current session — 32% used' })).toBeVisible()
  })

  // A card is a block of its own, not a step inside a run of tool calls. Folded
  // in, the answer to a command would disappear behind a "3 steps" summary.
  it('stands on its own between the tool calls around it', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'tool_use',
          toolUseId: 't-1',
          name: 'Grep',
          input: { pattern: 'usage' }
        }),
        fromAgent({ type: 'usage', report }),
        fromAgent({ type: 'tool_use', toolUseId: 't-2', name: 'Grep', input: { pattern: 'limit' } })
      ]
    })

    expect(screen.getByRole('progressbar')).toBeVisible()
    expect(screen.getAllByText('Grep')).toHaveLength(2)
  })
})

describe('a question from an MCP server, in the log', () => {
  const REQUEST: AgentEvent = {
    type: 'elicitation_request',
    requestId: 'e-1',
    serverName: 'ledger',
    message: 'Which token should I use?',
    title: '',
    fields: [
      { kind: 'text', name: 'token', label: 'Token', description: '', required: true, value: '' }
    ]
  }

  /** The card's own confirm, which the composer's `Send` is not. */
  const answer = (): HTMLElement => screen.getByRole('button', { name: 'Answer' })

  it('is drawn as a card of its own', () => {
    renderLog({ entries: [fromAgent(REQUEST)], pendingElicitationId: 'e-1' })

    expect(screen.getByText('A question from ledger')).toBeInTheDocument()
    expect(answer()).toBeInTheDocument()
  })

  it('answers it with what was typed', async () => {
    const user = userEvent.setup()
    const { onAnswerElicitation } = renderLog({
      entries: [fromAgent(REQUEST)],
      pendingElicitationId: 'e-1'
    })

    await user.type(screen.getByLabelText('Token'), 'abc')
    await user.click(answer())

    expect(onAnswerElicitation).toHaveBeenCalledWith('e-1', 'accept', { token: 'abc' })
  })

  it('turns it down', async () => {
    const user = userEvent.setup()
    const { onAnswerElicitation } = renderLog({
      entries: [fromAgent(REQUEST)],
      pendingElicitationId: 'e-1'
    })

    await user.click(screen.getByRole('button', { name: 'Decline' }))

    expect(onAnswerElicitation).toHaveBeenCalledWith('e-1', 'decline')
  })

  /*
   * One read back from the transcript is history: the server it belonged to
   * stopped waiting long ago, and buttons on it would let the user answer a
   * question nobody is holding open.
   */
  it('offers no buttons for one nothing is waiting on', () => {
    renderLog({ entries: [fromAgent(REQUEST)], pendingElicitationId: null })

    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
  })

  /*
   * The outcome is its own event and sits further down the log than the card
   * that draws it, so it is gathered in one pass — and it is said on the card
   * rather than as a second row, which keeps the question and what became of it
   * in one place.
   */
  it('says what became of it, from an event further down', () => {
    renderLog({
      entries: [
        fromAgent(REQUEST),
        fromAgent({ type: 'elicitation_answered', requestId: 'e-1', action: 'decline' })
      ],
      pendingElicitationId: null
    })

    expect(screen.getByText('Declined.')).toBeInTheDocument()
  })
})

describe('agents the conversation sent off', () => {
  // Several agents can ask at once, and "may it run Bash" is a different
  // question depending on which of them wants to.
  it('names the agent asking on its permission card', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'permission_request',
          requestId: 'r-1',
          toolName: 'Bash',
          input: { command: 'ls' },
          taskId: 't-1'
        })
      ],
      pendingRequestId: 'r-1',
      tasks: [task()]
    })

    expect(screen.getByText('Audit route handlers is asking')).toBeInTheDocument()
  })

  it('names no one on a card the conversation itself raised', () => {
    renderLog({
      entries: [
        fromAgent({
          type: 'permission_request',
          requestId: 'r-1',
          toolName: 'Bash',
          input: { command: 'ls' }
        })
      ],
      pendingRequestId: 'r-1',
      tasks: [task()]
    })

    expect(screen.queryByText(/is asking/)).not.toBeInTheDocument()
  })

  /*
   * The main agent's turn is over and its agents are not: a clock from the
   * turn's start would count the wrong thing, so the line says who is working.
   * The task events they record after the result do not start a new turn.
   */
  it('says the agents are at work once the turn that sent them has ended', () => {
    renderLog({
      busy: false,
      entries: [
        fromAgent({
          type: 'result',
          ok: true,
          costUsd: null,
          durationMs: 1000,
          inputTokens: 10,
          outputTokens: 10,
          terminalReason: null
        }),
        fromAgent({ type: 'task_ended', taskId: 't-0', status: 'completed' })
      ],
      tasks: [task(), task({ taskId: 't-2' })]
    })

    expect(screen.getByText('2 agents working in the background')).toBeInTheDocument()
  })

  // The main agent at work again — reading a report — is what the line is
  // about, agents or no agents.
  it('counts the main agent’s turn while it works beside its agents', () => {
    renderLog({
      busy: true,
      entries: [fromAgent({ type: 'text', text: 'reading' })],
      tasks: [task()]
    })

    expect(screen.getByText(/^Working… /)).toBeInTheDocument()
    expect(screen.queryByText(/in the background/)).not.toBeInTheDocument()
  })
})
