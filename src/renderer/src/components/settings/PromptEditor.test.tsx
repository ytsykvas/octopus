import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { PROMPT_TEXT_MAX, PROMPT_TITLE_MAX, type Prompt } from '@core/promptSchema.js'

import { stubDialogElement } from '../../test/dialog.js'
import { PromptEditor } from './PromptEditor.js'

beforeAll(stubDialogElement)

const EXISTING: Prompt = {
  id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
  title: 'Tighten plan',
  text: 'Make the plan smaller.',
  forPlan: true
}

function renderEditor(
  options: {
    readonly prompt?: Prompt | null
    readonly saved?: boolean
    readonly error?: string | null
  } = {}
): { onSave: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onSave = vi.fn().mockResolvedValue(options.saved ?? true)
  const onClose = vi.fn()

  render(
    <PromptEditor
      prompt={options.prompt ?? null}
      error={options.error ?? null}
      onSave={onSave}
      onClose={onClose}
    />
  )

  return { onSave, onClose }
}

const titleField = (): HTMLElement => screen.getByLabelText('Title')
const textField = (): HTMLElement => screen.getByLabelText('Text')
const saveButton = (): HTMLElement => screen.getByRole('button', { name: 'Save' })
const planSwitch = (): HTMLElement => screen.getByRole('switch', { name: 'For plan refinement' })

describe('a new prompt', () => {
  it('starts empty, not for the plan, and cannot be saved yet', () => {
    renderEditor()

    expect(screen.getByRole('dialog', { name: 'New prompt' })).toBeInTheDocument()
    expect(titleField()).toHaveValue('')
    expect(textField()).toHaveValue('')
    expect(planSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(saveButton()).toBeDisabled()
  })

  it('cannot be saved with a title or a text that is only space', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.type(titleField(), '   ')
    await user.type(textField(), 'Something')
    expect(saveButton()).toBeDisabled()

    await user.clear(titleField())
    await user.type(titleField(), 'Title')
    await user.clear(textField())
    await user.type(textField(), '  \n ')
    expect(saveButton()).toBeDisabled()
  })

  it('limits the fields to what core accepts', () => {
    renderEditor()

    expect(titleField()).toHaveAttribute('maxlength', String(PROMPT_TITLE_MAX))
    expect(textField()).toHaveAttribute('maxlength', String(PROMPT_TEXT_MAX))
  })

  it('hands over what was typed, and closes once it was written', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderEditor()

    await user.click(planSwitch())
    await user.type(titleField(), 'Review')
    await user.type(textField(), 'Look it over.')
    await user.click(saveButton())

    expect(onSave).toHaveBeenCalledWith({ title: 'Review', text: 'Look it over.', forPlan: true })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // What is saved is what core keeps: space around the words is not part of them.
  it('hands over the words without the space around them', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor()

    await user.type(titleField(), '  Review  ')
    await user.type(textField(), '\n  Look it over.  \n')
    await user.click(saveButton())

    expect(onSave).toHaveBeenCalledWith({ title: 'Review', text: 'Look it over.', forPlan: false })
  })

  // A refusal is the caller's to say, and the dialog stays so it can be fixed.
  it('stays open when the save is refused', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderEditor({ saved: false })

    await user.type(titleField(), 'Review')
    await user.type(textField(), 'Look it over.')
    await user.click(saveButton())

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
  })

  it('does not save twice while the first save is on its way', async () => {
    const user = userEvent.setup()
    let settle: (written: boolean) => void = () => undefined
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        })
    )
    render(<PromptEditor prompt={null} error={null} onSave={onSave} onClose={vi.fn()} />)

    await user.type(titleField(), 'Review')
    await user.type(textField(), 'Look it over.')
    await user.click(saveButton())

    expect(saveButton()).toBeDisabled()
    settle(true)
  })
})

describe('an existing prompt', () => {
  it('opens with its own words and its switch where it was', () => {
    renderEditor({ prompt: EXISTING })

    expect(screen.getByRole('dialog', { name: 'Edit prompt' })).toBeInTheDocument()
    expect(titleField()).toHaveValue('Tighten plan')
    expect(textField()).toHaveValue('Make the plan smaller.')
    expect(planSwitch()).toHaveAttribute('aria-checked', 'true')
    expect(saveButton()).toBeEnabled()
  })

  it('saves the change with the switch turned off', async () => {
    const user = userEvent.setup()
    const { onSave } = renderEditor({ prompt: EXISTING })

    await user.click(planSwitch())
    await user.click(saveButton())

    expect(onSave).toHaveBeenCalledWith({
      title: 'Tighten plan',
      text: 'Make the plan smaller.',
      forPlan: false
    })
  })
})

describe('closing', () => {
  it('leaves without saving on cancel', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderEditor()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('a refusal', () => {
  // The dialog covers the section behind it, so a message drawn there would be
  // one nobody reads.
  it('is said inside the dialog', () => {
    renderEditor({ error: 'That prompt is not there any more.' })

    expect(screen.getByText('That prompt is not there any more.')).toBeInTheDocument()
  })

  it('says nothing when there was none', () => {
    renderEditor()

    expect(screen.queryByText('That prompt is not there any more.')).not.toBeInTheDocument()
  })
})
