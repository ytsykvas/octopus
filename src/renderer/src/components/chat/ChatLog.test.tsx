import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { ChatLog } from './ChatLog.js'

const AT = '2026-08-11T09:00:00.000Z'

function fromAgent(event: AgentEvent): ChatEntry {
  return { role: 'agent', at: AT, event }
}

/**
 * The turn a footer closes.
 *
 * A footer at the head of the log draws nothing — it closes a turn the log does
 * not have, which is what `/clear` used to leave behind — so a test about what
 * a footer says has to give it a turn to be the footer of.
 */
const TURN: ChatEntry = fromAgent({ type: 'text', text: 'that is done' })

function renderLog(overrides: Partial<React.ComponentProps<typeof ChatLog>> = {}): {
  onAnswer: ReturnType<typeof vi.fn>
  onAnswerQuestions: ReturnType<typeof vi.fn>
  onExecutePlan: ReturnType<typeof vi.fn>
} {
  const onAnswer = vi.fn()
  const onAnswerQuestions = vi.fn()
  const onExecutePlan = vi.fn()

  render(
    <ChatLog
      entries={[]}
      streaming={{ text: '', thinking: '' }}
      busy={false}
      pendingRequestId={null}
      onAnswer={onAnswer}
      onAnswerQuestions={onAnswerQuestions}
      onExecutePlan={onExecutePlan}
      {...overrides}
    />
  )

  return { onAnswer, onAnswerQuestions, onExecutePlan }
}

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
        pendingRequestId={null}
        onAnswer={vi.fn()}
        onAnswerQuestions={vi.fn()}
        onExecutePlan={vi.fn()}
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
        pendingRequestId={null}
        onAnswer={vi.fn()}
        onAnswerQuestions={vi.fn()}
        onExecutePlan={vi.fn()}
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

  /*
   * A rename went through fifty-nine tool calls, and one line each buried the
   * two things worth reading: what the agent said, and what it changed.
   *
   * Folded rather than dropped — the same disclosure reasoning uses, closed to
   * begin with. `toBeVisible` is the assertion that matters, since the rows are
   * in the document either way.
   */
  it('folds a run of tool calls into the count of them', async () => {
    const user = userEvent.setup()
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
        })
      ]
    })

    const summary = screen.getByText('2 steps')
    expect(screen.getByText('Grep')).not.toBeVisible()

    await user.click(summary)

    expect(screen.getByText('Grep')).toBeVisible()
    expect(screen.getByText('/a.ts')).toBeVisible()
  })

  /*
   * The log used to say a file was edited and never what the edit did.
   *
   * Drawn without opening anything, and outside the fold: the searching above
   * it is working out, this is the answer. The counts matter most — they are
   * what gets trusted at a glance, so a diff that miscounts is a lie in the
   * place most likely to be read.
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
    expect(screen.getByText('-two')).toBeVisible()
    expect(screen.getByText('+TWO')).toBeVisible()
    expect(screen.getByText('+1')).toBeVisible()
    expect(screen.getByText('−1')).toBeVisible()

    // The searching either side of it is still folded away.
    expect(screen.getByText('2 steps')).toBeInTheDocument()
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

    // The row is the number and the line together, so this reads as it looks.
    const row = (text: string): string => screen.getByText(text).parentElement?.textContent ?? ''

    expect(row('one')).toBe('1 one')
    // Gone from the file, so there is no line of the file to point at.
    expect(row('-two')).toBe('-two')
    expect(row('+TWO')).toBe('2+TWO')
    expect(row('+EXTRA')).toBe('3+EXTRA')
    expect(row('four')).toBe('4 four')
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

    const row = (text: string): string => screen.getByText(text).parentElement?.textContent ?? ''

    expect(row('-one')).toBe('-one')
    expect(row('+two')).toBe('+two')
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
    expect(screen.getByText('-oldName')).toBeVisible()
    expect(screen.getByText('+newName')).toBeVisible()
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
    expect(screen.getByText('+one')).toBeVisible()
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

    const summary = screen.getByText('Thinking')
    expect(screen.getByText('weighing it up')).not.toBeVisible()

    await user.click(summary)
    expect(screen.getByText('weighing it up')).toBeVisible()
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

  // With text arriving the answer is visibly under way; a second indicator is
  // only noise.
  it('drops the indicator once text starts arriving', () => {
    renderLog({ busy: true, streaming: { text: 'Looking', thinking: '' } })

    expect(screen.queryByText('Working…')).not.toBeInTheDocument()
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

  /*
   * And it is not a step either. Counted as one, the fold would promise a row
   * that nothing inside it accounts for — the same reason a plan and an edit
   * are kept out of the count.
   */
  it('does not count as a step in a run of tool calls', () => {
    renderLog({
      entries: [
        fromAgent({ type: 'tool_use', toolUseId: 'c-1', name: 'Grep', input: { pattern: 'x' } }),
        fromAgent({ type: 'tool_use', toolUseId: 'c-2', name: 'AskUserQuestion', input: ASKED }),
        fromAgent({ type: 'tool_use', toolUseId: 'c-3', name: 'Read', input: { file_path: '/a' } })
      ]
    })

    expect(screen.getByText('2 steps')).toBeInTheDocument()
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
