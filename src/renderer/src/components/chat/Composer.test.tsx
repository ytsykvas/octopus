import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModel } from '@core/chats.js'

import { Composer } from './Composer.js'

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}): {
  onSend: ReturnType<typeof vi.fn>
  onStop: ReturnType<typeof vi.fn>
  onWorkingMode: ReturnType<typeof vi.fn>
  onPlanMode: ReturnType<typeof vi.fn>
  onEffort: ReturnType<typeof vi.fn>
  onModel: ReturnType<typeof vi.fn>
} {
  const onSend = vi.fn()
  const onStop = vi.fn()
  const onWorkingMode = vi.fn()
  const onEffort = vi.fn()
  const onModel = vi.fn()
  const onPlanMode = vi.fn()

  render(
    <Composer
      busy={false}
      workingMode="default"
      onWorkingMode={onWorkingMode}
      planMode={false}
      onPlanMode={onPlanMode}
      effort={null}
      onEffort={onEffort}
      model={null}
      onModel={onModel}
      models={[]}
      usage={{ context: null, subscription: null }}
      limit={null}
      onSend={onSend}
      onStop={onStop}
      {...overrides}
    />
  )
  return { onSend, onStop, onWorkingMode, onPlanMode, onEffort, onModel }
}

const OPUS: AgentModel = {
  value: 'claude-opus-5',
  displayName: 'Opus 5',
  description: 'The capable one',
  supportsEffort: true,
  supportedEffortLevels: ['high', 'max']
}

const field = (): HTMLElement => screen.getByRole('textbox')

describe('sending', () => {
  /*
   * Reported from a running app: narrowed to the width the layout permits, the
   * footer ran past the rounded border and took the send button off the edge of
   * the block. Enter still worked; the pane's primary control was not on screen.
   *
   * Width itself is styling and the suite does not assert classes. What is
   * asserted is the thing the width broke — every control of the row present
   * and reachable, whatever the row has to do to fit them.
   */
  it('keeps every control of the footer reachable', () => {
    renderComposer({ models: [OPUS], model: OPUS.value })

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Permissions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Effort' })).toBeInTheDocument()
  })

  it('sends what was typed and clears the field', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'add a test')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('add a test')
    expect(field()).toHaveValue('')
  })

  it('sends on enter', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'add a test{Enter}')

    expect(onSend).toHaveBeenCalledWith('add a test')
  })

  // A prompt is usually one line, but not always, and shift+enter is what every
  // chat uses for the exception.
  it('breaks the line on shift+enter instead of sending', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'first{Shift>}{Enter}{/Shift}second')

    expect(onSend).not.toHaveBeenCalled()
    expect(field()).toHaveValue('first\nsecond')
  })

  it('leaves other keys alone', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'abc')

    expect(onSend).not.toHaveBeenCalled()
  })

  it('refuses to send nothing but whitespace', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), '   {Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('trims what it sends', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), '  add a test  {Enter}')

    expect(onSend).toHaveBeenCalledWith('add a test')
  })
})

describe('while the agent is working', () => {
  // One button in one place: a send that is unavailable and a stop that is
  // would otherwise leave the user hunting for the control that applies.
  it('offers stopping instead of sending', async () => {
    const user = userEvent.setup()
    const { onStop } = renderComposer({ busy: true })

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })

  // Typing the next instruction while the agent works is normal; it goes as
  // soon as the field is submitted.
  it('still accepts typing', async () => {
    const user = userEvent.setup()
    renderComposer({ busy: true })

    await user.type(field(), 'and then deploy')
    expect(field()).toHaveValue('and then deploy')
  })
})

