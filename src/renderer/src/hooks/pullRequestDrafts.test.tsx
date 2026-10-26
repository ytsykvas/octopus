import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DraftEvent } from '@core/pullRequestDraft.js'

import { held } from '../test/held.js'
import { announceDraft, octopus } from '../test/octopus.js'
import { useDraftState } from './pullRequestDrafts.js'

function Row({ workspaceId }: { readonly workspaceId: string | null }): React.JSX.Element {
  return <p data-testid={workspaceId ?? 'none'}>{useDraftState(workspaceId)?.status ?? 'none'}</p>
}

const writing = (workspaceId: string): DraftEvent => ({
  workspaceId,
  state: { status: 'writing' }
})

describe('where a workspace’s description stands', () => {
  // A window opened, or reloaded, while the agent was writing: the list is the
  // only way it learns there is something on the way.
  it('reads what main already has when the first reader arrives', async () => {
    vi.mocked(octopus().workspaces.drafts).mockResolvedValue({
      ok: true,
      value: [writing('anna')]
    })

    render(<Row workspaceId="anna" />)

    expect(await screen.findByText('writing')).toBeInTheDocument()
  })

  // A push says everything about one workspace, and it is newer than a list
  // that was asked for before it arrived.
  it('lets a push win over a list that lands after it', async () => {
    const list = held<{ ok: true; value: readonly DraftEvent[] }>()
    vi.mocked(octopus().workspaces.drafts).mockReturnValue(list.promise)
    render(<Row workspaceId="anna" />)

    act(() => {
      announceDraft({ workspaceId: 'anna', state: null })
      announceDraft({
        workspaceId: 'anna',
        state: { status: 'written', draft: { title: 'T', body: 'B', commitMessage: null } }
      })
    })
    await act(async () => {
      list.resolve({ ok: true, value: [writing('anna')] })
      await list.promise
    })

    expect(screen.getByTestId('anna')).toHaveTextContent('written')
  })

  it('drops a workspace main has forgotten', () => {
    render(<Row workspaceId="anna" />)

    act(() => {
      announceDraft(writing('anna'))
    })
    act(() => {
      announceDraft({ workspaceId: 'anna', state: null })
    })

    expect(screen.getByTestId('anna')).toHaveTextContent('none')
  })

  it('has nothing to say without a workspace', () => {
    render(<Row workspaceId={null} />)

    expect(screen.getByTestId('none')).toHaveTextContent('none')
  })

  // The last reader gone, the bridge is given back; a list answering the
  // taking that has ended must not fill a store nobody reads.
  it('ignores a list that lands after the last reader left', async () => {
    const list = held<{ ok: true; value: readonly DraftEvent[] }>()
    vi.mocked(octopus().workspaces.drafts).mockReturnValueOnce(list.promise)
    const first = render(<Row workspaceId="anna" />)
    first.unmount()

    await act(async () => {
      list.resolve({ ok: true, value: [writing('anna')] })
      await list.promise
    })
    render(<Row workspaceId="anna" />)

    expect(screen.getByTestId('anna')).toHaveTextContent('none')
  })

  it('reads nothing from a list that failed', async () => {
    vi.mocked(octopus().workspaces.drafts).mockResolvedValue({ ok: false, error: 'gone' })

    render(<Row workspaceId="anna" />)
    await act(() => Promise.resolve())

    expect(screen.getByTestId('anna')).toHaveTextContent('none')
  })

  // Two readers, one bridge: the second does not take it again.
  it('shares one subscription between every reader', () => {
    render(
      <>
        <Row workspaceId="anna" />
        <Row workspaceId="bob" />
      </>
    )

    expect(octopus().workspaces.onDraft).toHaveBeenCalledOnce()
  })
})
