import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BRANCH_REQUEST } from '../../test/board.js'
import { workspaceView } from '../../test/workspaces.js'
import { CardMarks } from './CardMarks.js'

describe('CardMarks', () => {
  it('says what the agent in the linked workspace is doing', () => {
    render(
      <CardMarks
        mark={{
          kind: 'live',
          workspace: workspaceView('anna', { status: 'running' }),
          request: null
        }}
      />
    )

    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The agent is working here' })).toBeInTheDocument()
  })

  it('shows the pull request of the linked workspace', () => {
    render(
      <CardMarks
        mark={{
          kind: 'live',
          workspace: workspaceView('anna', { status: 'waiting_permission' }),
          request: BRANCH_REQUEST
        }}
      />
    )

    expect(screen.getByText('Needs your answer')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Pull request #7 — checks passed' })).toBeInTheDocument()
  })

  it('names the other Mac', () => {
    render(<CardMarks mark={{ kind: 'elsewhere', machine: 'Mac-Two' }} />)

    expect(screen.getByText('In work on Mac-Two')).toBeInTheDocument()
  })

  it('says merged', () => {
    render(<CardMarks mark={{ kind: 'merged' }} />)

    expect(screen.getByText('Merged')).toBeInTheDocument()
  })

  it('says the workspace was removed', () => {
    render(<CardMarks mark={{ kind: 'removed' }} />)

    expect(screen.getByText('Workspace removed')).toBeInTheDocument()
  })
})