describe('the settings the next message runs under', () => {
  it('shows which permission mode is in force', async () => {
    const user = userEvent.setup()
    renderComposer({ workingMode: 'acceptEdits' })

    expect(screen.getByRole('button', { name: 'Permissions' })).toHaveTextContent('Accept edits')

    await user.click(screen.getByRole('button', { name: 'Permissions' }))
    expect(screen.getByRole('menuitemradio', { name: 'Accept edits' })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: 'Ask first' })).not.toBeChecked()
  })

  // Planning is a state the conversation is in, not a degree of permission —
  // the agent runs no tools at all in it. Listing the three together made them
  // look like peers, which is what this separation is for.
  describe('planning', () => {
    const planButton = (): HTMLElement => screen.getByRole('button', { name: 'Plan' })

    it('is off until it is turned on', async () => {
      const user = userEvent.setup()
      const { onPlanMode } = renderComposer()

      expect(planButton()).toHaveAttribute('aria-pressed', 'false')

      await user.click(planButton())
      expect(onPlanMode).toHaveBeenCalledExactlyOnceWith(true)
    })

    it('shows itself as on while the chat is planning', () => {
      renderComposer({ planMode: true })

      expect(planButton()).toHaveAttribute('aria-pressed', 'true')
    })

    it('turns itself off again', async () => {
      const user = userEvent.setup()
      const { onPlanMode } = renderComposer({ planMode: true })

      await user.click(planButton())
      expect(onPlanMode).toHaveBeenCalledExactlyOnceWith(false)
    })

    /*
     * The two settings are stored apart, so choosing permissions while planning
     * writes through like any other choice — there is no third value crowding
     * the field and nothing to remember locally until planning ends.
     *
     * This used to be component state precisely because there was, and that is
     * why approving a plan had no mode to return to.
     */
    it('stores a permissions choice made while planning', async () => {
      const user = userEvent.setup()
      const { onWorkingMode, onPlanMode } = renderComposer({ planMode: true })

      await user.click(screen.getByRole('button', { name: 'Permissions' }))
      await user.click(screen.getByRole('menuitemradio', { name: 'Accept edits' }))

      expect(onWorkingMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
      // Choosing what happens afterwards is not a decision to stop planning.
      expect(onPlanMode).not.toHaveBeenCalled()
    })

    it('still offers the permissions, for once the plan is approved', () => {
      renderComposer({ planMode: true })

      const picker = screen.getByRole('button', { name: 'Permissions' })
      expect(picker).toBeEnabled()
      expect(picker).toHaveAttribute('title', 'What the agent may do once the plan is approved.')
    })
  })

  it('reports the mode that was chosen', async () => {
    const user = userEvent.setup()
    const { onWorkingMode } = renderComposer()

    await user.click(screen.getByRole('button', { name: 'Permissions' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Accept edits' }))

    expect(onWorkingMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
  })

  it('offers the models the agent reported, and reports the one chosen', async () => {
    const user = userEvent.setup()
    const { onModel } = renderComposer({ models: [OPUS] })

    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Agent decides')

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(screen.getByRole('menuitemradio', { name: /Opus 5/ }))

    expect(onModel).toHaveBeenCalledExactlyOnceWith('claude-opus-5')
  })

  it('turns the agent-decides model back into no override at all', async () => {
    const user = userEvent.setup()
    const { onModel } = renderComposer({ model: OPUS.value, models: [OPUS] })

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Agent decides' }))

    expect(onModel).toHaveBeenCalledExactlyOnceWith(null)
  })

  // The list is remembered from the last session, so a chat can name a model it
  // no longer has. Showing "Agent decides" would claim a default that is not in
  // force, and there would be no way back to a real choice.
  it('keeps a model the remembered list has forgotten', async () => {
    const user = userEvent.setup()
    renderComposer({ model: 'claude-retired-3', models: [OPUS] })

    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('claude-retired-3')

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(screen.getByRole('menuitemradio', { name: 'claude-retired-3' })).toBeChecked()
  })

  it('offers only the effort levels the chosen model takes', async () => {
    const user = userEvent.setup()
    renderComposer({ model: OPUS.value, models: [OPUS] })

    await user.click(screen.getByRole('button', { name: 'Effort' }))

    expect(screen.getByRole('menuitemradio', { name: 'Maximum' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'Low' })).not.toBeInTheDocument()
  })

  // Greyed out rather than gone: a control that vanishes as the model changes
  // is harder to make sense of than one that stays and says why.
  it('greys the effort out for a model that does not take one', () => {
    const plain = { ...OPUS, supportsEffort: false, supportedEffortLevels: null }
    renderComposer({ model: plain.value, models: [plain] })

    const picker = screen.getByRole('button', { name: 'Effort' })
    expect(picker).toBeDisabled()
    expect(picker).toHaveAttribute('title', 'This model does not take an effort setting.')
  })

  // Silence is not a refusal. A model that says nothing about effort should get
  // the full list rather than have levels hidden it would in fact accept.
  it('offers every level for a model that said nothing about effort', async () => {
    const user = userEvent.setup()
    const quiet = { ...OPUS, supportsEffort: null, supportedEffortLevels: null }
    renderComposer({ model: quiet.value, models: [quiet] })

    await user.click(screen.getByRole('button', { name: 'Effort' }))

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6)
  })

  it('reports the effort that was chosen', async () => {
    const user = userEvent.setup()
    const { onEffort } = renderComposer()

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Maximum' }))

    expect(onEffort).toHaveBeenCalledExactlyOnceWith('max')
  })

  // The picker needs a value for "no override", and null is not one. Handing
  // that sentinel back to the store would be an effort level called "auto".
  it('turns the agent-decides choice back into no override at all', async () => {
    const user = userEvent.setup()
    const { onEffort } = renderComposer({ effort: 'high' })

    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('High')

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Agent decides' }))

    expect(onEffort).toHaveBeenCalledExactlyOnceWith(null)
  })

  // The whole reason it moved out of the header: there it was disabled until
  // the first message had gone, so the mode that message ran under was the one
  // mode nobody could choose.
  it('can be changed before anything has been sent', async () => {
    const user = userEvent.setup()
    const { onWorkingMode } = renderComposer()

    expect(screen.getByRole('button', { name: 'Permissions' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Permissions' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Accept edits' }))

    expect(onWorkingMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
  })
})
