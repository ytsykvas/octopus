import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ElicitationField } from '@core/elicitation.js'

import { ElicitationCard } from './ElicitationCard.js'

const TOKEN: ElicitationField = {
  kind: 'text',
  name: 'token',
  label: 'Token',
  description: 'From your account page.',
  required: true,
  value: ''
}

interface Rendered {
  readonly onAnswer: ReturnType<typeof vi.fn>
  readonly onDecline: ReturnType<typeof vi.fn>
}

function renderCard(
  options: {
    readonly fields?: readonly ElicitationField[]
    readonly answerable?: boolean
    readonly answered?: 'accept' | 'decline' | 'cancel' | null
    readonly title?: string
  } = {}
): Rendered {
  const onAnswer = vi.fn()
  const onDecline = vi.fn()

  render(
    <ElicitationCard
      serverName="ledger"
      message="Which token should I use?"
      title={options.title ?? ''}
      fields={options.fields ?? [TOKEN]}
      answerable={options.answerable ?? true}
      answered={options.answered ?? null}
      onAnswer={onAnswer}
      onDecline={onDecline}
    />
  )

  return { onAnswer, onDecline }
}

describe('a question from an MCP server', () => {
  /*
   * The one card in the log that comes from software nobody here wrote — a
   * `.mcp.json` in a checkout starts these — so whose question it is comes
   * before what it asks. A form asking for a token with no visible author is
   * the shape a phishing prompt has.
   */
  it('says whose question it is before saying what it asks', () => {
    renderCard()

    expect(screen.getByText('A question from ledger')).toBeInTheDocument()
    expect(screen.getByText('Which token should I use?')).toBeInTheDocument()
  })

  it('draws a heading only where the server offered one', () => {
    renderCard({ title: 'Credentials' })
    expect(screen.getByText('Credentials')).toBeInTheDocument()
  })

  it('draws a text field with what the server said about it', () => {
    renderCard()

    expect(screen.getByLabelText('Token')).toBeInTheDocument()
    expect(screen.getByText('From your account page.')).toBeInTheDocument()
  })

  // So the reader can tell what the server insists on from what it merely
  // offered a place for.
  it('marks a field the server can do without', () => {
    renderCard({ fields: [{ ...TOKEN, required: false }] })

    expect(screen.getByLabelText('Token (optional)')).toBeInTheDocument()
  })

  it('sends what was typed', async () => {
    const user = userEvent.setup()
    const { onAnswer } = renderCard()

    await user.type(screen.getByLabelText('Token'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Answer' }))

    expect(onAnswer).toHaveBeenCalledWith({ token: 'abc' })
  })

  it('cannot be sent until every required field is answered', async () => {
    const user = userEvent.setup()
    renderCard()

    expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled()

    await user.type(screen.getByLabelText('Token'), 'a')
    expect(screen.getByRole('button', { name: 'Answer' })).toBeEnabled()
  })

  it('turns one down without sending anything', async () => {
    const user = userEvent.setup()
    const { onAnswer, onDecline } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Decline' }))

    expect(onDecline).toHaveBeenCalled()
    expect(onAnswer).not.toHaveBeenCalled()
  })

  // A server that suggested something has suggested it, rather than merely
  // mentioned it somewhere the reader has to retype.
  it('starts from the values the schema carried', async () => {
    const user = userEvent.setup()
    const { onAnswer } = renderCard({
      fields: [{ ...TOKEN, value: 'ghp_', required: false }]
    })

    expect(screen.getByLabelText('Token (optional)')).toHaveValue('ghp_')

    await user.click(screen.getByRole('button', { name: 'Answer' }))
    expect(onAnswer).toHaveBeenCalledWith({ token: 'ghp_' })
  })
})

describe('the kinds of field', () => {
  it('draws a flag as a checkbox, which is answered either way round', async () => {
    const user = userEvent.setup()
    const { onAnswer } = renderCard({
      fields: [
        {
          kind: 'boolean',
          name: 'save',
          label: 'Remember it',
          description: 'Kept for next time.',
          required: true,
          value: false
        }
      ]
    })

    // Required and untouched, and the form may still be sent: there is no empty
    // checkbox.
    expect(screen.getByRole('button', { name: 'Answer' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: /Remember it/ }))
    await user.click(screen.getByRole('button', { name: 'Answer' }))

    expect(onAnswer).toHaveBeenCalledWith({ save: true })
  })

  it('draws a choice as a list, starting on none of them', async () => {
    const user = userEvent.setup()
    const { onAnswer } = renderCard({
      fields: [
        {
          kind: 'choice',
          name: 'env',
          label: 'Environment',
          description: '',
          required: true,
          value: '',
          choices: [
            { value: 'dev', label: 'Development' },
            { value: 'prod', label: 'Production' }
          ]
        }
      ]
    })

    // Not silently on whichever the server listed first: a required choice
    // starts unanswered, and the button says so.
    expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Environment'), 'prod')
    await user.click(screen.getByRole('button', { name: 'Answer' }))

    expect(onAnswer).toHaveBeenCalledWith({ env: 'prod' })
  })

  // The platform's own keypad and stepper, while the value stays text: a
  // half-typed number is not one.
  it('draws a number as a number field', () => {
    renderCard({
      fields: [
        {
          kind: 'number',
          name: 'port',
          label: 'Port',
          description: '',
          required: false,
          value: '8080',
          integer: true
        }
      ]
    })

    expect(screen.getByLabelText('Port (optional)')).toHaveAttribute('type', 'number')
  })
})

describe('one that is no longer waiting', () => {
  /*
   * A record of itself. Buttons on a question nobody is holding open would let
   * the user answer into nothing.
   */
  it('offers no buttons', () => {
    renderCard({ answerable: false, answered: 'accept' })

    expect(screen.queryByRole('button', { name: 'Answer' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Token')).toBeDisabled()
  })

  // `decline` and `cancel` are different words to a server, so they are
  // different sentences here.
  it('says what became of it', () => {
    renderCard({ answerable: false, answered: 'accept' })
    expect(screen.getByText('Answered.')).toBeInTheDocument()
  })

  it('tells being turned down from being withdrawn', () => {
    renderCard({ answerable: false, answered: 'decline' })
    expect(screen.getByText('Declined.')).toBeInTheDocument()
  })

  it('says when the turn took it away', () => {
    renderCard({ answerable: false, answered: 'cancel' })
    expect(screen.getByText('Withdrawn when the turn stopped.')).toBeInTheDocument()
  })

  // Neither open nor recorded: the turn it belonged to is gone and the
  // transcript never got its outcome.
  it('says so when nothing was ever recorded', () => {
    renderCard({ answerable: false, answered: null })
    expect(screen.getByText('No longer waiting for an answer.')).toBeInTheDocument()
  })
})
