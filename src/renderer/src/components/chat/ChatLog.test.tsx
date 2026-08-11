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

function renderLog(overrides: Partial<React.ComponentProps<typeof ChatLog>> = {}): {
  onAnswer: ReturnType<typeof vi.fn>
} {
  const onAnswer = vi.fn()

  render(
    <ChatLog
      entries={[]}
      streaming={{ text: '', thinking: '' }}
      busy={false}
      pendingRequestId={null}
      onAnswer={onAnswer}
      {...overrides}
    />
  )

  return { onAnswer }
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
