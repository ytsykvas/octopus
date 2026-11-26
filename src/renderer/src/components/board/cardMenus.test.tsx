import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_COLUMNS } from '@core/boardColumns.js'

import { StatusMenu } from './cardMenus.js'

describe('StatusMenu', () => {
  it('names a column removed since by its id, and offers the ones there are', async () => {
    const onChoose = vi.fn()
    render(<StatusMenu columns={DEFAULT_COLUMNS} status="ideas" onChoose={onChoose} />)

    await userEvent.click(screen.getByRole('button', { name: 'ideas' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Testing' }))

    expect(onChoose).toHaveBeenCalledWith('testing')
  })
})
