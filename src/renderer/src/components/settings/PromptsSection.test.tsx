import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { PromptsSection } from './PromptsSection.js'

// The editor and the removal question are `Modal`s.
beforeAll(stubDialogElement)

const GLOBAL = { kind: 'global' } as const
const PROJECT = { kind: 'project', projectId: 'planner' } as const

let made = 0

function prompt(title: string, overrides: Partial<Prompt> = {}): Prompt {
  made += 1

  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`,
    title,
    text: `${title} first line\nand a second`,
    forPlan: false,
    ...overrides
  }
}

const REVIEW = prompt('Review')
const TESTS = prompt('Tests', { forPlan: true })
const EXPLAIN = prompt('Explain')

const holding = (prompts: readonly Prompt[]): void => {
  vi.mocked(octopus().prompts.list).mockResolvedValue({ ok: true, value: [...prompts] })
}

async function renderSection(store: typeof GLOBAL | typeof PROJECT = GLOBAL): Promise<void> {
  render(<PromptsSection store={store} />)

  await waitFor(() => {
    expect(octopus().prompts.list).toHaveBeenCalled()
  })
}

const row = (title: string): HTMLElement => screen.getByRole('listitem', { name: title })

beforeEach(() => {
  holding([])
})

describe('an empty store', () => {
  it('says so and offers to add one', async () => {
    await renderSection()

    expect(screen.getByText('No prompts yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add prompt' })).toBeInTheDocument()
  })

  it('explains what a prompt is, and for the installation where the project ones live', async () => {
    await renderSection(GLOBAL)

    expect(screen.getByText(/Unlike a command/)).toBeInTheDocument()
    expect(screen.getByText(/live in that project/)).toBeInTheDocument()
  })

  it('does not point a project at itself', async () => {
    await renderSection(PROJECT)

    expect(screen.queryByText(/live in that project/)).not.toBeInTheDocument()
    expect(octopus().prompts.list).toHaveBeenCalledWith(PROJECT)
  })
})

describe('the rows', () => {
  it('show a title and the first line of what it says', async () => {
    holding([REVIEW, TESTS])
    await renderSection()

    expect(await screen.findByText('Review first line')).toBeInTheDocument()
    expect(within(row('Tests')).getByText('Tests first line')).toBeInTheDocument()
  })

  it('mark the ones the plan dialog offers, and only those', async () => {
    holding([REVIEW, TESTS])
    await renderSection()

    await screen.findByText('Review first line')
    expect(within(row('Tests')).getByText('Plan')).toBeInTheDocument()
    expect(within(row('Review')).queryByText('Plan')).not.toBeInTheDocument()
  })
})

describe('adding one', () => {
  it('writes what was typed into the store it is shown for', async () => {
    const user = userEvent.setup()
    await renderSection(PROJECT)

    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    await user.click(screen.getByRole('switch', { name: 'For plan refinement' }))
    await user.type(screen.getByLabelText('Title'), 'Review')
    await user.type(screen.getByLabelText('Text'), 'Look it over.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(octopus().prompts.create).toHaveBeenCalledWith(PROJECT, {
      title: 'Review',
      text: 'Look it over.',
      forPlan: true
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('changing one', () => {
  it('opens it with its words and writes the change over it', async () => {
    const user = userEvent.setup()
    holding([REVIEW])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'Edit “Review”' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Review')

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Review PR')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(octopus().prompts.update).toHaveBeenCalledWith(GLOBAL, REVIEW.id, {
      title: 'Review PR',
      text: REVIEW.text,
      forPlan: false
    })
  })

  it('closes the editor without writing on cancel', async () => {
    const user = userEvent.setup()
    holding([REVIEW])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'Edit “Review”' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(octopus().prompts.update).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('removing one', () => {
  it('asks first, and removes it once told to', async () => {
    const user = userEvent.setup()
    holding([REVIEW])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'Remove “Review”' }))
    expect(octopus().prompts.remove).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(octopus().prompts.remove).toHaveBeenCalledWith(GLOBAL, REVIEW.id)
  })

  it('keeps it when the question is cancelled', async () => {
    const user = userEvent.setup()
    holding([REVIEW])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'Remove “Review”' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(octopus().prompts.remove).not.toHaveBeenCalled()
  })
})

describe('putting them in order', () => {
  const three = [REVIEW, TESTS, EXPLAIN]

  async function threeRows(): Promise<void> {
    holding(three)
    await renderSection()
    await screen.findByText('Review first line')
  }

  it('moves one down onto the row it is dropped on', async () => {
    await threeRows()

    fireEvent.dragStart(row('Review'))
    fireEvent.dragOver(row('Explain'))
    fireEvent.drop(row('Explain'))

    expect(octopus().prompts.reorder).toHaveBeenCalledWith(GLOBAL, [
      TESTS.id,
      EXPLAIN.id,
      REVIEW.id
    ])
  })

  it('moves one up onto the row it is dropped on', async () => {
    await threeRows()

    fireEvent.dragStart(row('Explain'))
    fireEvent.drop(row('Review'))

    expect(octopus().prompts.reorder).toHaveBeenCalledWith(GLOBAL, [
      EXPLAIN.id,
      REVIEW.id,
      TESTS.id
    ])
  })

  it('does nothing when a row is dropped on itself', async () => {
    await threeRows()

    fireEvent.dragStart(row('Tests'))
    fireEvent.drop(row('Tests'))

    expect(octopus().prompts.reorder).not.toHaveBeenCalled()
  })

  it('does nothing for a drop with no drag behind it', async () => {
    await threeRows()

    fireEvent.drop(row('Tests'))

    expect(octopus().prompts.reorder).not.toHaveBeenCalled()
  })

  it('draws the line on the edge the row would land against', async () => {
    await threeRows()

    fireEvent.dragStart(row('Tests'))
    fireEvent.dragOver(row('Explain'))
    expect(screen.getByTestId('drop-line').className).toContain('-bottom-')

    fireEvent.dragOver(row('Review'))
    expect(screen.getByTestId('drop-line').className).toContain('-top-')
  })

  it('draws no line over the row being dragged, and none once it ends', async () => {
    await threeRows()

    fireEvent.dragStart(row('Tests'))
    fireEvent.dragOver(row('Tests'))
    expect(screen.queryByTestId('drop-line')).not.toBeInTheDocument()
    expect(row('Tests').className).toContain('opacity-40')

    fireEvent.dragOver(row('Explain'))
    fireEvent.dragEnd(row('Tests'))
    expect(screen.queryByTestId('drop-line')).not.toBeInTheDocument()
    expect(row('Tests').className).not.toContain('opacity-40')
  })

  describe('from the keyboard', () => {
    const handle = (title: string): HTMLElement =>
      screen.getByRole('button', { name: new RegExp(`^Reorder “${title}”`) })

    it('moves a row down with Alt and the down arrow', async () => {
      await threeRows()

      fireEvent.keyDown(handle('Review'), { key: 'ArrowDown', altKey: true })

      expect(octopus().prompts.reorder).toHaveBeenCalledWith(GLOBAL, [
        TESTS.id,
        REVIEW.id,
        EXPLAIN.id
      ])
    })

    it('moves a row up with Alt and the up arrow', async () => {
      await threeRows()

      fireEvent.keyDown(handle('Explain'), { key: 'ArrowUp', altKey: true })

      expect(octopus().prompts.reorder).toHaveBeenCalledWith(GLOBAL, [
        REVIEW.id,
        EXPLAIN.id,
        TESTS.id
      ])
    })

    it('does not move the first row up or the last row down', async () => {
      await threeRows()

      fireEvent.keyDown(handle('Review'), { key: 'ArrowUp', altKey: true })
      fireEvent.keyDown(handle('Explain'), { key: 'ArrowDown', altKey: true })

      expect(octopus().prompts.reorder).not.toHaveBeenCalled()
    })

    it('leaves the arrows alone without Alt, and other keys alone with it', async () => {
      await threeRows()

      fireEvent.keyDown(handle('Tests'), { key: 'ArrowDown' })
      fireEvent.keyDown(handle('Tests'), { key: 'Enter', altKey: true })

      expect(octopus().prompts.reorder).not.toHaveBeenCalled()
    })
  })
})

describe('a failure', () => {
  it('is said under the heading when no dialog covers it', async () => {
    holding([REVIEW])
    vi.mocked(octopus().prompts.remove).mockResolvedValue({
      ok: false,
      error: 'gone',
      code: 'promptMissing'
    })
    const user = userEvent.setup()
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'Remove “Review”' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('That prompt is not there any more.')).toBeInTheDocument()
  })

  it('is said inside the editor while the editor is open, and only there', async () => {
    holding([REVIEW])
    vi.mocked(octopus().prompts.update).mockResolvedValue({
      ok: false,
      error: 'gone',
      code: 'promptMissing'
    })
    const user = userEvent.setup()
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'Edit “Review”' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const messages = await screen.findAllByText('That prompt is not there any more.')
    expect(messages).toHaveLength(1)
    expect(screen.getByRole('dialog')).toContainElement(messages[0] ?? null)
  })
})
