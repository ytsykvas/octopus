import { act, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(
      screen.getByText(
        'Only http and https links can be added, with no user name or password and up to 2,000 characters.'
      )
    ).toBeInTheDocument()
    expect(onLinks).not.toHaveBeenCalled()
  })

  it('refuses a link longer than a card keeps', async () => {
    const user = userEvent.setup()
    renderResources()

    const dialog = await askForLink(user)
    await user.click(within(dialog).getByLabelText('Link'))
    await user.paste('https://a.example/' + 'x'.repeat(1983))

    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
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

    await user.click(screen.getByRole('button', { name: 'Remove https://a.example/2' }))

    expect(onLinks).toHaveBeenCalledWith(['https://a.example/1'])
  })

  it('takes no second change while one is being written', async () => {
    const user = userEvent.setup()
    let finish: (written: boolean) => void = () => undefined
    const onLinks = vi.fn<CardResourcesProps['onLinks']>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    renderResources(['https://a.example/1', 'https://a.example/2'], onLinks)

    await user.click(screen.getByRole('button', { name: 'Remove https://a.example/1' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('button', { name: 'Remove https://a.example/2' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Add link' })).toBeDisabled()
    act(() => {
      finish(true)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove https://a.example/2' })).toBeEnabled()
    })
    expect(onLinks).toHaveBeenCalledOnce()
  })

  it('takes no change while an added link is being written', async () => {
    const user = userEvent.setup()
    const onLinks = vi.fn<CardResourcesProps['onLinks']>(() => new Promise(() => undefined))
    renderResources(['https://a.example/1'], onLinks)

    const dialog = await askForLink(user)
    await user.type(within(dialog).getByLabelText('Link'), 'https://a.example/2')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('button', { name: 'Remove https://a.example/1' })).toBeDisabled()
  })

  it('opens a link in the browser, not in the window', () => {
    renderResources(['https://a.example/1'])

    const link = screen.getByRole('link', { name: 'https://a.example/1' })
    expect(link).toHaveAttribute('href', 'https://a.example/1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })
})
