import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { workspaceView } from '../test/workspaces.js'
import { ServerControls } from './ServerControls.js'

type Props = ComponentProps<typeof ServerControls>

const IDLE = { stage: 'idle', build: 0, server: 0, stop: 0 } as const

function renderControls(overrides: Partial<Props> = {}): Props {
  const props: Props = {
    runnable: true,
    activeRun: IDLE,
    building: false,
    servingAt: null,
    runAll: vi.fn(),
    stopRun: undefined,
    ...overrides
  }
  render(<ServerControls {...props} />)
  return props
}

describe('ServerControls', () => {
  // Nothing to start is not the same as something waiting: a project without a
  // server script gets no button, rather than one that never does anything.
  it('draws nothing where the workspace has no server to start', () => {
    const { container } = render(
      <ServerControls
        runnable={false}
        activeRun={IDLE}
        building={false}
        servingAt={null}
        runAll={undefined}
        stopRun={undefined}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('starts the run from one icon', async () => {
    const user = userEvent.setup()
    const { runAll } = renderControls()

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toHaveAttribute('title', 'Run')
    expect(run).toHaveTextContent('')
    await user.click(run)

    expect(runAll).toHaveBeenCalledTimes(1)
  })

  // The repository's scripts have not been read yet, and the button has no
  // room to say so — its tooltip has to.
  it('holds Run and says why while the scripts wait to be allowed', () => {
    renderControls({ runAll: undefined })

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeDisabled()
    expect(run).toHaveAttribute(
      'title',
      'Allow this repository’s scripts on the Scripts tab first.'
    )
  })

  // With the pane folded, this is the only place a failed build can show.
  it('says the last build failed while still offering Run', () => {
    renderControls({ activeRun: { ...IDLE, stage: 'failed' } })

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeEnabled()
    expect(run).toHaveAttribute('title', 'The build failed, so the server was not started.')
  })

  it('shows the build going and refuses a second press', () => {
    renderControls({ activeRun: { ...IDLE, stage: 'building' }, building: true })

    expect(screen.getByRole('button', { name: 'Building…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
  })

  it('links to the port the server is on and stops it, once it serves', async () => {
    const user = userEvent.setup()
    const stopRun = vi.fn()
    renderControls({
      activeRun: { ...IDLE, stage: 'serving' },
      servingAt: { ...workspaceView('bob'), port: 3222 },
      runAll: vi.fn(),
      stopRun
    })

    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open localhost:3222' })).toHaveAttribute(
      'href',
      'http://localhost:3222'
    )

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(stopRun).toHaveBeenCalledTimes(1)
  })
})
