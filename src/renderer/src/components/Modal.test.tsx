import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { Modal } from './Modal.js'

/**
 * jsdom declares `HTMLDialogElement` but implements none of its modal
 * behaviour: `showModal` does not exist, and Escape never produces the
 * `cancel` event the dialog is closed by. Both are the platform half of what
 * this component relies on, so the tests supply them rather than reaching
 * around the component and calling `onClose` themselves.
 */
const openDialogs = new Set<HTMLDialogElement>()

beforeAll(() => {
  const dialogs = window.HTMLDialogElement.prototype

  dialogs.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
    openDialogs.add(this)
  }

  dialogs.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open')
    openDialogs.delete(this)
    this.dispatchEvent(new Event('close'))
  }

  // Escape reaches the topmost modal dialog as a cancelable `cancel` event,
  // and only closes it when nothing calls preventDefault.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return

    const topmost = [...openDialogs].at(-1)
    if (!topmost) return

    if (topmost.dispatchEvent(new Event('cancel', { cancelable: true }))) topmost.close()
  })
})

afterEach(() => {
  openDialogs.clear()
})

describe('Modal', () => {
  it('names the dialog with its title', () => {
    render(
      <Modal title="Rename workspace" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>
    )

    expect(screen.getByRole('dialog', { name: 'Rename workspace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rename workspace' })).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('closes when Escape is pressed', async () => {
    const onClose = vi.fn()

    render(
      <Modal title="Rename workspace" onClose={onClose}>
        <p>Body</p>
      </Modal>
    )

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Escape asks the parent to close; the dialog must not vanish on its own, or
  // a parent that refuses would be left with an invisible modal on screen.
  it('leaves closing to its owner rather than dismissing itself', async () => {
    render(
      <Modal title="Rename workspace" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>
    )

    await userEvent.keyboard('{Escape}')

    expect(screen.getByRole('dialog', { name: 'Rename workspace' })).toBeInTheDocument()
  })

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn()

    render(
      <Modal title="Rename workspace" onClose={onClose}>
        <p>Body</p>
      </Modal>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Deliberate: these dialogs hold edits and confirmations, and a stray click
  // beside one must not discard what is in it. A backdrop click lands on the
  // dialog element itself, which is what this reproduces.
  it('stays open when the backdrop is clicked', () => {
    const onClose = vi.fn()

    render(
      <Modal title="Rename workspace" onClose={onClose}>
        <p>Body</p>
      </Modal>
    )

    fireEvent.click(screen.getByRole('dialog', { name: 'Rename workspace' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Rename workspace' })).toBeInTheDocument()
  })

  it('puts the given controls in the footer and lets them be used', async () => {
    const save = vi.fn()

    render(
      <Modal
        title="Rename workspace"
        onClose={vi.fn()}
        footer={
          <button type="button" onClick={save}>
            Save
          </button>
        }
      >
        <p>Body</p>
      </Modal>
    )

    const footer = screen.getByRole('contentinfo')

    await userEvent.click(within(footer).getByRole('button', { name: 'Save' }))

    expect(save).toHaveBeenCalledTimes(1)
  })

  // Without controls to hold there is no footer at all — not an empty one.
  // A dialog that always carries the bar ends a short confirmation with a
  // ruled-off, empty strip under its text.
  it('shows only the body and a way out when no footer is given', () => {
    render(
      <Modal title="Rename workspace" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>
    )

    expect(screen.queryByRole('contentinfo')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
