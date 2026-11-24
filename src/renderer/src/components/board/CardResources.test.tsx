import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, type Mock, vi } from 'vitest'

import { stubDialogElement } from '../../test/dialog.js'
import { CardResources, type CardResourcesProps } from './CardResources.js'

beforeAll(stubDialogElement)

function renderResources(
  links: readonly string[] = [],
  onLinks = vi.fn<CardResourcesProps['onLinks']>(() => Promise.resolve(true)),
  attachments: readonly string[] = [],
  onRemoveFile = vi.fn<CardResourcesProps['onRemoveFile']>(() => Promise.resolve(true))
): {
  onLinks: typeof onLinks
  onAttach: Mock<CardResourcesProps['onAttach']>
  onReveal: Mock<CardResourcesProps['onReveal']>
  onRemoveFile: typeof onRemoveFile
} {
  const onAttach = vi.fn<CardResourcesProps['onAttach']>()
  const onReveal = vi.fn<CardResourcesProps['onReveal']>()
  render(
    <CardResources
      links={links}
      onLinks={onLinks}
      attachments={attachments}
      onAttach={onAttach}
      onReveal={onReveal}
      onRemoveFile={onRemoveFile}
    />
  )
  return { onLinks, onAttach, onReveal, onRemoveFile }
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
  it('says there are no links or files yet, and nothing of the kind beside a link', () => {
    renderResources()

    expect(screen.getByText('No links or files.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()

    cleanup()
    renderResources(['https://a.example/1'])

    expect(screen.queryByText('No links or files.')).toBeNull()
    expect(screen.getAllByRole('list')).toHaveLength(1)
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

  it('attaches files from the menu', async () => {
    const user = userEvent.setup()
    const { onAttach } = renderResources()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add files' }))

    expect(onAttach).toHaveBeenCalledTimes(1)
  })

  it('shows a file in Finder on a click', async () => {
    const user = userEvent.setup()
    const { onReveal } = renderResources([], undefined, ['a.txt'])

    const file = screen.getByRole('button', { name: 'a.txt' })
    await user.click(file)

    expect(onReveal).toHaveBeenCalledWith('a.txt')
    expect(file).toHaveAttribute('title', 'Show in Finder')
  })

  it('deletes a file once asked', async () => {
    const user = userEvent.setup()
    const { onRemoveFile, onReveal } = renderResources([], undefined, ['a.txt', 'b.png'])

    await user.click(screen.getByRole('button', { name: 'Delete b.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete “b.png”?' })
    expect(dialog).toHaveTextContent('The file goes to the Trash, where it can be restored.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(onRemoveFile).toHaveBeenCalledExactlyOnceWith('b.png')
    expect(onReveal).not.toHaveBeenCalled()
  })

  it('keeps a file when the question is cancelled', async () => {
    const user = userEvent.setup()
    const { onRemoveFile } = renderResources([], undefined, ['a.txt'])

    await user.click(screen.getByRole('button', { name: 'Delete a.txt' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete “a.txt”?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(onRemoveFile).not.toHaveBeenCalled()
  })

  it('takes no second deletion while one is being written', async () => {
    const user = userEvent.setup()
    let finish: (removed: boolean) => void = () => undefined
    const onRemoveFile = vi.fn<CardResourcesProps['onRemoveFile']>(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    renderResources([], undefined, ['a.txt', 'b.png'], onRemoveFile)

    await user.click(screen.getByRole('button', { name: 'Delete a.txt' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Delete “a.txt”?' })).getByRole('button', {
        name: 'Delete'
      })
    )

    expect(screen.getByRole('button', { name: 'Delete b.png' })).toBeDisabled()
    act(() => {
      finish(true)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete b.png' })).toBeEnabled()
    })
  })

  it('lists files without links', () => {
    renderResources([], undefined, ['a.txt', 'b.png'])

    expect(screen.queryByText('No links or files.')).toBeNull()
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'a.txt',
      'b.png'
    ])
  })
})
