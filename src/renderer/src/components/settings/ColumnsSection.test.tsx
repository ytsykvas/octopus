import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { type BoardColumnSet, type Column, DEFAULT_COLUMNS } from '@core/boardColumns.js'

import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { ColumnsSection } from './ColumnsSection.js'

beforeAll(stubDialogElement)

const IDEAS: Column = { kind: 'custom', id: 'Ideas', name: 'Ideas to try' }

function holding(set: BoardColumnSet): void {
  vi.mocked(octopus().board.columns).mockResolvedValue({ ok: true, value: set })
}

async function renderSection(projectId: string | null = null): Promise<void> {
  render(<ColumnsSection projectId={projectId} />)
  await screen.findByRole('listitem', { name: 'Backlog' })
}

const row = (name: string): HTMLElement => screen.getByRole('listitem', { name })

describe('ColumnsSection', () => {
  it('lists the columns in their order, the built-in ones marked and left without edits', async () => {
    holding({ columns: [IDEAS, ...DEFAULT_COLUMNS], own: false })

    await renderSection()

    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Ideas to try',
      'Backlog',
      'In progress',
      'Testing',
      'Staging',
      'Done',
      'Blocked'
    ])
    expect(within(row('Done')).getByText('Built in')).toBeInTheDocument()
    expect(within(row('Done')).queryByRole('button', { name: /Rename|Remove/ })).toBeNull()
    expect(within(row('Ideas to try')).queryByText('Built in')).toBeNull()
  })

  it('says the default columns are where every board starts', async () => {
    await renderSection()

    expect(screen.getByText(/Every project’s board shows these/)).toBeInTheDocument()
    expect(screen.queryByText(/The same as the default columns/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use the default columns' })).toBeNull()
  })

  it('adds a column under the name typed', async () => {
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Add column' }))
    const asking = within(await screen.findByRole('dialog', { name: 'New column' }))
    await user.type(asking.getByRole('textbox', { name: 'Name' }), 'Review')
    await user.click(asking.getByRole('button', { name: 'Add' }))

    expect(octopus().board.editColumns).toHaveBeenCalledWith(null, { kind: 'add', name: 'Review' })
  })

  it('adds nothing when the name is not given', async () => {
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Add column' }))
    const asking = within(await screen.findByRole('dialog', { name: 'New column' }))
    await user.click(asking.getByRole('button', { name: 'Cancel' }))

    expect(octopus().board.editColumns).not.toHaveBeenCalled()
  })

  it('will not take a name longer than a header holds', async () => {
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Add column' }))
    const asking = within(await screen.findByRole('dialog', { name: 'New column' }))
    fireEvent.change(asking.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'x'.repeat(61) }
    })

    expect(asking.getByText('A name is one line of up to 60 characters.')).toBeInTheDocument()
    expect(asking.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('renames an added column, starting from its name', async () => {
    holding({ columns: [...DEFAULT_COLUMNS, IDEAS], own: false })
    const user = userEvent.setup()
    await renderSection()

    await user.click(
      within(row('Ideas to try')).getByRole('button', { name: 'Rename “Ideas to try”' })
    )
    const asking = within(await screen.findByRole('dialog', { name: 'Rename column' }))
    const field = asking.getByRole('textbox', { name: 'Name' })
    expect(field).toHaveValue('Ideas to try')
    await user.clear(field)
    await user.type(field, 'Thoughts')
    await user.click(asking.getByRole('button', { name: 'Rename' }))

    expect(octopus().board.editColumns).toHaveBeenCalledWith(null, {
      kind: 'rename',
      id: 'Ideas',
      name: 'Thoughts'
    })
  })

  it('renames nothing when the question is cancelled', async () => {
    holding({ columns: [...DEFAULT_COLUMNS, IDEAS], own: false })
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Rename “Ideas to try”' }))
    const asking = within(await screen.findByRole('dialog', { name: 'Rename column' }))
    await user.click(asking.getByRole('button', { name: 'Cancel' }))

    expect(octopus().board.editColumns).not.toHaveBeenCalled()
  })

  it('asks first, and removes an added column once told to', async () => {
    holding({ columns: [...DEFAULT_COLUMNS, IDEAS], own: false })
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Remove “Ideas to try”' }))
    const asking = within(await screen.findByRole('dialog', { name: 'Remove “Ideas to try”?' }))
    expect(
      asking.getByText('The column leaves the board. Its folder stays on disk.')
    ).toBeInTheDocument()
    await user.click(asking.getByRole('button', { name: 'Remove' }))

    expect(octopus().board.editColumns).toHaveBeenCalledWith(null, { kind: 'remove', id: 'Ideas' })
  })

  it('keeps the column when the removal is cancelled', async () => {
    holding({ columns: [...DEFAULT_COLUMNS, IDEAS], own: false })
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Remove “Ideas to try”' }))
    const asking = within(await screen.findByRole('dialog', { name: 'Remove “Ideas to try”?' }))
    await user.click(asking.getByRole('button', { name: 'Cancel' }))

    expect(octopus().board.editColumns).not.toHaveBeenCalled()
  })

  it('says why a column could not be removed', async () => {
    holding({ columns: [...DEFAULT_COLUMNS, IDEAS], own: false })
    vi.mocked(octopus().board.editColumns).mockResolvedValue({
      ok: false,
      error: 'still there',
      code: 'columnNotEmpty',
      params: { project: 'planner', count: '2' }
    })
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Remove “Ideas to try”' }))
    const asking = within(await screen.findByRole('dialog', { name: 'Remove “Ideas to try”?' }))
    await user.click(asking.getByRole('button', { name: 'Remove' }))

    expect(
      await screen.findByText(
        'Tasks still in that column on the “planner” board: 2. Move them out first.'
      )
    ).toBeInTheDocument()
  })

  it('puts a column where it is dropped', async () => {
    await renderSection()

    fireEvent.dragStart(row('Backlog'))
    fireEvent.dragOver(row('Testing'))
    fireEvent.drop(row('Testing'))

    expect(octopus().board.editColumns).toHaveBeenCalledWith(null, {
      kind: 'reorder',
      ids: ['in progress', 'testing', 'backlog', 'staging', 'done', 'blocked']
    })
  })

  it('draws the line where the dragged column would land, and dims it', async () => {
    await renderSection()

    fireEvent.dragStart(row('Backlog'))
    fireEvent.dragOver(row('Testing'))

    expect(within(row('Testing')).getByTestId('drop-line')).toHaveAttribute('data-edge', 'below')
    expect(row('Backlog')).toHaveClass('opacity-40')
  })

  it('moves a column with Alt and an arrow on its handle', async () => {
    await renderSection()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder “Done” (Alt+↑ / Alt+↓)' }), {
      key: 'ArrowUp',
      altKey: true
    })

    expect(octopus().board.editColumns).toHaveBeenCalledWith(null, {
      kind: 'reorder',
      ids: ['backlog', 'in progress', 'testing', 'done', 'staging', 'blocked']
    })
  })

  describe("a project's columns", () => {
    it('says they follow the default ones, with nothing to reset', async () => {
      await renderSection('planner')

      expect(octopus().board.columns).toHaveBeenCalledWith('planner')
      expect(screen.getByText(/The same as the default columns/)).toBeInTheDocument()
      expect(screen.getByText('The columns of this project’s board.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Use the default columns' })).toBeNull()
    })

    it('edits the columns of that project', async () => {
      const user = userEvent.setup()
      await renderSection('planner')

      await user.click(screen.getByRole('button', { name: 'Add column' }))
      const asking = within(await screen.findByRole('dialog', { name: 'New column' }))
      await user.type(asking.getByRole('textbox', { name: 'Name' }), 'Review')
      await user.click(asking.getByRole('button', { name: 'Add' }))

      expect(octopus().board.editColumns).toHaveBeenCalledWith('planner', {
        kind: 'add',
        name: 'Review'
      })
    })

    it('sends columns of its own back to the default ones', async () => {
      holding({ columns: [...DEFAULT_COLUMNS, IDEAS], own: true })
      const user = userEvent.setup()
      await renderSection('planner')

      expect(screen.getByText('This project has columns of its own.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Use the default columns' }))

      expect(octopus().board.resetColumns).toHaveBeenCalledWith('planner')
      await waitFor(() => {
        expect(screen.queryByRole('listitem', { name: 'Ideas to try' })).toBeNull()
      })
    })
  })
})
