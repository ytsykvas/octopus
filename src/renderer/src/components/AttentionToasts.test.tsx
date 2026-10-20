import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Mock, describe, expect, it, vi } from 'vitest'

import type { Project } from '@core/store.js'

import type { Notice } from '../attention.js'
import { workspaceView } from '../test/workspaces.js'
import { AttentionToasts } from './AttentionToasts.js'

const PLANNER = { id: 'planner', name: 'planner' } as Project
const ANNA = workspaceView('anna')

function notice(overrides: Partial<Notice> = {}): Notice {
  return {
    chatId: 'c-1',
    workspaceId: ANNA.id,
    projectId: 'planner',
    kind: 'done',
    toolName: '',
    at: 1,
    ...overrides
  }
}

function renderToasts(toasts: readonly Notice[]): { onShow: Mock; onDismiss: Mock } {
  const onShow = vi.fn()
  const onDismiss = vi.fn()
  render(
    <AttentionToasts
      toasts={toasts}
      projects={[PLANNER]}
      workspaces={[ANNA]}
      onShow={onShow}
      onDismiss={onDismiss}
    />
  )
  return { onShow, onDismiss }
}

describe('AttentionToasts', () => {
  it.each([
    { kind: 'done' as const, says: 'Finished' },
    { kind: 'error' as const, says: 'Ended with an error' },
    { kind: 'question' as const, says: 'Has a question for you' },
    { kind: 'plan' as const, says: 'Plan is ready for review' }
  ])('says what happened: $kind', ({ kind, says }) => {
    renderToasts([notice({ kind })])

    expect(screen.getByRole('region', { name: says })).toHaveTextContent('planner · anna')
  })

  it('names the tool a permission is about', () => {
    renderToasts([notice({ kind: 'permission', toolName: 'Bash' })])

    expect(screen.getByRole('region', { name: 'Wants to use Bash' })).toBeInTheDocument()
  })

  it('shows and dismisses the notice it was pressed on', async () => {
    const user = userEvent.setup()
    const first = notice()
    const second = notice({ chatId: 'c-2', kind: 'error' })
    const { onShow, onDismiss } = renderToasts([first, second])

    const error = screen.getByRole('region', { name: 'Ended with an error' })
    await user.click(within(error).getByRole('button', { name: 'Show' }))
    await user.click(within(error).getByRole('button', { name: 'Dismiss' }))

    expect(onShow).toHaveBeenCalledWith(second)
    expect(onDismiss).toHaveBeenCalledWith(second)
  })

  // A project removed since leaves its name out rather than a dangling dot.
  it('says what it can of where, when the project is gone', () => {
    renderToasts([notice({ projectId: 'gone', workspaceId: 'gone/x' })])

    expect(screen.getByRole('region', { name: 'Finished' })).not.toHaveTextContent('·')
  })

  // Announced politely, and drawn into the body so nothing in the window can
  // stack above it.
  it('lives in the body as a polite live region', () => {
    renderToasts([notice()])

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status.parentElement).toBe(document.body)
  })
})

// The status bar runs along the foot; the notices rise by its height while it
// shows, or the newest one covers its right end.
it('sits above the status bar by its height', () => {
  renderToasts([notice()])

  expect(screen.getByRole('status')).toHaveClass('bottom-[calc(1rem+var(--status-bar-height,0px))]')
})
