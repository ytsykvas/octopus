import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { stubDialogElement } from '../../test/dialog.js'
import { CardResources, type CardResourcesProps } from './CardResources.js'

beforeAll(stubDialogElement)

function renderResources(
  links: readonly string[] = [],
  onLinks = vi.fn<CardResourcesProps['onLinks']>(() => Promise.resolve(true))
): { onLinks: typeof onLinks } {
  render(<CardResources links={links} onLinks={onLinks} />)
  return { onLinks }
}

function linksUpTo(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `https://a.example/${String(i)}`)
}

async function askForLink(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Add' }))
  await user.click(screen.getByRole('menuitem', { name: 'Add link' }))
  return screen.findByRole('dialog', { name: 'Add link' })
}

describe('CardResources', () => {
  it('says there are no links yet', () => {
    renderResources()

    expect(screen.getByText('No links.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('adds a link typed in the dialog', async () => {
    const user = userEvent.setup()
    const { onLinks } = renderResources()

    const dialog = await askForLink(user)
    await user.type(within(dialog).getByLabelText('Link'), 'https://github.com/o/r/issues/12')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(onLinks).toHaveBeenCalledOnce()
    expect(onLinks).toHaveBeenCalledWith(['https://github.com/o/r/issues/12'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('adds what was typed without the spaces around it', async () => {
    const user = userEvent.setup()
    const { onLinks } = renderResources()

    const dialog = await askForLink(user)
    await user.type(within(dialog).getByLabelText('Link'), '  https://a.example/x  ')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(onLinks).toHaveBeenCalledWith(['https://a.example/x'])
  })

  it('refuses a link that is not a web page', async () => {
    const user = userEvent.setup()
    const { onLinks } = renderResources()

    const dialog = await askForLink(user)
    await user.type(within(dialog).getByLabelText('Link'), 'javascript:alert(1)')

    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(screen.getByText('Only http and https links can be added.')).toBeInTheDocument()
    expect(onLinks).not.toHaveBeenCalled()
  })

  it('adds nothing when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    const { onLinks } = renderResources()

    const dialog = await askForLink(user)
    await user.type(within(dialog).getByLabelText('Link'), 'https://a.example/x')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onLinks).not.toHaveBeenCalled()
  })

  it('does not add a link twice', async () => {
    const user = userEvent.setup()
    const { onLinks } = renderResources(['https://a.example/x'])

    const dialog = await askForLink(user)
    await user.type(within(dialog).getByLabelText('Link'), 'https://a.example/x')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onLinks).not.toHaveBeenCalled()
  })

  it('stops offering links at twenty', async () => {
    const user = userEvent.setup()
    renderResources(linksUpTo(20))

    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('menuitem', { name: 'Add link' })).toBeDisabled()
  })

  it('offers links below twenty', async () => {
    const user = userEvent.setup()
    renderResources(linksUpTo(19))

    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('menuitem', { name: 'Add link' })).toBeEnabled()
  })

  it('removes a link', async () => {
    const user = userEvent.setup()
    const { onLinks } = renderResources(['https://a.example/1', 'https://a.example/2'])

    const [, second] = screen.getAllByRole('button', { name: 'Remove link' })
    if (!second) throw new Error('no second link')
    await user.click(second)

    expect(onLinks).toHaveBeenCalledWith(['https://a.example/1'])
  })

  it('opens a link in the browser, not in the window', () => {
    renderResources(['https://a.example/1'])

    const link = screen.getByRole('link', { name: 'https://a.example/1' })
    expect(link).toHaveAttribute('href', 'https://a.example/1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })
})
